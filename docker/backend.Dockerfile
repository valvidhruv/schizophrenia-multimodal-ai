# docker/backend.Dockerfile
# Multi-stage build for Node.js/Express backend

# -------------------------------------------
# Base stage - shared dependencies
# -------------------------------------------
FROM node:20-alpine AS base

WORKDIR /app

# Install system dependencies
RUN apk add --no-cache \
    postgresql-client \
    redis \
    curl \
    bash

# -------------------------------------------
# Dependencies stage
# -------------------------------------------
FROM base AS deps

COPY backend/package*.json ./

# Prisma is intentionally not installed yet (Phase 1 has no database client).
# Re-add `COPY backend/prisma ./prisma/` and `RUN npx prisma generate` in the
# database phase, together with the prisma dependency in backend/package.json.

RUN npm ci --include=dev

# -------------------------------------------
# Development stage
# -------------------------------------------
FROM base AS development

ENV NODE_ENV=development

COPY --from=deps /app/node_modules ./node_modules
COPY backend/ ./

EXPOSE 3001

CMD ["npm", "run", "dev"]

# -------------------------------------------
# Build stage
# -------------------------------------------
FROM base AS builder

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY backend/ ./

RUN npm run build
RUN npm prune --omit=dev

# -------------------------------------------
# Production stage
# -------------------------------------------
FROM base AS production

ENV NODE_ENV=production

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

WORKDIR /app

COPY --from=builder --chown=nextjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json

USER nextjs

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3001/api/health || exit 1

CMD ["node", "dist/main.js"]