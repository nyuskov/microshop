# WebRTC-звонки: TURN-сервер

По умолчанию фронтенд использует публичные STUN Google (`stun.l.google.com:19302`,
`stun1.l.google.com:19302`) — они позволяют установить соединение в большинстве
сетей. **За «симметричным» NAT (корпоративные сети, многие мобильные операторы)
STUN не поможет** — нужен TURN-сервер (ретрансляция медиа через сервер).

## Настройка

ICE-серверы централизованы в `frontend/src/config.ts` и переопределяются через
переменную окружения `VITE_ICE_SERVERS` (JSON-массив `RTCIceServer[]`).

Пример для локального coturn (запущен на хосте `turn.example.com`):

```bash
# frontend/.env
VITE_ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example.com:3478","username":"microshop","credential":"secret"}]
```

После изменения `.env` нужно перезапустить Vite.

## Минимальный coturn (docker-compose)

```yaml
# Добавьте сервис в прод-compose (порт 3478/udp+tcp и 5349 для TLS).
  coturn:
    image: coturn/coturn:latest
    restart: unless-stopped
    network_mode: host   # coturn лучше слушать на хосте (нужны реальные IP в SDP)
    command: >
      -n --log-file=stdout
      --min-port=49160 --max-port=49200
      --realm=turn.example.com
      --user=microshop:secret
      --fingerprint
      --lt-cred-mech
      --no-cli
    ports:
      - "3478:3478/udp"
      - "3478:3478/tcp"
      - "49160-49200:49160-49200/udp"
```

- Секрет TURN держите в `.env` и передавайте в `VITE_ICE_SERVERS` (при сборке
  фронтенда Vite подставляет значения на этапе сборки).
- Для продакшена обязательно TLS (5349/tcp) и `--cert`/`--pkey` или TLS-терминация
  на уровне nginx не подходит для coturn — нужен собственный сертификат.

## Проверка

В консоли браузера:

```js
new RTCPeerConnection({ iceServers: JSON.parse(import.meta.env.VITE_ICE_SERVERS ?? '[]') })
```
