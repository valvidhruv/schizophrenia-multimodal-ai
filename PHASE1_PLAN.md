# Phase 1 Implementation Plan: Project Foundation & Architecture

## Objective
Establish complete project structure, development environment, and CI/CD foundation. All services runnable via Docker Compose.

## Duration
1-2 weeks

## Deliverables Checklist

### 1. Repository Configuration
- [ ] `.gitignore` - Comprehensive for Node, Python, Docker, IDE, OS
- [ ] `.github/workflows/ci.yml` - CI pipeline skeleton
- [ ] `.env.example` - All required environment variables
- [ ] `README.md` - Project overview, quick start, architecture summary
- [ ] `AGENTS.md` - Permanent project rules (see below)
- [ ] `LICENSE` - MIT or appropriate
- [ ] `CONTRIBUTING.md` - Contribution guidelines

### 2. Docker Infrastructure
- [ ] `docker-compose.yml` - Development stack
- [ ] `docker-compose.prod.yml` - Production override
- [ ] `docker/` - Dockerfiles for each service
  - [ ] `docker/frontend.Dockerfile`
  - [ ] `docker/backend.Dockerfile`
  - [ ] `docker/ai-service.Dockerfile`
  - [ ] `docker/nginx.Dockerfile`
- [ ] `.dockerignore` files

### 3. Frontend Foundation (`frontend/`)
- [ ] `package.json` - React 18, TypeScript, Vite, Tailwind, Redux Toolkit, Chart.js, Three.js, R3F
- [ ] `tsconfig.json` - Strict mode
- [ ] `vite.config.ts` - Path aliases, proxy, plugins
- [ ] `tailwind.config.js` - Theme, dark mode
- [ ] `.eslintrc.json` - Airbnb + TypeScript + React
- [ ] `.prettierrc` - Consistent formatting
- [ ] `src/main.tsx` - Entry point
- [ ] `src/App.tsx` - Root component with providers
- [ ] `src/store/` - Redux store with RTK Query
- [ ] `src/styles/` - Global CSS, Tailwind imports
- [ ] `index.html` - Template

### 4. Backend Foundation (`backend/`)
- [ ] `package.json` - Express, TypeScript, Prisma, JWT, BullMQ, Zod
- [ ] `tsconfig.json` - Strict, ESNext
- [ ] `.eslintrc.json` - Airbnb + TypeScript
- [ ] `.prettierrc`
- [ ] `prisma/schema.prisma` - Full schema from DATABASE_SCHEMA.md
- [ ] `src/main.ts` - Entry point
- [ ] `src/app.ts` - Express app factory
- [ ] `src/config/` - Environment validation (Zod)
- [ ] `src/middleware/` - Auth, error handling, audit logging, rate limiting
- [ ] `src/routes/` - Route modules (auth, patients, files, clinical, analysis, reports)
- [ ] `src/services/` - Business logic (patient, file, job, report, auth)
- [ ] `src/utils/` - Helpers, constants
- [ ] `src/types/` - Shared types

### 5. AI Service Foundation (`ai-service/`)
- [ ] `pyproject.toml` - Modern Python packaging
- [ ] `requirements.txt` - Pinned dependencies
- [ ] `requirements-dev.txt` - Dev dependencies
- [ ] `app/main.py` - FastAPI app factory
- [ ] `app/config.py` - Pydantic Settings
- [ ] `app/schemas/` - Request/Response models
- [ ] `app/routes/` - Health, EEG, sMRI, fMRI, fusion, explain
- [ ] `app/models/registry.py` - Model loading
- [ ] `app/preprocessing/` - Base preprocessors
- [ ] `app/utils/` - GPU memory, caching, file utils
- [ ] `app/workers/` - Job queue worker skeleton
- [ ] `tests/` - Pytest config

### 6. Database
- [ ] Prisma migrations from schema
- [ ] Seed script for dev data
- [ ] Backup/restore scripts

### 7. Development Scripts (`scripts/`)
- [ ] `dev.sh` - Start all services with hot reload
- [ ] `test.sh` - Run all tests
- [ ] `lint.sh` - Run all linters
- [ ] `db:migrate.sh` - Run migrations
- [ ] `db:seed.sh` - Seed database
- [ ] `build.sh` - Build all Docker images

