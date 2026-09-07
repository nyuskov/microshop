# Продакшен-развёртывание (starting point)

> Это отправная точка: реальный прод потребует домен, TLS-сертификаты, правильные
> секреты и (желательно) off-site бэкапы (см. docs/offsite-backup.md).

## Файлы

| Файл | Назначение |
|---|---|
| `docker-compose.prod.yaml` | прод-стек: `db`, одноразовый `migrate`, `web` (без reload/bind), `frontend` (vite build + nginx) |
| `frontend/Dockerfile.prod` | многоступенчатая сборка фронта + nginx-раздача |
| `frontend/nginx.prod.conf` | SPA + прокси `/api` (включая WebSocket) и `/media` на `web:8000` |

Архитектура прод-версии: **nginx терминирует внешний трафик** (статик + прокси на
`web`), поэтому бэкенд поднимается на внутреннем HTTP (без self-signed TLS из dev).

## Запуск

```bash
# 1. Секреты (корневой .env): POSTGRES_PASSWORD, JWT_SECRET_KEY
# 2. Публичный origin фронтенда (тот же, что отдаёт nginx)
export VITE_API_ORIGIN=http://localhost   # или https://chat.example.com после TLS

docker compose -f docker-compose.prod.yaml up -d --build
```

Проверки: `curl http://localhost/api/v1/health` → `{"status":"ok"}`;
`curl http://localhost/` → index.html приложения.

## Что важно для боевого прода

- **TLS**: добавьте в `frontend/nginx.prod.conf` server на 443 с сертификатами
  (Let's Encrypt) и редирект 80 → 443; тогда `VITE_API_ORIGIN=https://<host>`.
- **Медиа**: том `media_data`; не забывайте про резервные копии и очистку сирот
  (`poetry run python -m scripts.cleanup_orphan_media`).
- **Секреты**: никогда не хранить в git; ротация через `.env`.
- **WebSocket**: nginx уже проксирует с Upgrade — звонки и события работают.
- **Масштабирование**: in-memory rate limiter и WebSocket-менеджеры рассчитаны на
  1 инстанс `web`; при горизонтальном масштабе нужен Redis/общий стор.
