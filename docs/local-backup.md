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
./scripts/backup/install_local_cron.sh              # ежедневно в 04:15 + догоняющий при включении
CRON_SCHEDULE='0 */6 * * *' ./scripts/backup/install_local_cron.sh   # каждые 6 часов
```

Ставятся ДВЕ строки с маркерами `# pismo-prod-backup` и
`# pismo-prod-backup-catchup` (повторный запуск скрипта заменяет их, дубликатов не
появляется). Вторая — `@reboot` → `scripts/backup/backup_if_stale.sh`: **cron не
повторяет пропущенные задачи**, а ночью компьютер обычно выключен, поэтому ночной
бэкап пропускался бы целиком. Проверено 20.09.2026: последняя копия была от 17.09,
в логах мониторинга в 04:xx пусто (машина спала), и за три дня не снялось ни одной
копии; при этом мониторинг сам напоминал («последний дамп БД старше 26 ч»).

Догоняющий скрипт смотрит на возраст свежего `db/microshop_*.sql.gz`: старше
`STALE_HOURS` (по умолчанию 20) — снимает бэкап, свежее — молчит. Поэтому `@reboot`
не плодит копии при каждой перезагрузке. Проверить решению без работы:

```bash
./scripts/backup/backup_if_stale.sh --check
```

Удалить:

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
годами хранить нерабочие копии. Автоматически это делает
`scripts/backup/verify_prod_backup.sh` (локальный cron по воскресеньям, 12:00 —
днём машина точно включена, а в 05:00 cron пропуск не повторяет,
`install_verify_cron.sh`): льёт последний дамп по ssh прямо в `psql` на
прод-сервере в базу `microshop_verify`, проверяет целостность архива, отсутствие
ошибок восстановления, ревизию alembic, наличие аккаунтов и таблиц, затем удаляет
временную БД (в том числе при ошибке). Провал → письмо по SMTP и запись в
`logs/verify.log`.

```bash
./scripts/backup/verify_prod_backup.sh              # проверить сейчас
./scripts/backup/verify_prod_backup.sh --dry-run    # план без работы
./scripts/backup/verify_prod_backup.sh --no-alert   # без письма при провале
```

Проверено 10.09.2026: `rev=e3f4a5b6c7d8 user=5 chats=13 messages=9 tables=18`,
обнаружение повреждённого архива (выход 1) — тоже проверено.

Если проверка запускается в момент деплоя (контейнеры на проде пересоздаются),
скрипт делает 3 попытки с паузой 20 с — деплой не считается провалом бэкапа.

Проверка вручную (то же самое, но на локальном dev-стеке):

```bash
docker compose -f docker-compose.yaml exec -T db \
  psql -U postgres -c "DROP DATABASE IF EXISTS backup_check;" \
                 -c "CREATE DATABASE backup_check;"

gunzip -c ~/Документы/pismo_backup/db/latest.sql.gz | \
  docker compose -f docker-compose.yaml exec -T db psql -U postgres -d backup_check -q

# посмотреть, что внутри (число пользователей, ревизия миграций):
docker compose -f docker-compose.yaml exec -T db psql -U postgres -d backup_check \
  -c 'select count(*) from "user";' -c 'select version_num from alembic_version;'
```

Критерий проверки — «копия восстановилась и не пустая», а не «равна текущему
проду»: прод продолжает жить (новые сообщения и миграции), поэтому сравнение с
текущими данными давало бы ложные тревоги.

## Восстановление на прод (если понадобится)

```bash
# 1) на сервере остановить web/worker, чтобы никто не писал в БД
ssh user1@176.108.249.9 "cd ~/microshop && docker compose -p microshop-test \
  -f docker-compose.prod.yaml stop $(sh scripts/lib/web_slot.sh) worker beat"

# 2) залить дамп в БД (перезапись): DROP SCHEMA + восстановление
gunzip -c db/microshop_….sql.gz | ssh user1@176.108.249.9 \
  "cd ~/microshop && docker compose -p microshop-test -f docker-compose.prod.yaml \
   exec -T db psql -U postgres -d microshop -v ON_ERROR_STOP=1"

# 3) media: распаковать в volume media_data
gunzip -c media/media_….tar.gz | ssh user1@176.108.249.9 \
  "cd ~/microshop && docker compose -p microshop-test -f docker-compose.prod.yaml \
   exec -T $(sh scripts/lib/web_slot.sh) tar xzf - -C /app/media"

# 4) поднять сервисы обратно
ssh user1@176.108.249.9 "cd ~/microshop && docker compose -p microshop-test \
  -f docker-compose.prod.yaml up -d"
```

`.env` из `misc/` нужен, если восстанавливается машина целиком: положить его в
`~/microshop/.env` (права 600) до `up -d`.

## Что дополнительно уже есть на сервере

- `scripts/db/dump_db.sh` / `scripts/backup/cron_dump_db.sh` + `scripts/backup/install_server_cron.sh` — дамп БД и media
  **на самом сервере** (`~/microshop/db_dump`), ротация 30 копий.
- `docs/offsite-backup.md` — вывоз копий на внешнее хранилище + **шифрование**
  файлов перед отправкой (файл-пароль `BACKUP_PASSPHRASE_FILE`, AES-256 + PBKDF2).

### Секреты в локальных копиях

В `misc/env_*.txt` лежит продовый `.env` (пароль БД, JWT-секрет, ключи push),
в `db/*.sql.gz` — данные пользователей. Поэтому:

- папка бэкапов создаётся с правами `700`, файлы `.env` — `600` (скрипт делает это сам);
- если папка лежит в облачной синхронизации (Dropbox/Яндекс.Диск/OneDrive),
  включите шифрование хранилища или перенесите `BACKUP_DIR` на локальный диск —
  иначе секреты уезжают к провайдеру;
- перед передачей копии кому-то (или на флешку) шифруйте архив целиком:
  ```bash
  tar czf - db media misc | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 \
      -out pismo_backup_$(date +%F).tar.gz.enc -pass file:~/.pismo-backup-passphrase
  ```
- проверяйте работоспособность дампа по инструкции выше — зашифрованная и
  непроверенная копия хуже отсутствия копии.

Локальный скрипт из этой инструкции дополняет их: даже если сервер потеряется
целиком, база, медиа и `.env` останутся на личной машине.