### 8. Documentation
- [ ] `docs/architecture.md` - Link to ARCHITECTURE.md
- [ ] `docs/api.md` - Link to API_DESIGN.md
- [ ] `docs/database.md` - Link to DATABASE_SCHEMA.md
- [ ] `docs/ai-service.md` - Link to AI_SERVICE_DESIGN.md
- [ ] `docs/development.md` - Dev setup guide

## Detailed Tasks

### Task 1.1: Root Configuration Files
Create in project root:
- `.gitignore`
- `.env.example`
- `docker-compose.yml`
- `README.md`
- `AGENTS.md`
- `LICENSE`

### Task 1.2: Docker Compose (Development)
```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: schizophrenia_ai
      POSTGRES_USER: dev
      POSTGRES_PASSWORD: dev
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports: ["5432:5432"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U dev"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  backend:
    build:
      context: .
      dockerfile: docker/backend.Dockerfile
    environment:
      DATABASE_URL: postgresql://dev:dev@postgres:5432/schizophrenia_ai
      REDIS_URL: redis://redis:6379/0
      JWT_SECRET: ${JWT_SECRET}
      AI_SERVICE_URL: http://ai-service:8000
    ports: ["3001:3001"]
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    volumes:
      - ./backend:/app
      - /app/node_modules

  ai-service:
    build:
      context: .
      dockerfile: docker/ai-service.Dockerfile
    environment:
      REDIS_URL: redis://redis:6379/0
      MODEL_DIR: /app/models
      CACHE_DIR: /app/cache
      CUDA_VISIBLE_DEVICES: 0
    ports: ["8000:8000"]
    depends_on:
      redis:
        condition: service_healthy
    volumes:
      - ./ai-service:/app
      - ./models:/app/models:ro
      - ./datasets:/data:ro
      - ./ai-service/cache:/app/cache
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]

  frontend:
    build:
      context: .
      dockerfile: docker/frontend.Dockerfile
    environment:
      VITE_API_URL: http://localhost:3001/api
    ports: ["5173:5173"]
    volumes:
      - ./frontend:/app
      - /app/node_modules

volumes:
  postgres_data:
  redis_data:
```

### Task 1.3: Frontend Scaffold
```bash
cd frontend
npm create vite@latest . -- --template react-ts
npm install
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
npm install @reduxjs/toolkit @tanstack/react-query react-router-dom
npm install chart.js react-chartjs-2
npm install three @react-three/fiber @react-three/drei
npm install axios zod react-hook-form @hookform/resolvers
npm install lucide-react clsx tailwind-merge
npm install -D @types/three
```

### Task 1.4: Backend Scaffold
```bash
cd backend
npm init -y
npm install express cors helmet compression morgan
npm install jsonwebtoken bcryptjs zod
npm install @prisma/client
npm install bullmq ioredis
npm install multer
npm install -D typescript tsx @types/node @types/express @types/cors @types/jsonwebtoken @types/bcryptjs @types/multer
npm install -D prisma jest ts-jest @types/jest supertest @types/supertest
npm install -D eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser prettier eslint-config-prettier
npx tsc --init
npx prisma init
```

### Task 1.5: AI Service Scaffold
```bash
cd ai-service
# pyproject.toml with:
# [build-system]
# requires = ["setuptools>=61.0", "wheel"]
# [project]
# name = "ai-service"
# version = "0.1.0"
# requires-python = ">=3.11"
# dependencies = [...]
# [tool.ruff]
# [tool.mypy]

pip install -r requirements.txt
# requirements.txt:
# fastapi==0.109.*
# uvicorn[standard]==0.27.*
# pydantic==2.6.*
# pydantic-settings==2.2.*
# torch==2.2.* --index-url https://download.pytorch.org/whl/cu121
# torchvision==0.17.* --index-url https://download.pytorch.org/whl/cu121
# mne==1.6.*
# nibabel==5.2.*
# monai==1.3.*
# nilearn==0.10.*
# scikit-learn==1.4.*
# scipy==1.12.*
# pandas==2.2.*
# numpy==1.26.*
# shap==0.44.*
# redis==5.0.*
# python-multipart==0.0.*
# pyyaml==6.0.*
# structlog==24.1.*
```

