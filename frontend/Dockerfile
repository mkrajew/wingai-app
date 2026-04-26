# build
FROM node:20-alpine AS build
WORKDIR /app/frontend
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# serve
FROM nginx:alpine
COPY --from=build /app/frontend/dist /usr/share/nginx/html
# Add .mjs MIME type so browsers can load ORT worker modules
RUN sed -i '/text\/javascript/s/js;/js mjs;/' /etc/nginx/mime.types
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]