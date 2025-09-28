   # develop stage
   FROM node:lts-alpine AS develop-stage
   WORKDIR /app

   # Copy the package.json and install dependencies
   COPY ./frontend/package.json ./frontend/package-lock.json ./
   RUN npm install

   # Copy rest of the files
   COPY ./frontend/ .

   # Build the project
   RUN npm run build

   FROM nginx:alpine AS production-build
   COPY ./nginx/production.conf /etc/nginx/nginx.conf

   ## Remove default nginx index page
   RUN rm -rf /usr/share/nginx/html/*

   # Copy from the stage 1
   COPY --from=develop-stage /app/dist /usr/share/nginx/html

   EXPOSE 80
   # ENTRYPOINT ["nginx", "-g", "daemon off;"]
