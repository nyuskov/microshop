# WebRTC-звонки: TURN-сервер

Коротко про схему: STUN даёт клиенту знать свой внешний адрес, TURN **ретранслирует**
медиа, когда напрямую соединиться нельзя (симметричный NAT, корпоративные сети,
часть мобильных операторов). Без TURN такие звонки «соединяются», но остаются без
звука и видео.

## Как это устроено сейчас

1. Фронтенд **не хранит TURN-креды**. Перед звонком он запрашивает список
   ICE-серверов у бэкенда: `GET /api/v1/calls/ice-servers/` (нужен токен).
2. Бэкенд (`api_v1/calls/turn.py`) выдаёт публичный STUN и TURN с **временными**
   кредами: `username = "<unix-время истечения>:<id пользователя>"`,
   `credential = base64(HMAC-SHA1(TURN_SECRET, username))`.
3. coturn запущен с `--use-auth-secret --static-auth-secret=$TURN_SECRET` и сам
   проверяет подпись и срок — отдельная база пользователей не нужна.
4. Если бэкенд недоступен, фронтенд берёт фолбэк из `VITE_ICE_SERVERS`
   (по умолчанию — только STUN): звонок важнее свежих кредов.

Почему так, а не статическим паролем: статический логин/пароль попадал в бандл, а
значит его мог вытащить любой — и гонять через наш релей чужой трафик (это трафик и
деньги). Временные креды живут `TURN_TTL_SECONDS` (по умолчанию час) и привязаны к
пользователю; в логах coturn видно, чьи это были креды.

## Переменные окружения (файл `.env` рядом с compose)

```bash
# Адреса TURN. Один или несколько через запятую (несколько — одним списком отдаём).
TURN_URLS=turn:176.108.249.9:3478?transport=udp,turn:176.108.249.9:3478?transport=tcp
# Общий секрет для временных кредов. Сгенерировать: openssl rand -hex 32
TURN_SECRET=<секрет>
TURN_REALM=pismo.space
TURN_TTL_SECONDS=3600
```

`TURN_USERNAME` / `TURN_PASSWORD` больше не используются — их можно удалить из
`.env`. Отдельно: **вычистите старый `VITE_ICE_SERVERS` из `frontend/.env`** на
сервере, если там были `turn:...` с логином и паролем: переменные Vite
подставляются в бандл на этапе сборки, то есть секрет попал бы в JS-файл.

## Сервис coturn в проде (`docker-compose.test.yaml`)

```yaml
  coturn:
    image: coturn/coturn:4.6
    restart: unless-stopped
    network_mode: host   # нужны реальные адреса в SDP
    command:
      - -n
      - --log-file=stdout
      - --min-port=49160
      - --max-port=49200
      - --realm=${TURN_REALM:-pismo.space}
      - --use-auth-secret
      - --static-auth-secret=${TURN_SECRET:?TURN_SECRET is required}
      - --fingerprint
      - --lt-cred-mech
      - --no-cli
      - --no-tls
      - --no-dtls
      - --external-ip=176.108.249.9
```

Наружу должны быть открыты: **3478/udp**, **3478/tcp** и релейный диапазон
**49160-49200/udp** (в security group облака; на самом сервере правил ufw нет).

## TURNS (TLS для TURN) — что нужно, чтобы включить

Сейчас TURN работает без TLS: медиапоток и так шифруется сквозным DTLS-SRTP, а
креды теперь короткоживущие. Если захотите защитить и служебный канал TURN:

1. В security group открыть **5349/tcp** (сейчас порт закрыт снаружи — проверено).
2. В команде coturn в `docker-compose.test.yaml` раскомментировать:

   ```yaml
      - --tls-listening-port=5349
      - --cert=/etc/letsencrypt/live/pismo.space/fullchain.pem
      - --pkey=/etc/letsencrypt/live/pismo.space/privkey.pem
   ```

   (сертификаты уже проброшены в контейнер: `certbot_etc:/etc/letsencrypt:ro`)
3. Добавить адрес в `.env`:
   `TURN_URLS=...,turns:176.108.249.9:5349?transport=tcp`
4. Проверить, что порт реально доступен снаружи, — иначе клиенты будут получать
   недостижимого кандидата и терять время на его проверку.

## Проверка, что всё живо

Временные креды для теста (сам секрет при этом не печатается):

```bash
# на сервере, в каталоге compose
SECRET=$(grep -m1 '^TURN_SECRET=' .env | cut -d= -f2-)
EXP=$(( $(date +%s) + 600 ))
USER_ID="$EXP:1"
CRED=$(printf '%s' "$USER_ID" | openssl dgst -binary -sha1 -hmac "$SECRET" | base64)
echo "username=$USER_ID credential=$CRED"
```

Проверка аллокации эталонным клиентом coturn (он же проверяет подпись):

```bash
docker run --rm --network host coturn/coturn:4.6 \
  turnutils_uclient -u "$USER_ID" -w "$CRED" -e <внешний_ip_этого_хоста> -y \
  -n 1 -m 1 -z 200 -h -v turn:176.108.249.9:3478
```

Ожидаемо: `tot_recv_bytes` растёт, в логах coturn — allocation. Успех означает, что
секрет в `.env` совпадает с тем, что видит coturn, и схема кредов работает.

Через API то же видно так:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://pismo.space/api/v1/calls/ice-servers/   # 401 без токена
```

