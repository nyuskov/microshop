# Используем alpine Python
FROM python:3.15-alpine

WORKDIR /app

# ffmpeg нужен приложению: по кодекам решаем, проиграет ли видео браузер, и
# непроигрываемое перекодируем в H.264/AAC (core/video_transcode.py), — иначе
# старая запись с телефона превращается в чёрный экран истории.
RUN apk add --no-cache ffmpeg

# Не-root пользователь (uid 1000 совпадает с uid хоста, чтобы dev-том ./backend:
# /app оставался доступным на запись; медиа/кеши пишутся не от root).
RUN addgroup -S -g 1000 microshop \
    && adduser -S -u 1000 -G microshop -h /home/microshop microshop

# Венв и кеш poetry — в домашнем каталоге пользователя (НЕ в /app: /app в dev
# перекрывается bind-томом хоста). Poetry ставится в `~/.local/bin`, поэтому путь
# добавлен в PATH — им же пользуется команда контейнера (`poetry run …`).
ENV HOME=/home/microshop \
    PATH=/home/microshop/.local/bin:$PATH \
    POETRY_CACHE_DIR=/home/microshop/.cache/pypoetry \
    POETRY_VIRTUALENVS_PATH=/home/microshop/.cache/pypoetry/virtualenvs

# Зависимости ставим СРАЗУ от имени рабочего пользователя.
#
# Раньше венв ставился от root, а после копирования кода шёл `chown -R
# /home/microshop`: он переписывал весь венв в новый слой (замер на проде: 326 МБ
# и ~24 с на 2 CPU) — и это ПРИ КАЖДОЙ правке кода, потому что слой стоит после
# `COPY ./backend`. Теперь такого слоя нет вовсе, а сам венв читает тот же
# пользователь, от которого работает приложение.
USER microshop

# Сначала зависимости — для кеширования слоёв
COPY --chown=microshop:microshop ./backend/pyproject.toml ./backend/poetry.lock ./
RUN pip install --no-cache-dir --user poetry \
    && poetry install --no-root --no-interaction \
    # Кеш скачанных пакетов в образе не нужен: ~114 МБ (замер), нужен только для
    # установок, а установка здесь уже сделана. Венв остаётся.
    && rm -rf "$POETRY_CACHE_DIR/cache" "$POETRY_CACHE_DIR/artifacts"

# Код приложения
COPY --chown=microshop:microshop ./backend .

# Медиа пишет приложение (сообщения/аватары), поэтому каталог создаётся заранее и
# отдаётся пользователю: в проде он смонтирован томом, и том наследует владельца
# каталога из образа.
USER root
RUN mkdir -p /app/media/avatars && chown -R microshop:microshop /app/media
USER microshop

EXPOSE 8000

# Command to run the application when the container starts.
# Релоад включается по умолчанию для разработки (UVICORN_RELOAD=1) и отключается
# для «продового» запуска переменной UVICORN_RELOAD=0.
# Также ждём БД и выполняем миграции перед стартом.
CMD sh -c 'echo "Waiting for PostgreSQL on $DATABASE_URL..." && \
    while ! poetry run python -c "import asyncio; from sqlalchemy.ext.asyncio import create_async_engine; engine = create_async_engine(\"$DATABASE_URL\"); asyncio.run(engine.dispose())"; do \
      sleep 1; \
    done; \
    echo "PostgreSQL is up."; \
    echo "Running Alembic migrations..."; \
    poetry run alembic upgrade head; \
    echo "Starting Uvicorn..."; \
    RELOAD_FLAG=""; \
    if [ "${UVICORN_RELOAD:-1}" != "0" ]; then RELOAD_FLAG="--reload"; fi; \
    exec poetry run uvicorn main:app --host 0.0.0.0 --port 8000 $RELOAD_FLAG --ssl-keyfile=/app/certs/server.key --ssl-certfile=/app/certs/server.crt'
