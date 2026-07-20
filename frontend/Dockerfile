# ============================================================================
# Frontend — React + TypeScript (Vite build → Nginx production server)
# ============================================================================

# ── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20 AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# ── Stage 2: Production (Nginx) ────────────────────────────────────────────
FROM nginx:stable-alpine

# Write a correct nginx config for Docker networking
# (replaces the repo's nginx.conf which has markdown syntax artifacts)
RUN cat > /etc/nginx/conf.d/default.conf <<'NGINXCONF'
server {
    listen 80;
    server_name localhost;

    root /usr/share/nginx/html;
    index index.html;

    client_max_body_size 500M;

    # SPA fallback — serve index.html for all frontend routes
    location / {
        try_files $uri /index.html;
    }

    # Reverse proxy — forward /api/* to the main_server Flask backend
    location /api/ {
        proxy_pass http://main_server:5000/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }
}
NGINXCONF

COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
