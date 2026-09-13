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
#   6. бэкенд: свободный слот web (синий/зелёный) поднимается на новом образе и
#      проходит health, и только потом гасится прежний слот — API не пропадает;
#      worker и beat перезапускаются рядом (на трафик не влияют);
#   7. nginx: конфиг проверяется и применяется reload'ом (контейнер не трогаем);
#   8. проверка ревизии alembic и ответа приложения.
#
# Скрипт безопасно запускать повторно: прод при этом не ломается (слоты просто
# меняются местами), а уже применённые миграции повторно ничего не делают.

set -eu

PROJECT="${PROJECT:-microshop-test}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yaml}"
COMPOSE="docker compose -p $PROJECT -f $COMPOSE_FILE"

# Сколько секунд держать прежний слот живым после того, как новый уже готов.
# По умолчанию 0: сигналинг звонков и presence живут В ПАМЯТИ ПРОЦЕССА
# (api_v1/calls/manager.py), поэтому пока работают оба слота, часть
# пользователей попадает на другой слот и их звонки/печатание друг друга не
# видят. Ноль держит это окно минимальным; больше значение — только если нужно
# дать текущим соединениям доработать дольше (ценой того же риска).
DRAIN_SECONDS="${DRAIN_SECONDS:-0}"

# Файл состояния деплоя (вне репозитория, чтобы git reset его не сносил).
STATE_DIR="${STATE_DIR:-$HOME/.microshop-deploy}"
STATE_FILE="$STATE_DIR/active-web-slot"

say() { printf '\n==> %s\n' "$*"; }
fail() { printf '\n!!! %s\n' "$*" >&2; exit 1; }

# Ждём, пока контейнер станет healthy (для сервисов с healthcheck).
# Возвращает 1, если не дождались: решает вызывающий (откат или падение).
wait_healthy() {
  name="$1"
  i=0
  while [ "$i" -lt 60 ]; do
    status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$name" 2>/dev/null || echo missing)
    case "$status" in
      healthy|running) echo "$name: $status"; return 0 ;;
      missing) echo "контейнер $name не найден" >&2; return 1 ;;
    esac
    i=$((i + 1))
    sleep 3
  done
  echo "$name не стал healthy (последний статус: $status)" >&2
  return 1
}

# Печатает запущенный слот web (web-blue или web-green), если он есть.
detect_active_slot() {
  for slot in web-blue web-green; do
    if [ "$(docker inspect -f '{{.State.Running}}' "$PROJECT-$slot-1" 2>/dev/null || true)" = "true" ]; then
      echo "$slot"
      return 0
    fi
  done
  return 1
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

say "6/8 Бэкенд: слот web (синий/зелёный), worker, beat"
# worker и beat живут в одном экземпляре: их перезапуск не влияет на ответы API.
for service in worker beat; do
  $COMPOSE up -d --no-build --no-deps "$service"
done

# Какой слот сейчас обслуживает трафик: сначала верим файлу состояния (если слот
# и правда запущен), потом — тому, что реально работает.
mkdir -p "$STATE_DIR"
active=""
if [ -f "$STATE_FILE" ]; then
  saved=$(cat "$STATE_FILE" 2>/dev/null || true)
  case "$saved" in
    web-blue|web-green)
      if [ "$(docker inspect -f '{{.State.Running}}' "$PROJECT-$saved-1" 2>/dev/null || true)" = "true" ]; then
        active="$saved"
      fi
      ;;
  esac
fi
[ -n "$active" ] || active=$(detect_active_slot || true)
# Первый запуск после перехода на слоты: начинаем с синего.
[ -n "$active" ] || active="web-blue"
if [ "$active" = "web-blue" ]; then target="web-green"; else target="web-blue"; fi

