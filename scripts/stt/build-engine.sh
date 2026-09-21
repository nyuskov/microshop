#!/bin/sh
# Собирает движок распознавания речи в один самодостаточный модуль.
#
# Почему отдельная сборка, а не зависимость фронтенда: движок нужен только тому
# браузеру, который распознаёт моделью (телефоны), весит сотни килобайт и ломает
# бюджет веса бандла. В приложении он подключается динамическим импортом по URL
# (frontend/src/utils/localSpeech.ts), а версия закреплена там же в ENGINE_VERSION —
# при смене версии поменяйте её здесь и там, и рантайм ONNX будет той же версии.
#
# Собранного файла в git нет намеренно: 820 КБ минифицированного кода без истории
# правок — балласт, а собрать его — одна команда.
#
# Использование:
#   scripts/stt/build-engine.sh [каталог-назначения]
#   TRANSFORMERS_VERSION=3.6.0 scripts/stt/build-engine.sh /tmp/stt
#
# Дальше: scripts/stt/publish.sh (заливает собранное и модели на сервер).

set -eu

VERSION="${TRANSFORMERS_VERSION:-3.6.0}"
OUT="${1:-$PWD/.stt-build}"
WORK="$OUT/pkg"

mkdir -p "$WORK"
[ -f "$WORK/package.json" ] ||
  printf '{"name":"pismo-stt-build","private":true,"type":"module"}\n' > "$WORK/package.json"

cd "$WORK"
if command -v pnpm >/dev/null 2>&1; then
  pnpm add --ignore-scripts "@huggingface/transformers@$VERSION"
  pnpm add --ignore-scripts esbuild
else
  npm install --ignore-scripts --no-audit --no-fund "@huggingface/transformers@$VERSION" esbuild
fi

# Точка входа: только то, чем пользуется наш код. Всё остальное собирается внутрь,
# поэтому у готового модуля нет внешних импортов (проверяем ниже).
printf "export { pipeline, env } from '@huggingface/transformers'\n" > entry.js

./node_modules/.bin/esbuild entry.js \
  --bundle --format=esm --minify --target=es2022 \
  --outfile="$OUT/transformers-bundled.js"

# Рантайм ONNX кладём рядом с движком: он ищет эти файлы по своему адресу, а мы
# дублируем путь в `env.backends.onnx.wasm.wasmPaths` (см. localSpeech.ts).
cp node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs "$OUT/"
cp node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm "$OUT/"

# Манифест без моделей: их качает на сервере fetch-models.sh, и только после этого
# publish.sh включает флаг `models` (иначе браузер пошёл бы за моделями к нам, где
# их ещё нет).
printf '{"engine":"transformers-bundled.js"}\n' > "$OUT/manifest.json"

printf '\nготово: %s\n' "$OUT"
ls -la "$OUT" | grep -v '^d' | awk '{printf "  %8s  %s\n", $5, $9}'
printf '\nпроверьте, что внешних импортов нет:\n'
grep -o "from *[\"'][^\"']*[\"']" "$OUT/transformers-bundled.js" | sort -u || printf '  (нет)\n'
