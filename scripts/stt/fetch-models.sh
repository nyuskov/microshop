#!/bin/sh
# Скачивает модели распознавания речи в зеркало для раздачи со своего сервера.
#
# Зачем: движок (transformers.js) по умолчанию тянет модель с huggingface.co.
# Из мобильных сетей в РФ этот хост (как и публичный CDN движка) недоступен, а
# CSP прода и так запрещает чужие источники — поэтому файлы модели лежат у нас
# и отдаются по своему адресу (см. docs/on-device-transcription.md).
#
# Раскладка повторяет структуру репозитория Hugging Face, потому что движок
# собирает адрес как `{remoteHost}/models/{repo}/resolve/main/{file}`.
#
# Использование:
#   scripts/stt/fetch-models.sh [каталог] [список репозиториев]
#   scripts/stt/fetch-models.sh ~/pismo-stt 'Xenova/whisper-tiny Xenova/whisper-base'
#
# Переменная HF_HOST позволяет взять зеркало (например, hf-mirror.com), если
# huggingface.co недоступен с этой машины.

set -eu

TARGET="${1:-$HOME/pismo-stt}"
REPOS="${2:-Xenova/whisper-tiny Xenova/whisper-base}"
HF_HOST="${HF_HOST:-https://huggingface.co}"

# Ровно тот набор, который запрашивает движок при dtype=q8 (проверено по кэшу
# браузера): конфиги + два квантованных графа в подкаталоге onnx.
FILES="config.json generation_config.json preprocessor_config.json tokenizer.json tokenizer_config.json onnx/encoder_model_quantized.onnx onnx/decoder_model_merged_quantized.onnx"

for repo in $REPOS; do
  dir="$TARGET/models/$repo/resolve/main"
  mkdir -p "$dir/onnx"
  for file in $FILES; do
    if [ -s "$dir/$file" ]; then
      printf 'уже есть: %s/%s\n' "$repo" "$file"
      continue
    fi
    printf 'качаю:    %s/%s\n' "$repo" "$file"
    # Качаем во временный файл: прерванная загрузка не оставит обрезанную модель,
    # которую движок потом примет за готовую.
    curl -fL --retry 3 --retry-delay 2 -o "$dir/$file.part" "$HF_HOST/$repo/resolve/main/$file"
    mv "$dir/$file.part" "$dir/$file"
  done
done

printf '\nготово: %s\n' "$TARGET/models"
du -sh "$TARGET/models" 2>/dev/null || true
