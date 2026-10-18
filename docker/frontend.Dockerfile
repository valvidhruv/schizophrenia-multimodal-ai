# docker/frontend.Dockerfile
# Multi-stage build for React/Vite frontend

# -------------------------------------------
# Base stage
# -------------------------------------------
FROM node:20-alpine AS base

WORKDIR /app

# Install system dependencies
RUN apk add --no-cache curl

# -------------------------------------------
# Dependencies stage
# -------------------------------------------
FROM base AS deps

COPY frontend/package*.json ./

RUN npm ci --include=dev

# -------------------------------------------
# Development stage
# -------------------------------------------
FROM base AS development

ENV NODE_ENV=development

COPY --from=deps /app/node_modules ./node_modules
COPY frontend/ ./

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]

# -------------------------------------------
# Build stage
# -------------------------------------------
FROM base AS builder

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY frontend/ ./

RUN npm run build

# -------------------------------------------
# Production stage - Nginx
# -------------------------------------------
FROM nginx:alpine AS production

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx config
COPY docker/nginx.frontend.conf /etc/nginx/conf.d/default.conf

# Create non-root user
RUN addgroup -g 1001 -S nginx && \
    adduser -S -D -H -u 1001 -h /var/cache/nginx -s /sbin/nologin -G nginx -g nginx nginx

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]