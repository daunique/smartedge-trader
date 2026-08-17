# syntax=docker/dockerfile:1
# SmartEdge Web — must listen on 0.0.0.0:8080 for Fly proxy

ARG NODE_VERSION=20
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app/frontend
ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --include=dev
COPY frontend/ ./
RUN npm run build

FROM nginx:1.27-alpine

# envsubst is in gettext package
RUN apk add --no-cache gettext

# Disable default server; we write our own
RUN rm -f /etc/nginx/conf.d/default.conf

COPY frontend/nginx.conf.template /etc/nginx/nginx.conf.template
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY frontend/docker-entrypoint.sh /smartedge-entrypoint.sh
RUN chmod +x /smartedge-entrypoint.sh

ENV BACKEND_URL=https://smartedge-api.fly.dev
EXPOSE 8080

# Override nginx image ENTRYPOINT so only our script runs
ENTRYPOINT ["/smartedge-entrypoint.sh"]
