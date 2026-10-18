#!/bin/bash
# scripts/build.sh - Build all Docker images

set -e

echo "🏗️ Building all Docker images..."

# Build backend
echo "📦 Building backend..."
docker build -f docker/backend.Dockerfile --target production -t schizophrenia-backend:latest .

# Build AI service
echo "📦 Building AI service..."
docker build -f docker/ai-service.Dockerfile --target production -t schizophrenia-ai-service:latest .

# Build frontend
echo "📦 Building frontend..."
docker build -f docker/frontend.Dockerfile --target production -t schizophrenia-frontend:latest .

echo "✅ All images built!"
echo ""
echo "📋 Images:"
docker images | grep schizophrenia