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

# Command to run the application when the container starts
CMD ["poetry", "run", "uvicorn", "main:app", "--host", "0.0.0.0"]



