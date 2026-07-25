# Build context is the REPOSITORY ROOT (see docker-compose*.yml / CI):
#   docker build -f backend/Dockerfile .
# This lets the image install strictly from the single root package-lock.json.
FROM node:22.23-alpine AS base

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

WORKDIR /app

# Install dependencies strictly from the root lockfile (single source of truth).
# Copy the root manifests + every workspace manifest referenced by the lockfile
# so `npm ci` can validate the tree, then install only the backend workspace.
FROM base AS deps
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN npm ci --workspace=backend --include-workspace-root=false

# Build the application
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
COPY backend ./backend

# Generate Prisma Client (into the hoisted node_modules) then compile TypeScript.
RUN npm run prisma:generate --workspace=backend
RUN npm run build --workspace=backend

# Production image
FROM base AS runner
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 expressjs

# Hoisted node_modules (includes the generated Prisma client), the compiled
# output, the backend manifest, and the Prisma schema (compose runs
# `npx prisma db push` on start).
COPY --from=builder --chown=expressjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=expressjs:nodejs /app/backend/dist ./backend/dist
COPY --from=builder --chown=expressjs:nodejs /app/backend/package.json ./backend/package.json
COPY --from=builder --chown=expressjs:nodejs /app/backend/prisma ./backend/prisma

USER expressjs

WORKDIR /app/backend
EXPOSE 3001

CMD ["npm", "start"]