### Task 1.6: CI Pipeline Skeleton
```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm', cache-dependency-path: 'frontend/package-lock.json' }
      - run: cd frontend && npm ci
      - run: cd frontend && npm run lint
      - run: cd frontend && npm run typecheck
      - run: cd frontend && npm run test -- --run

  backend:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15-alpine
        env: { POSTGRES_DB: test, POSTGRES_USER: test, POSTGRES_PASSWORD: test }
        ports: [5432:5432]
        options: --health-cmd="pg_isready" --health-interval=10s --health-timeout=5s --health-retries=5
      redis:
        image: redis:7-alpine
        ports: [6379:6379]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm', cache-dependency-path: 'backend/package-lock.json' }
      - run: cd backend && npm ci
      - run: cd backend && npm run lint
      - run: cd backend && npm run typecheck
      - run: cd backend && npx prisma migrate deploy
      - run: cd backend && npm run test

  ai-service:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.11', cache: 'pip', cache-dependency-path: 'ai-service/requirements.txt' }
      - run: cd ai-service && pip install -r requirements.txt -r requirements-dev.txt
      - run: cd ai-service && ruff check .
      - run: cd ai-service && mypy app/
      - run: cd ai-service && pytest tests/ -v
```

### Task 1.7: AGENTS.md Creation
(See below - this is a critical permanent document)

### Task 1.8: README.md Creation
(See below)

## Verification Checklist

### Automated
- [ ] `docker compose up -d` starts all 5 services healthy
- [ ] `docker compose logs frontend` shows Vite ready
- [ ] `docker compose logs backend` shows Express listening on 3001
- [ ] `docker compose logs ai-service` shows Uvicorn on 8000
- [ ] `curl http://localhost:3001/api/health` returns 200
- [ ] `curl http://localhost:8000/health` returns 200
- [ ] `curl http://localhost:5173` returns HTML
- [ ] `npm run lint` passes in frontend, backend
- [ ] `ruff check` passes in ai-service
- [ ] `mypy` passes in ai-service
- [ ] `pytest` passes in ai-service
- [ ] `npm run test` passes in frontend, backend

### Manual
- [ ] Frontend loads in browser at localhost:5173
- [ ] Backend API docs accessible (if Swagger added)
- [ ] AI service docs at localhost:8000/docs
- [ ] Database accessible via psql
- [ ] Redis CLI works
- [ ] Hot reload works for all services

## AGENTS.md Content (Permanent Rules)

```markdown
# AGENTS.md - Permanent Project Rules

## Core Principles

1. **NO FABRICATED METRICS** - Every reported number (accuracy, AUC, etc.) MUST come from actual evaluation code. Never invent, estimate, or round up metrics.

2. **NO AUTONOMOUS DIAGNOSIS** - This is a DECISION SUPPORT prototype. All UI must state: "Research prototype - not for clinical diagnosis. Clinician review required."

3. **SUBJECT-LEVEL SPLITS ONLY** - Train/val/test splits MUST be at subject level. Never split epochs/slices from same subject across sets.

4. **REAL DATA ONLY** - No synthetic data for evaluation. No fake predictions. No placeholder results.

5. **ONE PHASE AT A TIME** - Complete, test, verify, document each phase before starting next.

## Development Rules

6. **LINT FIRST** - Code must pass lint/typecheck before commit. CI enforces this.

7. **TESTS REQUIRED** - New functionality requires tests. Target >80% coverage.

8. **DOCUMENT DECISIONS** - Architecture changes recorded in `/docs/decisions/`

9. **VERSION MODELS** - Every model has version, config, metrics, training data documented.

10. **GPU MEMORY AWARE** - All code targets RTX 4050 6GB. Profile VRAM usage.

## Data Rules

11. **METADATA FIRST** - Every subject has: subject_id, diagnosis, age, sex, modality availability flags.

12. **NO LEAKAGE** - Preprocessing fit on train only. No test data in preprocessing stats.

13. **CACHE WITH HASHES** - Preprocessed data cached with parameter hash keys.

14. **AUDIT EVERYTHING** - All data access, predictions, reports logged.

## Communication Rules

15. **CONCISE OUTPUT** - Agent responses < 4 lines unless detail requested.

16. **NO PREAMBLE** - Answer directly. No "Here is what I'll do..."

17. **STOP AFTER PHASE** - Complete phase, verify, explain changes, show issues, STOP.

## Enforcement
- CI checks: lint, typecheck, tests, no-fabrication grep
- Pre-commit hooks
- Code review requirements
- Automated metric validation
```

