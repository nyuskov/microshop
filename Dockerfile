# Use a alpine Python image
FROM python:3.11-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy the requirements file and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the application code
COPY . .

# Expose the port your Tornado app listens on
EXPOSE 8888

# Command to run the application when the container starts
CMD ["python", "main.py"]



