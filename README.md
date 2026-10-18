# Schizophrenia AI Platform

Research-grade multi-modal AI platform for schizophrenia detection and clinical decision support.

## ⚠️ Critical Disclaimer

**This is a research prototype for decision support only. It does NOT provide medical diagnosis. All predictions are probability estimates requiring clinician review. Not validated for clinical use.**

## Architecture Overview

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   React     │────▶│  Node.js/Express │────▶│   PostgreSQL    │
│  Frontend   │     │     Backend      │     │    Database     │
└─────────────┘     └────────┬─────────┘     └─────────────────┘
                             │
                    ┌────────┴────────┐
                    ▼                 ▼
           ┌─────────────────┐ ┌─────────────────┐
           │   File Storage  │ │  FastAPI AI     │
           │   (Local/S3)    │ │   Service       │
           └─────────────────┘ └────────┬────────┘
                                         │
                                  ┌──────┴──────┐
                                  ▼             ▼
                         ┌───────────────┐ ┌───────────────┐
                         │  AI Models    │ │ Explainability│
                         │  (PyTorch)    │ │ (SHAP/GradCAM)│
                         └───────────────┘ └───────────────┘
```

## Technology Stack

| Layer | Technologies |
|-------|-------------|
| **Frontend** | React 18, TypeScript, Vite, Tailwind CSS, Redux Toolkit, Chart.js, Three.js, React Three Fiber |
| **Backend** | Node.js 20+, Express, TypeScript, Prisma ORM, JWT, BullMQ, Multer |
| **AI Service** | Python 3.11+, FastAPI, PyTorch, MNE, NiBabel, MONAI, SHAP, Grad-CAM |
| **Database** | PostgreSQL 15+ |
| **Infrastructure** | Docker, Docker Compose, GitHub Actions, Nginx |

## Modalities

1. **EEG** - Resting-state eyes-closed (EDF/BDF/SET/FIF)
2. **sMRI** - Structural MRI T1-weighted (NIfTI)
3. **fMRI** - Resting-state functional MRI (NIfTI)
4. **Clinical** - PANSS assessments + demographics

## Quick Start

### Prerequisites
- Docker 24+ & Docker Compose 2+
- NVIDIA GPU with 6GB+ VRAM (tested on RTX 4050)
- NVIDIA Container Toolkit (`nvidia-docker2`)
- Git

### Development Environment

```bash
# Clone repository
git clone <repository-url>
cd schizophrenia-ai-platform

# Configure environment
cp .env.example .env
# Edit .env with secure secrets (JWT_SECRET, etc.)

# Start all services
docker compose up -d

# View logs
docker compose logs -f

