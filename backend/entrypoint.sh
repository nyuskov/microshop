#!/bin/bash
set -e

# Ожидаем, пока PostgreSQL не будет готов принимать подключения
# Адрес 'db' должен быть доступен из контейнера web благодаря настройке сети.
echo "Ждем запуска PostgreSQL на $DATABASE_URL..."
while ! poetry run python -c "import asyncio; from sqlalchemy.ext.asyncio import create_async_engine; engine = create_async_engine('$DATABASE_URL'); asyncio.run(engine.dispose())"; do
  sleep 1
done
echo "PostgreSQL запущен."

# Выполняем миграции Alembic
echo "Выполняем миграции Alembic..."
poetry run alembic upgrade head

# Запускаем основное приложение
echo "Запускаем Uvicorn..."
exec "$@"