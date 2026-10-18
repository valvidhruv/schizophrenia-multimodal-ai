#!/bin/bash
# scripts/test.sh - Run all tests

set -e

echo "🧪 Running all tests..."

# Frontend tests
echo "📦 Frontend tests..."
cd frontend
npm run test -- --run
cd ..

# Backend tests
echo "📦 Backend tests..."
cd backend
npm run test
cd ..

# AI Service tests
echo "📦 AI Service tests..."
cd ai-service
pytest tests/ -v --tb=short
cd ..

echo "✅ All tests passed!"