#!/usr/bin/env bash
# Печатает SHA-256 отпечаток ключа подписи — его нужно вписать в
# frontend/public/.well-known/assetlinks.json (App Links: ссылки pismo.space
# открываются сразу в приложении, а не в браузере).
#
# Запуск: ./scripts/rustore/cert_fingerprint.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ANDROID_DIR="${ROOT}/android"
KEYSTORE_FILE="${ANDROID_DIR}/keystore/pismo-release.jks"
KEY_ALIAS="${KEY_ALIAS:-pismo}"

if [ ! -f "${ANDROID_DIR}/keystore.properties" ]; then
    echo "Нет ${ANDROID_DIR}/keystore.properties — сначала создайте ключ:" >&2
    echo "  ./scripts/rustore/new_keystore.sh" >&2
    exit 1
fi

# shellcheck disable=SC1091
STORE_PASSWORD="$(grep -E '^storePassword=' "${ANDROID_DIR}/keystore.properties" | cut -d= -f2-)"

docker run --rm \
    -v "${ANDROID_DIR}:/workspace" \
    eclipse-temurin:17-jdk-jammy \
    keytool -list -v \
        -keystore "/workspace/keystore/$(basename "${KEYSTORE_FILE}")" \
        -alias "${KEY_ALIAS}" \
        -storepass "${STORE_PASSWORD}" \
    | grep -E 'SHA256|SHA-256' | head -1
