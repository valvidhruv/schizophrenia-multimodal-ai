#!/bin/bash
# scripts/dev.sh - Start development environment

set -e

echo "🚀 Starting Schizophrenia AI Platform Development Environment"

# Check for .env
if [ ! -f .env ]; then
    echo "❌ .env file not found. Copy .env.example to .env and configure."
    exit 1
fi

# Check for NVIDIA Docker
if ! docker info 2>/dev/null | grep -q "nvidia"; then
    echo "⚠️  NVIDIA Container Toolkit not detected. GPU may not be available."
fi

# Start services
echo "📦 Starting Docker services..."
docker compose up -d

# Wait for services to be healthy
echo "⏳ Waiting for services to be ready..."
sleep 5

# Check service health
echo "🔍 Checking service health..."

check_service() {
    local name=$1
    local url=$2
    local max_attempts=30
    local attempt=1

    while [ $attempt -le $max_attempts ]; do
        if curl -sf "$url" > /dev/null 2>&1; then
            echo "✅ $name is healthy"
            return 0
        fi
        echo "⏳ Waiting for $name... (attempt $attempt/$max_attempts)"
        sleep 2
        attempt=$((attempt + 1))
    done

    echo "❌ $name failed to become healthy"
    return 1
}

check_service "PostgreSQL" "http://localhost:5432" || true  # TCP check instead
check_service "Redis" "http://localhost:6379" || true
check_service "Backend API" "http://localhost:3001/api/health"
check_service "AI Service" "http://localhost:8000/health"
check_service "Frontend" "http://localhost:5173"

echo ""
echo "✅ Development environment ready!"
echo ""
echo "📍 Access points:"
echo "   Frontend:        http://localhost:5173"
echo "   Backend API:     http://localhost:3001/api"
echo "   AI Service:      http://localhost:8000/docs"
echo "   PostgreSQL:      localhost:5432"
echo "   Redis:           localhost:6379"
echo ""
echo "📋 Useful commands:"
echo "   View logs:       docker compose logs -f [service]"
echo "   Stop:            docker compose down"
echo "   Reset DB:        docker compose down -v && docker compose up -d"
echo "   Run tests:       ./scripts/test.sh"
echo "   Run lint:        ./scripts/lint.sh"