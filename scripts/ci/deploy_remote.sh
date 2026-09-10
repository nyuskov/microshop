#!/bin/sh
# Деплой на прод-сервере БЕЗ простоя.
#
# Запускается из GitHub Actions по ssh (job deploy) после `git reset --hard
# origin/main`. Раньше деплой делался одной командой
# `up -d --build --force-recreate --pull always`, которая пересоздавала ВСЁ
# (включая базу и rabbitmq) — сайт пропадал на 1–2 минуты. Здесь обновляем только
# то, что реально изменилось, и следим за здоровьем:
#
#   1. уборка контейнеров от прерванного деплоя;
#   2. сборка образов (без пересоздания контейнеров);
#   3. статика фронтенда: копирование в том frontend_html (nginx не пересоздаётся);
#   4. инфраструктура — только если изменилась;
#   5. миграции;
#   6. бэкенд по одному сервису с ожиданием health;
#   7. nginx: пересоздаём только если изменилась его конфигурация, иначе reload;
#   8. проверка ревизии alembic и ответа приложения.
#
# Скрипт идемпотентен: повторный запуск без изменений ничего не пересоздаёт.

set -eu

PROJECT="${PROJECT:-microshop-test}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.test.yaml}"
COMPOSE="docker compose -p $PROJECT -f $COMPOSE_FILE"

say() { printf '\n==> %s\n' "$*"; }
fail() { printf '\n!!! %s\n' "$*" >&2; exit 1; }

# Ждём, пока контейнер станет healthy (для сервисов с healthcheck).
wait_healthy() {
  name="$1"
  i=0
  while [ "$i" -lt 60 ]; do
    status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$name" 2>/dev/null || echo missing)
    case "$status" in
      healthy|running) echo "$name: $status"; return 0 ;;
      missing) fail "контейнер $name не найден" ;;
    esac
    i=$((i + 1))
    sleep 3
  done
  fail "$name не стал healthy (последний статус: $status)"
}

say "1/8 Уборка контейнеров от прерванного деплоя"
# compose переименовывает старый контейнер в <id>_<name>; без уборки следующий
# запуск падает на конфликте имён, а прод остаётся без контейнеров.
docker ps -a --format '{{.Names}}' | grep -E '^[0-9a-f]{12}_' | xargs -r docker rm -f || true

say "2/8 Сборка образов"
$COMPOSE --profile dist build

say "3/8 Статика фронтенда в том (nginx продолжает работать)"
# Том создаётся этим запуском; index.html копируется последним, чтобы не было
# мгновения, когда он ссылается на ещё не скопированный ассет.
$COMPOSE --profile dist run --rm --no-deps frontend-dist

say "4/8 Инфраструктура (db, rabbitmq, coturn, certbot)"
# Без --build: образы уже собраны; без изменений compose ничего не пересоздаёт.
$COMPOSE up -d --no-build db rabbitmq coturn certbot

say "5/8 Миграции"
$COMPOSE run --rm --no-deps migrate

say "6/8 Бэкенд (web, worker, beat) — по одному, с ожиданием"
for service in web worker beat; do
  $COMPOSE up -d --no-build --no-deps "$service"
done
wait_healthy "$PROJECT-web-1"
sleep 2   # даём воркеру/биту подхватить соединения

say "7/8 nginx"
# Контейнер пересоздаём только если изменился его образ (правка nginx.prod.conf
# или Dockerfile.nginx). Обновление одной статики пересоздания не требует.
running_image=$(docker inspect -f '{{.Image}}' "$PROJECT-frontend-1" 2>/dev/null || echo none)
built_image=$(docker inspect -f '{{.Id}}' "$PROJECT-frontend:latest" 2>/dev/null || echo none)
if [ "$running_image" != "$built_image" ]; then
  echo "образ nginx изменился — пересоздаём контейнер (единичный случай)"
  $COMPOSE up -d --no-build --no-deps frontend
  wait_healthy "$PROJECT-frontend-1"
else
  echo "образ nginx не менялся — только reload config (без простоя)"
  $COMPOSE exec -T frontend nginx -s reload || $COMPOSE up -d --no-build --no-deps frontend
fi

say "8/8 Проверки"
current=$($COMPOSE exec -T web poetry run alembic current 2>/dev/null | sed -n 's/^\([0-9a-fA-F]\{6,\}\).*/\1/p' | head -1)
heads=$($COMPOSE exec -T web poetry run alembic heads 2>/dev/null | sed -n 's/^\([0-9a-fA-F]\{6,\}\).*/\1/p' | head -1)
if [ -z "$current" ] || [ "$current" != "$heads" ]; then
  fail "ревизия БД '$current' не совпадает с ожидаемой '$heads'"
fi
echo "миграции применены: $current"

# Локальная проверка, что приложение живое (снаружи проверяет job smoke).
for i in 1 2 3 4 5 6 7 8 9 10; do
  code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 5 https://127.0.0.1/api/v1/health || true)
  [ "$code" = "200" ] && break
  sleep 3
done
[ "$code" = "200" ] || fail "приложение не отвечает на /api/v1/health (код $code)"
echo "приложение отвечает: /api/v1/health -> 200"

printf '\nДеплой завершён без простоя (ревизия %s).\n' "$current"
