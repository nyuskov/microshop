# Локальный бэкап прод-сервера (в папку на своей машине)

Скрипт `scripts/backup/pull_prod_backup.sh` запускается **на локальной машине** и по ssh
выкачивает с прода всё, что нужно для восстановления. Работает по крону или вручную.

**Куда складывает:** `~/Документы/pismo_backup` (каталог `700`, можно задать `BACKUP_DIR`).

```
pismo_backup/
├── db/
│   ├── microshop_YYYYMMDD_HHMMSS.sql.gz   # дамп PostgreSQL (plain SQL + gzip)
│   └── latest.sql.gz -> …                  # симлинк на последний
├── media/
│   ├── media_YYYYMMDD_HHMMSS.tar.gz        # /app/media: вложения, аватары, GIF
│   └── latest.tar.gz -> …
├── misc/
│   ├── env_YYYYMMDD_HHMMSS.txt             # продовый .env (секреты, права 600)
│   ├── info_YYYYMMDD_HHMMSS.txt            # ревизия git, контейнеры, размеры
│   ├── latest_env.txt -> …
│   └── latest_info.txt -> …
└── logs/backup.log                          # журнал запусков
```

Ротация: `db` — последние 14 копий, `media` — 7, `misc` — 14 (меняется через
`KEEP_DB`, `KEEP_MEDIA`, `KEEP_MISC`).

## Установка по крону

```bash
./scripts/backup/install_local_cron.sh              # ежедневно в 04:15
CRON_SCHEDULE='0 */6 * * *' ./scripts/backup/install_local_cron.sh   # каждые 6 часов
```

Строка добавляется в **локальный** crontab с маркером `# pismo-prod-backup`
(повторный запуск скрипта заменяет её, дубликатов не появляется). Удалить:

```bash
crontab -l | grep -v '# pismo-prod-backup' | crontab -
```

Ключ `~/.ssh/id_rsa1` не защищён паролем, поэтому cron работает без ssh-агента —
это проверено (`env -u SSH_AUTH_SOCK ssh …`).

## Ручной запуск

```bash
./scripts/backup/pull_prod_backup.sh
```

Полезные переменные: `PROD_SSH` (user@host), `PROD_KEY`, `PROD_DIR` (`~/microshop`),
`PROD_PROJECT` (`microshop-test`), `PROD_COMPOSE_FILE`, `BACKUP_DIR`,
`REMOTE_MEDIA_PATH` (если media на сервере лежит не в контейнере `web:/app/media`).

Скрипт не оставляет «половинок»: каждый файл пишется как `.part`, проверяется
`gzip -t`, и только после этого переименовывается. Два одновременных запуска
исключены через `flock`. При ошибке скрипт возвращает код 1 и пишет `!!!` в лог.

## Проверить, что бэкап рабочий (важно!)

Дамп регулярно стоит проверять **восстановлением в отдельную БД** — иначе можно
годами хранить нерабочие копии:

```bash
docker compose -f docker-compose.yaml exec -T db \
  psql -U postgres -c "DROP DATABASE IF EXISTS backup_check;" \
                 -c "CREATE DATABASE backup_check;"

gunzip -c ~/Документы/pismo_backup/db/latest.sql.gz | \
  docker compose -f docker-compose.yaml exec -T db psql -U postgres -d backup_check -q

# сверить с продом (число пользователей, ревизия миграций):
docker compose -f docker-compose.yaml exec -T db psql -U postgres -d backup_check \
  -c 'select count(*) from "user";' -c 'select version_num from alembic_version;'
```

Так проверялся бэкап от 10.09.2026: дамп восстановился без ошибок, `users=5`,
`alembic_version=e3f4a5b6c7d8` — ровно как на проде.

## Восстановление на прод (если понадобится)

```bash
# 1) на сервере остановить web/worker, чтобы никто не писал в БД
ssh user1@176.108.249.9 "cd ~/microshop && docker compose -p microshop-test \
  -f docker-compose.test.yaml stop web worker beat"

# 2) залить дамп в БД (перезапись): DROP SCHEMA + восстановление
gunzip -c db/microshop_….sql.gz | ssh user1@176.108.249.9 \
  "cd ~/microshop && docker compose -p microshop-test -f docker-compose.test.yaml \
   exec -T db psql -U postgres -d microshop -v ON_ERROR_STOP=1"

# 3) media: распаковать в volume media_data
gunzip -c media/media_….tar.gz | ssh user1@176.108.249.9 \
  "cd ~/microshop && docker compose -p microshop-test -f docker-compose.test.yaml \
   exec -T web tar xzf - -C /app/media"

# 4) поднять сервисы обратно
ssh user1@176.108.249.9 "cd ~/microshop && docker compose -p microshop-test \
  -f docker-compose.test.yaml up -d"
```

`.env` из `misc/` нужен, если восстанавливается машина целиком: положить его в
`~/microshop/.env` (права 600) до `up -d`.

## Что дополнительно уже есть на сервере

- `dump_db.sh` / `cron_dump_db.sh` + `install_cron_backup.sh` — дамп БД и media
  **на самом сервере** (`~/microshop/db_dump`), ротация 30 копий.
- `docs/offsite-backup.md` — вывоз копий на внешнее хранилище.

Локальный скрипт из этой инструкции дополняет их: даже если сервер потеряется
целиком, база, медиа и `.env` останутся на личной машине.
