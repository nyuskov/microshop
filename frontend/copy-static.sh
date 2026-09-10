#!/bin/sh
# Копирует свежую статику из образа в том, из которого её раздаёт рабочий nginx.
#
# Запускается во время деплоя одноразовым контейнером (сервис frontend-dist) —
# поэтому nginx не пересоздаётся и сайт не пропадает. Смотри
# scripts/ci/deploy_remote.sh и docs/production.md.
#
# Почему отдельный файл, а не команда в compose: многострочная shell-команда в
# YAML легко «разъезжается» при рендере (получался синтаксически битый скрипт),
# а так логика лежит в репозитории, её видно и можно проверить локально.

set -eu

SRC=/usr/share/nginx/html
DST=/dst

[ -d "$SRC" ] || {
  echo "ОШИБКА: в образе нет $SRC — образ собран неправильно" >&2
  exit 1
}
[ -d "$DST" ] || {
  echo "ОШИБКА: не смонтирован том с текущей статикой ($DST)" >&2
  exit 1
}

# Сначала всё, кроме index.html: иначе есть мгновение, когда новый index уже на
# месте, а ссылается на ещё не скопированный файл из /assets.
find "$SRC" -mindepth 1 -maxdepth 1 ! -name index.html -exec cp -a {} "$DST"/ \;
cp -a "$SRC/index.html" "$DST/index.html"

test -s "$DST/index.html" || {
  echo "ОШИБКА: index.html не скопировался" >&2
  exit 1
}

assets=$(ls "$DST/assets" 2>/dev/null | wc -l)
[ "$assets" -gt 0 ] || {
  echo "ОШИБКА: каталог assets пуст — статика не скопировалась" >&2
  exit 1
}

echo "статика обновлена: файлов в assets — $assets"
