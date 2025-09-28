# Use a alpine Python image
FROM python:3.13-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy the requirements file and install dependencies
COPY pyproject.toml .
RUN pip install poetry && poetry install 

# Copy the application code
COPY . .

# Expose the port your Tornado app listens on
EXPOSE 8888

# Command to run the application when the container starts
CMD ["python", "backend/main.py"]