echo "в работе: $active → поднимаю новый слот $target"
# Убираем контейнер этого слота, если он остался от прошлого раза: так новый слот
# гарантированно стартует на свежесобранном образе.
$COMPOSE rm -sf "$target" >/dev/null 2>&1 || true
$COMPOSE up -d --no-build --no-deps "$target"

# Не поднялся — сносим неудачный слот и оставляем прод на прежнем: пользователи
# ничего не заметят, а следующий деплой попробует снова.
if ! wait_healthy "$PROJECT-$target-1"; then
  $COMPOSE rm -sf "$target" >/dev/null 2>&1 || true
  fail "новый слот $target не поднялся — прод продолжает работать на $active"
fi
printf '%s' "$target" > "$STATE_FILE"

# Оба слота живы: nginx уже делит между ними трафик. Если задан DRAIN_SECONDS,
# ждём — текущие соединения на прежнем слоте дорабатывают. По умолчанию окно
# нулевое (см. пояснение к DRAIN_SECONDS выше).
if [ "$DRAIN_SECONDS" -gt 0 ]; then
  echo "даю ${DRAIN_SECONDS} с на завершение соединений на $active"
  sleep "$DRAIN_SECONDS"
fi
$COMPOSE stop "$active" >/dev/null
echo "слот $active остановлен, в работе $target"
active="$target"

say "7/8 nginx"
# Конфиг nginx монтируется из репозитория (./frontend/nginx-prod), поэтому его
# правки применяются reload'ом — это без простоя: старые воркеры дорабатывают
# запросы, новые стартуют с новым конфигом.
# Сначала проверяем конфиг одноразовым контейнером: он видит тот же каталог и те
# же сертификаты, что рабочий nginx, но ничего не трогает в проде.
CONF_DIR="$PWD/frontend/nginx-prod"
# Том с сертификатами: compose называет тома через подчёркивание
# (`<проект>_certbot_etc`), а контейнеры — через дефис (`<проект>-web-blue-1`).
# Берём имя у работающего контейнера, чтобы не угадывать.
CERT_VOLUME=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/etc/letsencrypt"}}{{.Name}}{{end}}{{end}}' \
  "$PROJECT-frontend-1" 2>/dev/null || true)
[ -n "$CERT_VOLUME" ] || CERT_VOLUME="${PROJECT}_certbot_etc"
conf_test() {
  docker run --rm \
    -v "$CONF_DIR:/etc/nginx/conf.d:ro" \
    -v "$CERT_VOLUME:/etc/letsencrypt:ro" \
    --entrypoint nginx "$PROJECT-frontend:latest" -t
}
if ! conf_test >/dev/null 2>&1; then
  conf_test || true
  fail "конфиг nginx невалиден — прод работает на прежнем"
fi
echo "конфиг nginx проверен"

# Пересоздание тут делает compose и только если менялось описание сервиса
# (тома, порты): тогда без него не обойтись. Правка одного конфига пересоздания
# не требует.
$COMPOSE up -d --no-build --no-deps frontend
wait_healthy "$PROJECT-frontend-1" || fail "контейнер frontend не поднялся"
$COMPOSE exec -T frontend nginx -s reload
echo "конфиг применён без пересоздания контейнера"

# Переходный момент: раньше API обслуживал единственный контейнер web, новый
# конфиг его не знает — убираем, чтобы не занимал память и не путал.
if ! $COMPOSE config --services 2>/dev/null | grep -qx web; then
  docker ps -a --format '{{.Names}}' | grep -x "$PROJECT-web-1" | xargs -r docker rm -f >/dev/null 2>&1 || true
fi

say "8/8 Проверки"
current=$($COMPOSE exec -T "$active" poetry run alembic current 2>/dev/null | sed -n 's/^\([0-9a-fA-F]\{6,\}\).*/\1/p' | head -1)
heads=$($COMPOSE exec -T "$active" poetry run alembic heads 2>/dev/null | sed -n 's/^\([0-9a-fA-F]\{6,\}\).*/\1/p' | head -1)
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
