#!/usr/bin/env bash
# Заполняет frontend/public/.well-known/assetlinks.json отпечатком ключа подписи.
#
# Нужно, чтобы Android открывал ссылки https://pismo.space сразу в приложении
# (App Links), а не в браузере. Без этого файла приложение работает, но ссылки
# открываются в браузере (и `autoVerify` в манифесте не проходит).
#
# Запуск (после создания ключа и keystore.properties):
#   ./scripts/rustore/write_assetlinks.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ANDROID_DIR="${ROOT}/android"
TARGET="${ROOT}/frontend/public/.well-known/assetlinks.json"
KEY_ALIAS="${KEY_ALIAS:-pismo}"
PACKAGE_NAME="${PACKAGE_NAME:-space.pismo.app}"

if [ ! -f "${ANDROID_DIR}/keystore.properties" ]; then
    echo "Нет ${ANDROID_DIR}/keystore.properties — сначала создайте ключ:" >&2
    echo "  ./scripts/rustore/new_keystore.sh" >&2
    exit 1
fi

STORE_PASSWORD="$(grep -E '^storePassword=' "${ANDROID_DIR}/keystore.properties" | cut -d= -f2-)"
STORE_FILE="$(grep -E '^storeFile=' "${ANDROID_DIR}/keystore.properties" | cut -d= -f2-)"

FINGERPRINT="$(docker run --rm \
    -v "${ANDROID_DIR}:/workspace" \
    eclipse-temurin:17-jdk-jammy \
    keytool -list -v \
        -keystore "/workspace/${STORE_FILE}" \
        -alias "${KEY_ALIAS}" \
        -storepass "${STORE_PASSWORD}" \
    | grep -E 'SHA256:' | head -1 | sed 's/.*SHA256: //' | tr -d '[:space:]')"

if [ -z "${FINGERPRINT}" ]; then
    echo "Не удалось получить отпечаток ключа" >&2
    exit 1
fi

mkdir -p "$(dirname "${TARGET}")"
cat > "${TARGET}" <<EOF
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "${PACKAGE_NAME}",
      "sha256_cert_fingerprints": ["${FINGERPRINT}"]
    }
  }
]
EOF

echo "Записан ${TARGET}"
echo "Отпечаток: ${FINGERPRINT}"
echo
echo "Дальше: пересоберите фронтенд и задеплойте, затем проверьте"
echo "https://pismo.space/.well-known/assetlinks.json (код ответа 200 и корректный JSON)."
