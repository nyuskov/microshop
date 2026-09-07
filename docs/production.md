# Продакшен-развёртывание (starting point)

> Это отправная точка: реальный прод потребует домен, TLS-сертификаты, правильные
> секреты и (желательно) off-site бэкапы (см. docs/offsite-backup.md).

## Файлы

| Файл | Назначение |
|---|---|
| `docker-compose.prod.yaml` | прод-стек: `db`, одноразовый `migrate`, `web` (без reload/bind), `rabbitmq`, `worker` (Celery), `beat` (периодика), `frontend` (vite build + nginx) |
| `frontend/Dockerfile.prod` | многоступенчатая сборка фронта + nginx-раздача |
| `frontend/nginx.prod.conf` | SPA + прокси `/api` (включая WebSocket) и `/media` на `web:8000` |

Архитектура прод-версии: **nginx терминирует внешний трафик** (статик + прокси на
`web`), поэтому бэкенд поднимается на внутреннем HTTP (без self-signed TLS из dev).

## Запуск

```bash
# 1. Секреты (корневой .env): POSTGRES_PASSWORD, JWT_SECRET_KEY,
#    RABBITMQ_USER, RABBITMQ_PASSWORD
# 2. Публичный origin фронтенда (тот же, что отдаёт nginx)
export VITE_API_ORIGIN=http://localhost   # или https://chat.example.com после TLS

docker compose -f docker-compose.prod.yaml up -d --build
```

Проверки: `curl http://localhost/api/v1/health` → `{"status":"ok"}`;
`curl http://localhost/` → index.html приложения.

## Что важно для боевого прода

- **TLS**: добавьте в `frontend/nginx.prod.conf` server на 443 с сертификатами
  (Let's Encrypt) и редирект 80 → 443; тогда `VITE_API_ORIGIN=https://<host>`.
- **Медиа**: том `media_data` шарится между `web` и `worker` (worker пишет GIF-
  файлы, web отдаёт через `/media` и раздаёт realtime). Не забывайте про бэкапы;
  очистка сирот теперь автоматическая (celery beat, ежедневно), но доступен и
  ручной запуск (`poetry run python -m scripts.cleanup_orphan_media --delete`).
- **RabbitMQ/Celery**: воркер исполняет фоновые задачи (SMS/OTP, GIF, уведомления);
  `beat` — периодику. Том `rabbitmq_data` хранит состояние брокера. Порт наружу
  не публикуется (внутренние подключения по compose-сети).
- **Секреты**: никогда не хранить в git; ротация через `.env`.
- **WebSocket**: nginx уже проксирует с Upgrade — звонки и события работают.
- **Масштабирование**: in-memory rate limiter и WebSocket-менеджеры рассчитаны на
  1 инстанс `web`; при горизонтальном масштабе нужен Redis/общий стор (а
  realtime-мост RabbitMQ уже рассчитан на несколько реплик web).
