#!/usr/bin/env bash
# Включает e-mail-канал (подтверждение адреса, вход по коду, сброс пароля) на проде.
#
# Скрипт запускается на ЛОКАЛЬНОЙ машине: спрашивает SMTP-данные, обновляет
# ~/microshop/.env на сервере и перезапускает web/worker, чтобы переменные
# подхватились. Пароль вводится скрытно (read -s) и НИКУДА не пишется, кроме
# продового .env (права 600). В логах скрипта пароля нет.
#
# Использование:
#   ./scripts/smtp/configure_smtp_on_prod.sh              # настроить
#   ./scripts/smtp/configure_smtp_on_prod.sh --dry-run    # только показать, что изменится
#
# Переменные: PROD_SSH, PROD_KEY, PROD_DIR, PROD_PROJECT, PROD_COMPOSE_FILE.
#
# Подсказка по провайдерам (нужен «пароль приложения», не пароль от почты):
#   Gmail  : smtp.gmail.com  порт 587 (STARTTLS), логин = полный адрес;
#            включается в аккаунте Google → Безопасность → 2FA → Пароли приложений.
#   Яндекс : smtp.yandex.ru  порт 465 (SSL), логин = полный адрес, пароль приложения.
#   Mail.ru: smtp.mail.ru    порт 465 (SSL), логин = полный адрес, пароль для внешних приложений.

set -uo pipefail
export PATH="$PATH:/usr/local/bin:/usr/bin:/bin"

PROD_SSH="${PROD_SSH:-user1@176.108.249.9}"
PROD_KEY="${PROD_KEY:-$HOME/.ssh/id_rsa1}"
PROD_DIR="${PROD_DIR:-~/microshop}"
PROD_PROJECT="${PROD_PROJECT:-microshop-test}"
PROD_COMPOSE_FILE="${PROD_COMPOSE_FILE:-docker-compose.test.yaml}"

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

SSH_OPTS=(-i "$PROD_KEY" -o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new)
# -n обязателен: без него ssh читает stdin и «съедает» ответы пользователя
# на вопросы ниже (а также ввод в других скриптах).
remote() { ssh -n "${SSH_OPTS[@]}" "$PROD_SSH" "$@"; }
# Вариант для передачи файла в stdin (тут -n, наоборот, не нужен).
remote_in() { ssh "${SSH_OPTS[@]}" "$PROD_SSH" "$@"; }
compose() { remote "cd $PROD_DIR && docker compose -p '$PROD_PROJECT' -f '$PROD_COMPOSE_FILE' $*"; }

die() { echo "!!! $*" >&2; exit 1; }

remote "test -d $PROD_DIR" || die "нет доступа к $PROD_SSH:$PROD_DIR (ключ $PROD_KEY)"

echo "=== Настройка SMTP на $PROD_SSH:$PROD_DIR ==="
echo "Пустое значение = оставить как в подсказке [в скобках]."
echo
read -rp "SMTP_HOST [smtp.gmail.com]: " SMTP_HOST
SMTP_HOST="${SMTP_HOST:-smtp.gmail.com}"

read -rp "SMTP_PORT [587, для SSL используйте 465]: " SMTP_PORT
SMTP_PORT="${SMTP_PORT:-587}"

read -rp "SMTP_USER (логин, обычно полный адрес) [nyuskov@gmail.com]: " SMTP_USER
SMTP_USER="${SMTP_USER:-nyuskov@gmail.com}"

read -rsp "SMTP_PASSWORD (пароль приложения, ввод скрыт): " SMTP_PASSWORD
echo
[[ -n "$SMTP_PASSWORD" ]] || die "пароль пустой — отменяю"

read -rp "SMTP_FROM (адрес отправителя) [$SMTP_USER]: " SMTP_FROM
SMTP_FROM="${SMTP_FROM:-$SMTP_USER}"

read -rp "SMTP_FROM_NAME [Pismo]: " SMTP_FROM_NAME
SMTP_FROM_NAME="${SMTP_FROM_NAME:-Pismo}"

# 465 — неявный TLS, 587 — STARTTLS.
if [[ "$SMTP_PORT" == "465" ]]; then
    SMTP_STARTTLS="false"
    SMTP_SSL="true"
else
    SMTP_STARTTLS="true"
    SMTP_SSL="false"
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

CURRENT="$TMP_DIR/env.current"
NEW="$TMP_DIR/env.new"
remote "cat $PROD_DIR/.env" > "$CURRENT" || die "не удалось прочитать .env на сервере"

# Убираем прежние SMTP_* и дописываем новые (остальные строки не трогаем).
{
    grep -v '^SMTP_' "$CURRENT" || true
    echo ""
    echo "# --- E-mail-канал (добавлено configure_smtp_on_prod.sh $(date '+%Y-%m-%d %H:%M')) ---"
    echo "SMTP_HOST=$SMTP_HOST"
    echo "SMTP_PORT=$SMTP_PORT"
    echo "SMTP_USER=$SMTP_USER"
    echo "SMTP_PASSWORD=$SMTP_PASSWORD"
    echo "SMTP_FROM=$SMTP_FROM"
    echo "SMTP_FROM_NAME=$SMTP_FROM_NAME"
    echo "SMTP_STARTTLS=$SMTP_STARTTLS"
    echo "SMTP_SSL=$SMTP_SSL"
} > "$NEW"

echo
echo "=== Изменения в .env (пароль замаскирован) ==="
diff <(grep -v '^SMTP_' "$CURRENT" || true) <(grep -v '^SMTP_' "$NEW" || true) >/dev/null \
    || echo "(прочие строки .env не меняются)"
grep '^SMTP_' "$NEW" | sed -E 's/^(SMTP_PASSWORD=).*/\1***/'
echo

if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "--- dry-run: на сервере ничего не менялось ---"
    exit 0
fi

read -rp "Записать это в $PROD_DIR/.env и перезапустить web/worker? [y/N]: " CONFIRM
[[ "$CONFIRM" =~ ^[Yy]$ ]] || { echo "Отменено."; exit 0; }

STAMP="$(date +%Y%m%d_%H%M%S)"
remote "cp $PROD_DIR/.env $PROD_DIR/.env.bak.$STAMP && chmod 600 $PROD_DIR/.env.bak.$STAMP" \
    || die "не удалось сделать бэкап .env"

# Заливаем новый файл целиком (пароль уже внутри) и закрываем права.
remote_in "cat > $PROD_DIR/.env.new && chmod 600 $PROD_DIR/.env.new && mv $PROD_DIR/.env.new $PROD_DIR/.env" \
    < "$NEW" || die "не удалось записать .env"

echo "==> .env обновлён (бэкап: .env.bak.$STAMP)"
echo "==> Перезапускаю web и worker…"
compose "up -d --force-recreate web worker" || die "не удалось перезапустить контейнеры"

echo "==> Жду запуск и проверяю канал…"
sleep 10
remote "curl -s -m 10 http://127.0.0.1/api/v1/auth/channels/ 2>/dev/null || true"
echo
echo
echo "=== Готово ==="
echo "Если в ответе выше email_otp_available: true — канал включён:"
echo "  • в профиле появится кнопка «Отправить код на e-mail» (подтверждение адреса);"
echo "  • на экране входа — «Войти по коду на e-mail» и «Забыли пароль?»."
echo "Если письмо не пришло — смотри лог воркера:"
echo "  ssh -i $PROD_KEY $PROD_SSH \"cd $PROD_DIR && docker compose -p $PROD_PROJECT -f $PROD_COMPOSE_FILE logs --tail=50 worker\""
