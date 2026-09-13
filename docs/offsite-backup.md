# Off-site резервное копирование (БД + media)

Локальный cron-бэкап (`scripts/backup/cron_dump_db.sh`) пишет в `db_dump/` на том же хосте:
дамп БД (`microshop_latest.sql` + архив) и снимок медиафайлов
(`media_latest.tar.gz` + архив, см. `scripts/backup/backup_media.sh`). Это защита от потери
данных при `down -v`, но **не** от отказа диска/хоста. Для устойчивости
копируйте дампы в удалённое хранилище.

## Вариант: rclone + облачный бакет

1. Установите `rclone` и настройте удалённый `remote` (S3, Yandex, Google Drive и т.п.):
   ```bash
   rclone config   # создайте remote, например "backup:s3"
   ```
2. Скопируйте пример и отредактируйте переменные:
   ```bash
   cp scripts/backup/backup_offsite.example.sh scripts/backup/backup_offsite.sh
   chmod +x scripts/backup/backup_offsite.sh
   # в файле: RCLONE_REMOTE="backup:bucket/microshop", LOCAL_DUMP_DIR, ARCHIVE_SUBDIR
   ```
3. Добавьте в crontab (в дополнение к локальному дампу), например после локального:
   ```bash
   # локальный дамп ежедневно 03:00 (уже есть) + выгрузка в 03:30
   30 3 * * * /path/to/microshop/scripts/backup/backup_offsite.sh >> /path/to/microshop/db_dump/logs/offsite.log 2>&1
   ```
   Установка одной командой через установщик cron (флаг `CRON_SCRIPT`):
   ```bash
   CRON_SCHEDULE='30 3 * * *' CRON_SCRIPT='/path/to/microshop/scripts/backup/backup_offsite.sh' ./scripts/backup/install_server_cron.sh
   ```
   (или добавьте строку вручную через `crontab -e`).

Скрипт выгружает последний локальный дамп + последние N архивных копий и пишет лог.

## Шифрование копий (включено по умолчанию, если есть файл-пароль)

Дамп БД и медиа — это личные данные людей (переписка, телефоны, фото, файлы).
В облачном бакете их читает любой, у кого есть доступ к бакету, поэтому наружу
файлы уезжают зашифрованными (AES-256-CBC + PBKDF2, `openssl`).

1. Один раз создайте файл с паролем (не передавайте пароль переменной
   окружения — он попадёт в `ps`, историю shell и логи):
   ```bash
   openssl rand -base64 32 > ~/.pismo-backup-passphrase
   chmod 600 ~/.pismo-backup-passphrase
   ```
   **Сохраните пароль в менеджере паролей**: без него резервные копии
   расшифровать невозможно, и это не «баг», а смысл шифрования.
2. Ничего больше делать не нужно: скрипт сам видит
   `~/.pismo-backup-passphrase` (или путь из `BACKUP_PASSPHRASE_FILE`) и выгружает
   файлы с расширением `.enc` — `microshop_latest.sql.enc`,
   `media_latest.tar.gz.enc` и т.д. В логе будет строка «Шифрование включено».
3. Если файла-пароля нет, выгрузка продолжается **как раньше** (открытыми
   файлами), но в лог пишется предупреждение — так cron не ломается молча.

Проверить вручную:
```bash
BACKUP_PASSPHRASE_FILE=~/.pismo-backup-passphrase ./scripts/backup/backup_offsite.sh
tail -3 db_dump/logs/offsite.log        # должно быть «Шифрование включено»
```

Расшифровать копию (на своей машине, где есть пароль):
```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
    -in microshop_latest.sql.enc -out microshop_latest.sql \
    -pass file:~/.pismo-backup-passphrase
gunzip -c media_latest.tar.gz.enc ...   # для медиа: сначала расшифровать, потом tar
```

Полезно знать:
- локальные копии в `db_dump/` остаются **незашифрованными** — они нужны для
  быстрого восстановления на самом сервере, а шифруются копии, уезжающие вовне;
- расшифровка большого дампа — обычный поток, дополнительного места на диске
  (кроме самого файла) не требует;
- ключ шифрования — единственный секрет: положите его копию туда, откуда сможете
  достать при мёртвом сервере (менеджер паролей, бумага в сейфе), но **не** на
  тот же сервер в открытом виде.
