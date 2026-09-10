# Продакшен-развёртывание (starting point)

> Это отправная точка: реальный прод потребует домен, TLS-сертификаты, правильные
> секреты и (желательно) off-site бэкапы (см. docs/offsite-backup.md).

## Файлы

| Файл | Назначение |
|---|---|
| `docker-compose.prod.yaml` | прод-стек: `db`, одноразовый `migrate`, `web` (без reload/bind), `rabbitmq`, `worker` (Celery), `beat` (периодика), `frontend` (nginx) |
| `frontend/Dockerfile.dist` | сборка статики (`vite build`) — «поставщик» файлов для тома |
| `frontend/Dockerfile.nginx` | nginx-раздача (конфиг без статики: она в томе) |
| `frontend/nginx.prod.conf` | SPA + прокси `/api` (включая WebSocket) и `/media` на `web:8000` |
| `scripts/ci/deploy_remote.sh` | деплой на сервере по шагам, без простоя |

Архитектура прод-версии: **nginx терминирует внешний трафик** (статик + прокси на
`web`), поэтому бэкенд поднимается на внутреннем HTTP (без self-signed TLS из dev).

## Деплой без простоя (боевой сервер)

Деплой запускается сам: GitHub Actions при пуше в `main` (job `deploy`) делает на
сервере `git reset --hard origin/main` и запускает `scripts/ci/deploy_remote.sh`.
Скрипт намеренно НЕ делает `up --force-recreate` (это пересоздавало всё, включая
базу, и сайт пропадал на 1–2 минуты), а обновляет по шагам:

1. уборка контейнеров, оставшихся от прерванного деплоя (иначе конфликт имён);
2. `docker compose build` — сборка образов без трогания работающих контейнеров;
3. **статика фронтенда**: одноразовый сервис `frontend-dist` копирует свежий
   `dist` в том `frontend_html`, из которого читает рабочий nginx. Контейнер
   nginx НЕ пересоздаётся — интерфейс не пропадает;
4. инфраструктура (`db`, `rabbitmq`, `coturn`, `certbot`) — только если изменилась;
5. `migrate` (одноразовый контейнер);
6. `web`, `worker`, `beat` — по одному сервису, с ожиданием `healthy` у `web`;
7. nginx пересоздаётся только если изменился его образ (правка `Dockerfile.nginx`
   или `nginx.prod.conf`), иначе просто `nginx -s reload`;
8. проверки: ревизия alembic совпадает с ожидаемой и `https://127.0.0.1/api/v1/health`
   отвечает 200. Снаружи затем проверяет job `smoke`.

Почему так можно: `index.html` отдаётся с `expires -1` (без кэша), а файлы в
`/assets/` имеют в имени хэш содержимого — поэтому подмена файлов в томе
подхватывается браузером сразу и не ломает открытые вкладки.

Две вещи, которые надо помнить:

- **не пушить, пока предыдущий деплой не завершился.** В workflow стоит
  `concurrency`, поэтому второй прогон подождёт, но лучше не полагаться на это;
- во время деплоя пересоздаются `web`/`worker`/`beat`, поэтому API доступно с
  короткими (доли секунды) перебоями; интерфейс и сайт при этом работают.

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
