#!/bin/bash
# scripts/lint.sh - Run all linters and typechecks

set -e

echo "🔍 Running linters and typechecks..."

# Frontend lint + typecheck
echo "📦 Frontend lint + typecheck..."
cd frontend
npm run lint
npm run typecheck
cd ..

# Backend lint + typecheck
echo "📦 Backend lint + typecheck..."
cd backend
npm run lint
npm run typecheck
cd ..

# AI Service lint + typecheck
echo "📦 AI Service lint + typecheck..."
cd ai-service
ruff check .
mypy app/
cd ..

echo "✅ All linting and typechecks passed!"