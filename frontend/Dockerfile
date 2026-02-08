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
# Jeśli masz CRA, to zwykle /app/build zamiast /app/dist
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]