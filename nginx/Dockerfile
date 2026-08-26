FROM nginx:alpine

# Copy the custom dev nginx configuration as the default one for this context
COPY ./nginx/dev.conf /etc/nginx/conf.d/default.conf

# Nginx will serve files from /usr/share/nginx/html, which is standard.
# We expect the 'frontend/dist' directory to be mounted here via docker-compose for development.
# No need to copy frontend files here anymore.

EXPOSE 80

# ENTRYPOINT ["nginx", "-g", "daemon off;"]