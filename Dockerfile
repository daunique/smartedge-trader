# syntax = docker/dockerfile:1
# SmartEdge Web — build from REPO ROOT (Fly.io UI / Git deploy)
# Internal port: 8080

ARG NODE_VERSION=20
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app

# Do NOT set NODE_ENV=production before install — vite is needed to build
ARG VITE_API_URL=https://smartedge-api.fly.dev
ENV VITE_API_URL=$VITE_API_URL

# Install frontend deps (including build toolchain)
COPY frontend/package.json frontend/package-lock.json* ./frontend/
WORKDIR /app/frontend
RUN npm install --include=dev

COPY frontend/ ./
RUN npm run build

# Static serve
FROM nginx:1.27-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
