#!/bin/sh
# Выкладывает ассеты распознавания речи на прод-сервер.
#
#   1. собирает движок (build-engine.sh) — при желании можно пропустить: ENGINE_ONLY
#      или готовый каталог через ASSETS_DIR;
#   2. заливает движок и рантайм ONNX в каталог раздачи;
#   3. качает туда же модели Whisper (скрипт выполняется НА СЕРВЕРЕ: он видит
#      huggingface.co, а машине разработчика внешние адреса могут быть недоступны);
#   4. пишет manifest.json, по которому браузер понимает, что рядом лежат и движок, и
#      модели (см. frontend/src/utils/localSpeech.ts).
#
# Перезапуск контейнеров не нужен: каталог смонтирован в nginx как /stt/, файлы
# читаются сразу. Пересоздание нужно только когда в compose добавляется сам mount.
#
# Использование:
#   scripts/stt/publish.sh [user@хост]
#   PISMO_STT_KEY=~/.ssh/id_ed25519 scripts/stt/publish.sh user@prod.example.com
#
# Переменные: PISMO_STT_HOST, PISMO_STT_DIR, PISMO_STT_KEY, PISMO_STT_MODELS,
# ASSETS_DIR (готовый каталог сборки вместо новой сборки).

set -eu

HOST="${1:-${PISMO_STT_HOST:-}}"
DIR="${PISMO_STT_DIR:-/srv/pismo-stt}"
if [ -z "$HOST" ]; then
  echo "!!! Укажите хост: scripts/stt/publish.sh user@host или PISMO_STT_HOST=..." >&2
  exit 2
fi
MODELS="${PISMO_STT_MODELS:-Xenova/whisper-tiny Xenova/whisper-base}"
KEY="${PISMO_STT_KEY:-$HOME/.ssh/id_ed25519}"

# Ключ может быть и не нужен (ssh-agent, ~/.ssh/config) — тогда просто не передаём.
ssh_() { if [ -f "$KEY" ]; then ssh -i "$KEY" "$@"; else ssh "$@"; fi; }
scp_() { if [ -f "$KEY" ]; then scp -i "$KEY" "$@"; else scp "$@"; fi; }

ASSETS_DIR="${ASSETS_DIR:-}"
if [ -z "$ASSETS_DIR" ]; then
  ASSETS_DIR="$(mktemp -d)/stt"
  printf '==> собираю движок\n'
  "$(dirname "$0")/build-engine.sh" "$ASSETS_DIR"
fi

printf '==> готовлю каталог на сервере: %s\n' "$DIR"
ssh_ "$HOST" "mkdir -p '$DIR'"

printf '==> заливаю движок и рантайм ONNX\n'
scp_ "$ASSETS_DIR/transformers-bundled.js" \
  "$ASSETS_DIR/ort-wasm-simd-threaded.jsep.mjs" \
  "$ASSETS_DIR/ort-wasm-simd-threaded.jsep.wasm" \
  "$HOST:$DIR/"

printf '==> качаю модели на сервере\n'
# Скрипт отдаём по ssh в stdin: на сервере копии не остаётся, версия одна — из git.
ssh_ "$HOST" "sh -s '$DIR' '$MODELS'" < "$(dirname "$0")/fetch-models.sh"

printf '==> пишу манифест\n'
ssh_ "$HOST" "printf '%s\n' '{\"engine\":\"transformers-bundled.js\",\"models\":true}' > '$DIR/manifest.json'"
ssh_ "$HOST" "cat '$DIR/manifest.json'"

printf '\n==> проверьте снаружи:\n'
printf '  curl -s  https://pismo.space/stt/manifest.json\n'
printf '  curl -sI https://pismo.space/stt/transformers-bundled.js   # 200 и text/javascript\n'
printf '  curl -sI https://pismo.space/stt/ort-wasm-simd-threaded.jsep.wasm  # application/wasm\n'
