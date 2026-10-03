#!/usr/bin/env bash
# Создаёт ключ подписи (keystore) для публикации в RuStore и файл keystore.properties.
#
# Запуск:  ./scripts/rustore/new_keystore.sh
#
# ВАЖНО:
#   * пароли вводятся интерактивно и никуда не передаются (в git не попадают);
#   * файл ключа и пароли нужно сохранить навсегда — без них нельзя выпустить
#     обновление приложения с той же подписью (RuStore требует один ключ на все версии);
#   * сделайте резервную копию keystore и паролей (например, в менеджере паролей).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ANDROID_DIR="${ROOT}/android"
KEYSTORE_DIR="${ANDROID_DIR}/keystore"
KEYSTORE_FILE="${KEYSTORE_DIR}/pismo-release.jks"
KEY_ALIAS="${KEY_ALIAS:-pismo}"

if [ -f "${KEYSTORE_FILE}" ]; then
    echo "Ключ уже существует: ${KEYSTORE_FILE}"
    echo "Если он вам не нужен — удалите файл и запустите скрипт снова."
    exit 1
fi

mkdir -p "${KEYSTORE_DIR}"
chmod 700 "${KEYSTORE_DIR}"

echo "Создаю ключ подписи: ${KEYSTORE_FILE}"
echo "Пароли введите вручную (они не сохраняются нигде, кроме keystore.properties)."
echo

# keytool есть в JDK внутри сборочного образа — повторяем то, что описано в docs/rustore.md.
docker run --rm -it \
    -v "${KEYSTORE_DIR}:/keystore" \
    eclipse-temurin:17-jdk-jammy \
    keytool -genkeypair -v \
        -keystore "/keystore/pismo-release.jks" \
        -alias "${KEY_ALIAS}" \
        -keyalg RSA -keysize 4096 -validity 10950 \
        -dname "CN=Pismo, OU=Mobile, O=Pismo, L=Moscow, C=RU"

cat <<EOF

Ключ создан: ${KEYSTORE_FILE}

Теперь создайте ${ANDROID_DIR}/keystore.properties (файл в .gitignore):

    storeFile=keystore/pismo-release.jks
    storePassword=<пароль ключа>
    keyAlias=${KEY_ALIAS}
    keyPassword=<пароль ключа>

После этого сборка AAB для RuStore:
    ./scripts/rustore/build_android.sh bundleRelease

Отпечаток сертификата (SHA-256) понадобится для .well-known/assetlinks.json —
посмотреть можно так:
    ./scripts/rustore/cert_fingerprint.sh
EOF
