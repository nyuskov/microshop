# Используем alpine Python
FROM python:3.13-alpine

WORKDIR /app

# Не-root пользователь (uid 1000 совпадает с uid хоста, чтобы dev-том ./backend:/app
# оставался доступным на запись; медиа/кеши пишутся не от root).
RUN addgroup -S -g 1000 microshop \
    && adduser -S -u 1000 -G microshop -h /home/microshop microshop

# Венв и кеш poetry — в домашнем каталоге пользователя (НЕ в /app: /app в dev
# перекрывается bind-томом хоста).
ENV HOME=/home/microshop \
    POETRY_CACHE_DIR=/home/microshop/.cache/pypoetry \
    POETRY_VIRTUALENVS_PATH=/home/microshop/.cache/pypoetry/virtualenvs

# Сначала зависимости — для кеширования слоёв
COPY ./backend/pyproject.toml ./backend/poetry.lock ./
RUN pip install --no-cache-dir poetry \
    && poetry install --no-root --no-interaction

# Код приложения
COPY ./backend .

# Даём пользователю писать в media (сообщения/аватары)
RUN mkdir -p /app/media/avatars \
    && chown -R microshop:microshop /home/microshop /app/media

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