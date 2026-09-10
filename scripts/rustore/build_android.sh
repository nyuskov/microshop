#!/usr/bin/env bash
# Сборка Android-приложения Pismo (APK/AAB для RuStore) в Docker.
#
# Примеры:
#   ./scripts/rustore/build_android.sh                 # debug APK (проверка сборки)
#   ./scripts/rustore/build_android.sh bundleRelease   # AAB для RuStore (подпись из keystore.properties)
#   ./scripts/rustore/build_android.sh assembleRelease # подписанный APK
#
# Переменные окружения/аргументы Gradle пробрасываются как есть, например:
#   ./scripts/rustore/build_android.sh bundleRelease -PrustoreProjectId=123456
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ANDROID_DIR="${ROOT}/android"
IMAGE="${PISMO_ANDROID_IMAGE:-pismo-android-build}"
GRADLE_HOME_VOLUME="${PISMO_GRADLE_VOLUME:-pismo-android-gradle-home}"
TASK="${1:-assembleDebug}"
shift || true

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }

log "Сборочный образ: ${IMAGE}"
docker build -q -f "${ANDROID_DIR}/Dockerfile.build" -t "${IMAGE}" "${ANDROID_DIR}" >/dev/null

log "Gradle-кеш: том ${GRADLE_HOME_VOLUME} (чтобы не скачивать зависимости заново)"

if [ ! -f "${ANDROID_DIR}/gradlew" ]; then
    log "Генерирую Gradle wrapper (для локальной сборки в Android Studio)"
    docker run --rm \
        -v "${ANDROID_DIR}:/workspace" \
        -v "${GRADLE_HOME_VOLUME}:/gradle-home" \
        "${IMAGE}" gradle wrapper --gradle-version 8.9 >/dev/null
fi

log "Сборка: ${TASK} $*"
docker run --rm \
    -v "${ANDROID_DIR}:/workspace" \
    -v "${GRADLE_HOME_VOLUME}:/gradle-home" \
    "${IMAGE}" ./gradlew --no-daemon "${TASK}" "$@"

# Контейнер работает от root, поэтому возвращаем владельца файлов хосту:
# иначе сгенерированные gradlew/app/build останутся root-owned в репозитории.
log "Возвращаю владельца файлов сборки пользователю хоста"
docker run --rm --entrypoint chown \
    -v "${ANDROID_DIR}:/workspace" \
    "${IMAGE}" -R "$(id -u):$(id -g)" /workspace >/dev/null

log "Готово. Артефакты:"
find "${ANDROID_DIR}/app/build/outputs" -maxdepth 3 -type f \( -name '*.apk' -o -name '*.aab' \) -print 2>/dev/null || true
