# SmartEdge frontend — multi-stage build for Fly.io
# Build: fly deploy --build-arg VITE_API_URL=https://YOUR-API.fly.dev

# ── stage 1: build SPA ─────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

# Vite lives in devDependencies — must NOT set NODE_ENV=production
# before npm install or the build toolchain is skipped.
ARG VITE_API_URL=https://smartedge-api.fly.dev
ENV VITE_API_URL=$VITE_API_URL

COPY package.json package-lock.json* ./
RUN npm install --include=dev

COPY index.html vite.config.js postcss.config.js tailwind.config.js ./
COPY public ./public
COPY src ./src

RUN npm run build

# ── stage 2: static nginx ──────────────────────────────────────────
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

# Fly http_service.internal_port must match this
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
