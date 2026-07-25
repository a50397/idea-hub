# Build context is the REPOSITORY ROOT (see docker-compose*.yml / CI):
#   docker build -f frontend/Dockerfile .
# This lets the image install strictly from the single root package-lock.json.
FROM node:22.23-alpine AS base

WORKDIR /app

# Install dependencies strictly from the root lockfile (single source of truth).
FROM base AS deps
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN npm ci --workspace=frontend --include-workspace-root=false

# Build the application
FROM base AS builder

# Accept build arguments
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
COPY frontend ./frontend

# Build the frontend
RUN npm run build --workspace=frontend

# Production image with NON-ROOT nginx. nginxinc/nginx-unprivileged runs as the
# unprivileged `nginx` user (uid 101) and listens on 8080 (see nginx.conf).
FROM nginxinc/nginx-unprivileged:1.25.5-alpine AS runner

# Copy built assets
COPY --from=builder /app/frontend/dist /usr/share/nginx/html

# Copy nginx configuration (server block listens on 8080)
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