# Access services
# Frontend:        http://localhost:5173
# Backend API:     http://localhost:3001/api
# AI Service:      http://localhost:8000/docs
# PostgreSQL:      localhost:5432 (dev/dev/schizophrenia_ai)
# Redis:           localhost:6379
```

### Stop Services
```bash
docker compose down
```

### Reset Database (Clean Slate)
```bash
docker compose down -v
docker compose up -d
```

## Project Structure

```
schizophrenia-ai-platform/
├── frontend/                 # React application
│   ├── src/
│   │   ├── components/      # Reusable UI components
│   │   ├── pages/           # Page components
│   │   ├── store/           # Redux store + RTK Query
│   │   ├── hooks/           # Custom React hooks
│   │   └── utils/           # Frontend utilities
│   ├── package.json
│   └── vite.config.ts
│
├── backend/                  # Node.js/Express API
│   ├── src/
│   │   ├── routes/          # API route handlers
│   │   ├── services/        # Business logic
│   │   ├── middleware/      # Express middleware
│   │   ├── config/          # Configuration
│   │   └── utils/           # Utilities
│   ├── prisma/
│   │   └── schema.prisma    # Database schema
│   └── package.json
│
├── ai-service/               # FastAPI AI inference
│   ├── app/
│   │   ├── routes/          # API endpoints per modality
│   │   ├── models/          # Model architectures + registry
│   │   ├── preprocessing/   # Preprocessing pipelines
│   │   ├── explainability/  # SHAP, Grad-CAM, attention
│   │   └── workers/         # Job queue workers
│   ├── models/              # Model weights (gitignored)
│   ├── cache/               # Preprocessed data cache
│   ├── pyproject.toml
│   └── requirements.txt
│
├── datasets/                 # Data organization
│   ├── raw/
│   │   ├── EEG/
│   │   ├── sMRI/
│   │   └── fMRI/
│   ├── processed/           # Cached preprocessed data
│   └── metadata/            # Subject metadata CSV/JSON
│
├── models/                   # Trained model registry
│   ├── eeg/
│   ├── smri/
│   ├── fmri/
│   └── fusion/
│
├── reports/                  # Generated PDF reports
├── docs/                     # Documentation
├── tests/                    # Cross-service integration tests
├── docker/                   # Dockerfiles
├── scripts/                  # Development scripts
├── .github/workflows/        # CI/CD pipelines
├── docker-compose.yml
├── .env.example
├── AGENTS.md                 # Permanent project rules
└── README.md
```

## Development Phases

See [DEVELOPMENT_PHASES.md](DEVELOPMENT_PHASES.md) for complete roadmap.

| Phase | Focus | Status |
|-------|-------|--------|
| 1 | Project Foundation & Architecture | 🟡 Current |
| 2 | PostgreSQL + Patient Management | ⏳ |
| 3 | EEG Preprocessing + Baseline Model | ⏳ |
| 4 | EEG Deep Learning Model | ⏳ |
| 5 | sMRI Pipeline | ⏳ |
| 6 | fMRI Pipeline | ⏳ |
| 7 | Clinical/PANSS Module | ⏳ |
| 8 | Multimodal Fusion | ⏳ |
| 9 | FastAPI Integration | ⏳ |
| 10 | Node.js Backend Integration | ⏳ |
| 11 | React Frontend | ⏳ |
| 12 | 3D Brain + Explainability | ⏳ |
| 13 | PDF Reporting | ⏳ |
| 14 | Security + Testing | ⏳ |
| 15 | Docker + Final Integration | ⏳ |

## Hardware Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| GPU | RTX 4050 6GB VRAM | RTX 4070+ 12GB VRAM |
| RAM | 16 GB | 32 GB |
| CPU | 8 cores | 16 cores |
| Storage | 100 GB SSD | 500 GB NVMe |

## Dataset Requirements

### Public Datasets (Examples)
- **COBRE**: ~150 subjects, EEG + sMRI + PANSS
- **BSNIP**: ~200 subjects, sMRI + fMRI + clinical
- **OpenNeuro**: Multiple schizophrenia studies
- **SCHIZCONNECT**: Multi-site sMRI/fMRI

### Required Metadata (Per Subject)
```csv
subject_id,diagnosis,age,sex,handedness,
eeg_available,smri_available,fmri_available,
clinical_available,panss_available,site,scanner
```

## Key Documentation

- [Architecture](ARCHITECTURE.md) - System design
- [Database Schema](DATABASE_SCHEMA.md) - PostgreSQL tables
- [API Design](API_DESIGN.md) - REST endpoints
- [AI Service Design](AI_SERVICE_DESIGN.md) - FastAPI structure
- [Development Phases](DEVELOPMENT_PHASES.md) - Detailed roadmap
- [Risks & Limitations](RISKS_AND_LIMITATIONS.md) - Risk register
- [RTX 4050 Optimization](RTX4050_OPTIMIZATION.md) - GPU strategies

## Contributing

1. Read [AGENTS.md](AGENTS.md) - Mandatory rules
2. Follow [Development Phases](DEVELOPMENT_PHASES.md) - One phase at a time
3. Run tests and lint before commit
4. No fabricated metrics ever
5. Document all decisions in `/docs/decisions/`

## License

MIT License - See [LICENSE](LICENSE) file.

## Citation

If you use this platform in research, please cite:
```
Schizophrenia AI Platform: Multi-modal Decision Support System
[Institution], [Year]
```

## Contact

For questions about this research prototype, contact the development team.