## README.md Content

```markdown
# Schizophrenia AI Platform

Research-grade multi-modal AI platform for schizophrenia detection and decision support.

## ⚠️ Critical Disclaimer
**This is a research prototype for decision support only. It does NOT provide medical diagnosis. All predictions are probability estimates requiring clinician review.**

## Architecture
- **Frontend**: React 18 + TypeScript + Vite + Tailwind + Redux Toolkit
- **Backend**: Node.js + Express + TypeScript + Prisma + PostgreSQL
- **AI Service**: Python + FastAPI + PyTorch + MONAI + MNE
- **Infrastructure**: Docker + Docker Compose + GitHub Actions

## Modalities
- EEG (resting-state)
- Structural MRI (T1w)
- Functional MRI (resting-state)
- Clinical (PANSS assessments)

## Quick Start

### Prerequisites
- Docker 24+ & Docker Compose 2+
- NVIDIA GPU with 6GB+ VRAM (RTX 4050 tested)
- NVIDIA Container Toolkit
- Git

### Development
```bash
# Clone
git clone <repo>
cd schizophrenia-ai-platform

# Configure environment
cp .env.example .env
# Edit .env with secure secrets

# Start all services
docker compose up -d

# View logs
docker compose logs -f

# Access
# Frontend: http://localhost:5173
# Backend API: http://localhost:3001/api
# AI Service: http://localhost:8000/docs
# PostgreSQL: localhost:5432
# Redis: localhost:6379
```

### Stop
```bash
docker compose down
```

### Reset Database
```bash
docker compose down -v
docker compose up -d
```

## Project Structure
```
schizophrenia-ai-platform/
├── frontend/          # React application
├── backend/           # Node.js/Express API
├── ai-service/        # FastAPI AI inference
├── datasets/          # Raw, processed, metadata
├── models/            # Trained model weights (gitignored)
├── reports/           # Generated PDF reports
├── docs/              # Documentation
├── tests/             # Cross-service integration tests
├── docker/            # Dockerfiles
├── scripts/           # Development scripts
└── docker-compose.yml
```

## Development Phases
See [DEVELOPMENT_PHASES.md](DEVELOPMENT_PHASES.md) for detailed roadmap.

Current Phase: **Phase 1 - Foundation**

## Hardware Requirements
- **Minimum**: RTX 4050 6GB VRAM, 16GB RAM
- **Recommended**: RTX 4070+ 12GB VRAM, 32GB RAM
- **CPU**: 8+ cores for preprocessing

## Dataset Requirements
See [RISKS_AND_LIMITATIONS.md](RISKS_AND_LIMITATIONS.md) for data needs.

## License
MIT - See LICENSE file

## Contributing
See [CONTRIBUTING.md](CONTRIBUTING.md)
```

## Phase 1 Completion Criteria

All of the following must be ✅:

| Criterion | Verification |
|-----------|--------------|
| All services start with `docker compose up -d` | `docker compose ps` shows all healthy |
| Frontend accessible at localhost:5173 | Browser loads React app |
| Backend API responds at localhost:3001/api/health | `curl` returns 200 |
| AI Service responds at localhost:8000/health | `curl` returns 200 |
| Database migrations run | `npx prisma migrate status` shows applied |
| Lint passes all services | `npm run lint` / `ruff check` exit 0 |
| Typecheck passes | `npm run typecheck` / `mypy` exit 0 |
| Tests pass | `npm run test` / `pytest` exit 0 |
| CI pipeline runs on push | GitHub Actions green |
| AGENTS.md exists in root | `cat AGENTS.md` shows rules |
| README.md exists in root | `cat README.md` shows project info |

## Next Steps After Phase 1
1. Review Phase 1 completion with user
2. Get approval to start Phase 2
3. Begin Phase 2: PostgreSQL + Patient Management (Backend)

## Notes
- Do NOT implement any AI models in Phase 1
- Do NOT create fake data
- Focus on solid foundation only
- All configs should be production-ready from start