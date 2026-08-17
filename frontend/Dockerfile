# ── build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL

COPY package.json package-lock.json* yarn.lock* ./
RUN npm install

COPY . .
RUN npm run build

# ── serve ──────────────────────────────────────────────────────────
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

# Fly injects PORT; nginx template uses 8080 by default — entrypoint rewrites
ENV PORT=8080
EXPOSE 8080

# Substitute listen port from $PORT at start
CMD sh -c "sed -i \"s/listen 8080/listen ${PORT}/\" /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"
