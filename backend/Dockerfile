# Use a alpine Python image
FROM python:3.13-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy the application code
COPY ./backend .

# Install dependencies
RUN pip install poetry && poetry install --no-root

# Expose the port your FastAPI app listens on
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