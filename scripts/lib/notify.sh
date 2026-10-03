#!/usr/bin/env bash
# Общая часть оповещений по e-mail (SMTP) для служебных скриптов.
#
# Почему e-mail: Telegram недоступен ни с прод-сервера, ни из РФ-сетей
# (проверено), а SMS Aero без договора с операторами отклоняет все SMS.
#
# Настройки берутся по цепочке: окружение → локальный .env → копия продового
# .env в бэкапе → продовый .env по ssh. Так достаточно настроить SMTP один раз.
#
# Подключение (переменные ROOT/PROD_* должны быть уже заданы):
#   source "$ROOT/scripts/lib/notify.sh"
#   load_smtp_settings
#   smtp_configured || echo "нет канала"
#   smtp_send "Тема" "Текст"

# shellcheck shell=bash

# Читает значение ключа из файла вида KEY=value (первое совпадение).
read_env_key() {  # read_env_key <файл|""> <ключ>
    local file="$1" key="$2"
    [[ -n "$file" && -f "$file" ]] || return 1
    grep -m1 "^${key}=" "$file" | cut -d= -f2-
}

SMTP_HOST=""
SMTP_PORT="587"
SMTP_USER=""
SMTP_PASSWORD=""
SMTP_FROM=""
SMTP_STARTTLS="true"
SMTP_SSL="false"

load_smtp_settings() {
    local source="" key value
    for source in "" "$ROOT/.env" "${BACKUP_DIR:-$HOME/Документы/pismo_backup}/misc/latest_env.txt"; do
        [[ -n "$source" ]] || continue
        [[ -f "$source" ]] || continue
        if [[ -n "$(read_env_key "$source" SMTP_HOST || true)" ]]; then
            break
        fi
        source=""
    done

    if [[ -z "$source" ]]; then
        # Локально пусто — читаем продовый .env по ssh.
        local tmp
        tmp="$(mktemp)"
        if remote "cat $PROD_DIR/.env" > "$tmp" 2>/dev/null && [[ -s "$tmp" ]]; then
            source="$tmp"
        else
            rm -f "$tmp"
            return 0
        fi
    fi

    for key in SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASSWORD SMTP_FROM SMTP_STARTTLS SMTP_SSL; do
        value="$(read_env_key "$source" "$key" || true)"
        [[ -n "$value" ]] && printf -v "$key" '%s' "$value"
    done
}

smtp_configured() { [[ -n "$SMTP_HOST" && -n "$SMTP_FROM" ]]; }

# smtp_send <кому> <тема> <текст>; 0 — письмо отправлено.
smtp_send() {
    local to="$1" subject="$2" text="$3"
    smtp_configured || return 1

    python3 - "$SMTP_HOST" "$SMTP_PORT" "$SMTP_USER" "$SMTP_PASSWORD" \
        "$SMTP_FROM" "$to" "$SMTP_STARTTLS" "$SMTP_SSL" "$subject" "$text" <<'PY'
import smtplib, ssl, sys
from email.message import EmailMessage

host, port, user, password, sender, to, starttls, use_ssl, subject, text = sys.argv[1:11]
msg = EmailMessage()
msg["From"] = sender
msg["To"] = to
msg["Subject"] = subject
msg.set_content(text)

ctx = ssl.create_default_context()
if use_ssl == "true":
    server = smtplib.SMTP_SSL(host, int(port), timeout=20, context=ctx)
else:
    server = smtplib.SMTP(host, int(port), timeout=20)
with server:
    if use_ssl != "true" and starttls == "true":
        server.starttls(context=ctx)
    if user:
        server.login(user, password)
    server.send_message(msg)
PY
}
