# Off-site резервное копирование (БД + media)

Локальный cron-бэкап (`./cron_dump_db.sh`) пишет в `db_dump/` на том же хосте:
дамп БД (`microshop_latest.sql` + архив) и снимок медиафайлов
(`media_latest.tar.gz` + архив, см. `backup_media.sh`). Это защита от потери
данных при `down -v`, но **не** от отказа диска/хоста. Для устойчивости
копируйте дампы в удалённое хранилище.

## Вариант: rclone + облачный бакет

1. Установите `rclone` и настройте удалённый `remote` (S3, Yandex, Google Drive и т.п.):
   ```bash
   rclone config   # создайте remote, например "backup:s3"
   ```
2. Скопируйте пример и отредактируйте переменные:
   ```bash
   cp backup_offsite.example.sh backup_offsite.sh
   chmod +x backup_offsite.sh
   # в файле: RCLONE_REMOTE="backup:bucket/microshop", LOCAL_DUMP_DIR, ARCHIVE_SUBDIR
   ```
3. Добавьте в crontab (в дополнение к локальному дампу), например после локального:
   ```bash
   # локальный дамп ежедневно 03:00 (уже есть) + выгрузка в 03:30
   30 3 * * * /path/to/microshop/backup_offsite.sh >> /path/to/microshop/db_dump/logs/offsite.log 2>&1
   ```
   Установка одной командой с `install_cron_backup.sh`-стилем:
   ```bash
   CRON_SCHEDULE='30 3 * * *' CRON_SCRIPT='/path/to/microshop/backup_offsite.sh' ./install_cron_backup.sh
   ```
   (или добавьте строку вручную через `crontab -e`).

Скрипт выгружает последний локальный дамп + последние N архивных копий и пишет лог.
