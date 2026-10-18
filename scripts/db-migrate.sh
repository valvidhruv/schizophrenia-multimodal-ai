#!/usr/bin/env bash
# scripts/db-migrate.sh - Run database migrations
#
# Prisma is NOT used in this project. Migrations are versioned SQL files in
# backend/migrations applied by backend/src/migrate.ts (pg-based runner).
#
# Usage:
#   scripts/db-migrate.sh          # apply pending migrations
#   scripts/db-migrate.sh up       # apply pending migrations
#   scripts/db-migrate.sh status   # show applied and pending migrations
set -e

cd "$(dirname "$0")/../backend"

case "${1:-up}" in
    up)
        npm run migrate
        ;;
    status)
        npm run migrate:status
        ;;
    *)
        echo "Usage: $0 [up|status]" >&2
        exit 2
        ;;
esac
