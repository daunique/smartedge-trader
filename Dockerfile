# syntax = docker/dockerfile:1
# SmartEdge Web — repo root build for Fly UI
ARG NODE_VERSION=20
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL
COPY frontend/package.json frontend/package-lock.json* ./frontend/
WORKDIR /app/frontend
RUN npm install --include=dev
COPY frontend/ ./
RUN npm run build

FROM nginx:1.27-alpine
COPY frontend/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY frontend/docker-entrypoint.sh /docker-entrypoint-smartedge.sh
RUN chmod +x /docker-entrypoint-smartedge.sh
ENV BACKEND_URL=https://smartedge-api.fly.dev
ENV PORT=8080
EXPOSE 8080
CMD ["/docker-entrypoint-smartedge.sh"]
