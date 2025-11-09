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

# run entrypoint.sh
ENTRYPOINT ["/app/entrypoint.sh"]

# Command to run the application when the container starts
CMD ["poetry", "run", "gunicorn", "--workers", "4", "--worker-class", "uvicorn.workers.UvicornWorker", "main:app", "--bind", "0.0.0.0:8000", "--keyfile", "./certificates/server.key", "--certfile", "./certificates/server.crt"]
# poetry run gunicorn --workers 1 --worker-class uvicorn.workers.UvicornWorker main:app --bind 0.0.0.0:8000 --keyfile ./certificates/server.key --certfile ./certificates/server.crt


