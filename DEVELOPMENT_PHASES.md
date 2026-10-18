# Development Phases

## Overview
Each phase must be completed, tested, and verified before moving to the next. No parallel phase development.

---

## PHASE 1: Project Foundation & Architecture
**Duration**: 1-2 weeks
**Goal**: Complete project structure, configuration, and development environment

### Deliverables
- [ ] Folder structure created (done)
- [ ] Architecture documentation (ARCHITECTURE.md, DATABASE_SCHEMA.md, API_DESIGN.md, AI_SERVICE_DESIGN.md)
- [ ] AGENTS.md with permanent rules
- [ ] README.md with project overview
- [ ] .gitignore configured
- [ ] Docker Compose with all services (PostgreSQL, Redis, Backend, AI Service, Frontend)
- [ ] Development environment scripts
- [ ] ESLint/Prettier/TypeScript configs
- [ ] Python linting (ruff, mypy) configs
- [ ] GitHub Actions CI skeleton
- [ ] Environment variable templates (.env.example)

### Verification
- [ ] `docker compose up -d` starts all services
- [ ] `npm run lint` passes in frontend/backend
- [ ] `ruff check` passes in ai-service
- [ ] `mypy` passes in ai-service
- [ ] Health endpoints respond

---

## PHASE 2: PostgreSQL + Patient Management (Backend)
**Duration**: 2-3 weeks
**Goal**: Working backend with auth, patients, file uploads, clinical data

### Backend Setup
- [ ] Node.js/Express/TypeScript project init
- [ ] Prisma ORM with schema from DATABASE_SCHEMA.md
- [ ] PostgreSQL connection and migrations
- [ ] JWT authentication (access + refresh tokens)
- [ ] Role-based access control middleware
- [ ] Audit logging middleware

### Patient Management
- [ ] POST/GET/PUT/DELETE /api/patients
- [ ] Pagination, filtering, search
- [ ] Subject ID uniqueness validation

### File Upload System
- [ ] Multer configuration with size limits
- [ ] File validation per modality (EEG: EDF/BDF/SET/FIF, sMRI/fMRI: NIfTI)
- [ ] Checksum calculation (SHA-256)
- [ ] Metadata extraction (MNE for EEG, NiBabel for MRI)
- [ ] Secure file storage with organized paths
- [ ] POST /api/patients/:id/upload/{eeg,smri,fmri}
- [ ] GET /api/patients/:id/files
- [ ] File status tracking

### Clinical/PANSS Module
- [ ] POST /api/patients/:id/panss (create/update)
- [ ] GET /api/patients/:id/panss/history
- [ ] GET /api/patients/:id/panss/latest
- [ ] PANSS scoring computation (positive/negative/general/total)
- [ ] Input validation (1-7 scale)

### Analysis Job Framework
- [ ] Job queue with BullMQ + Redis
- [ ] POST /api/analysis/jobs
- [ ] GET /api/analysis/jobs/:jobId (status + progress)
- [ ] GET /api/analysis/patients/:patientId/latest
- [ ] GET /api/analysis/patients/:patientId/history
- [ ] Job status webhook/callback for AI service

### Testing & Verification
- [ ] Unit tests for all services (>80% coverage)
- [ ] Integration tests for API endpoints
- [ ] Authentication flow tests
- [ ] File upload validation tests
- [ ] Database migration tests
- [ ] `npm run test` passes
- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes

---

## PHASE 3: EEG Preprocessing + Baseline Model (AI Service)
**Duration**: 3-4 weeks
**Goal**: Working EEG pipeline with classical ML baseline

### AI Service Setup
- [ ] FastAPI project structure
- [ ] Configuration management (Pydantic Settings)
- [ ] Model registry with versioning
- [ ] Health/readiness endpoints
- [ ] GPU memory management utilities
- [ ] Caching infrastructure

### EEG Preprocessing (MNE)
- [ ] Load EDF/BDF/SET/FIF/VHDR
- [ ] Resampling (target 250 Hz)
- [ ] Bandpass filter (0.5-100 Hz)
- [ ] Notch filter (50/60 Hz)
- [ ] Bad channel detection (RANSAC)
- [ ] Re-referencing (average)
- [ ] ICA artifact removal (eye blinks, muscle)
- [ ] Epoching (2s windows, 50% overlap)
- [ ] Feature extraction:
  - Band power (delta, theta, alpha, beta, gamma)
  - Spectral entropy
  - Functional connectivity (PLV, coherence)
  - Hjorth parameters
- [ ] Z-score normalization per subject
- [ ] Cache preprocessed results

### Baseline EEG Model
- [ ] Feature selection (ANOVA F-test, mutual info)
- [ ] Classical ML: SVM, Random Forest, XGBoost
- [ ] Nested cross-validation (subject-level splits)
- [ ] Evaluation: accuracy, AUC, sensitivity, specificity
- [ ] Model persistence (joblib)
- [ ] Inference endpoint: POST /eeg

### Testing & Verification
- [ ] Preprocessing pipeline tests with sample data
- [ ] Model training script with real data
- [ ] Cross-validation results documented
- [ ] Inference latency < 2s on RTX 4050
- [ ] VRAM usage < 2GB
- [ ] `ruff check` passes
- [ ] `mypy` passes
- [ ] `pytest` passes

---

## PHASE 4: EEG Deep Learning Model
**Duration**: 3-4 weeks
**Goal**: Deep learning EEG model (EEGNet/TCN) exceeding baseline

### Model Architecture
- [ ] EEGNet implementation (Lawhern et al. 2018)
- [ ] TCN alternative (Temporal Convolutional Network)
- [ ] Attention-based variant
- [ ] Configurable: channels, timepoints, classes

### Training Pipeline
- [ ] Subject-level train/val/test splits (no leakage)
- [ ] Data augmentation: noise, time warp, channel dropout
- [ ] Mixed precision training (AMP)
- [ ] Gradient accumulation for effective batch size
- [ ] Learning rate scheduling (cosine annealing)
- [ ] Early stopping, model checkpointing
- [ ] Experiment tracking (MLflow or TensorBoard)

### Evaluation
- [ ] Nested cross-validation (outer: subject, inner: hyperparams)
- [ ] Statistical comparison vs baseline (McNemar's test)
- [ ] Per-subject performance analysis
- [ ] Confusion matrices, ROC curves
- [ ] Calibration curves

### Deployment
- [ ] Export to TorchScript/ONNX
- [ ] Model quantization (INT8) for inference
- [ ] Update inference endpoint
- [ ] Benchmark: latency, VRAM, throughput

### Verification
- [ ] Model outperforms baseline on held-out test set
- [ ] All metrics from actual evaluation (no fabricated numbers)
- [ ] Inference < 1s, VRAM < 3GB
- [ ] Tests pass

---

## PHASE 5: sMRI Pipeline
**Duration**: 3-4 weeks
**Goal**: Structural MRI preprocessing + 3D CNN model

### Preprocessing (MONAI + NiBabel)
- [ ] NIfTI loading and validation
- [ ] Reorientation to RAS
- [ ] N4 bias field correction
- [ ] Skull stripping (SynthStrip - lightweight)
- [ ] Registration to MNI152 1mm (affine + SyN)
- [ ] Tissue segmentation (GM/WM/CSF)
- [ ] Cortical parcellation (Desikan-Killiany 68 regions)
- [ ] Feature extraction: regional volumes, thickness, surface area
- [ ] VBM pipeline (optional)

### Model Architecture
- [ ] 3D ResNet (18/34 layers) - memory efficient
- [ ] Alternative: Med3D pretrained weights
- [ ] Input: 1mm^3 MNI-aligned GM maps (121x145x121)
- [ ] Patch-based inference for memory (64^3 patches)
- [ ] Global average pooling + classifier

### Training
- [ ] Transfer learning from Med3D/self-supervised
- [ ] Subject-level splits
- [ ] Mixed precision, gradient checkpointing
- [ ] Batch size 1-2 with gradient accumulation

### Verification
- [ ] Preprocessing completes < 10 min/subject
- [ ] Inference < 30s, VRAM < 5GB
- [ ] Real evaluation metrics documented

---

## PHASE 6: fMRI Pipeline
**Duration**: 3-4 weeks
**Goal**: Functional MRI preprocessing + connectivity model

### Preprocessing (MONAI + Nilearn)
- [ ] NIfTI loading
- [ ] Slice timing correction
- [ ] Motion correction (MCFLIRT)
- [ ] Coregistration to T1w
- [ ] Normalization to MNI
- [ ] Spatial smoothing (6mm FWHM)
- [ ] Temporal filtering (0.01-0.1 Hz)
- [ ] Nuisance regression (CompCor + motion)
- [ ] Parcellation (Schaefer 200/400)
- [ ] Connectivity matrices (Pearson, partial correlation)
- [ ] Graph metrics (NetworkX)

### Model Architecture
- [ ] Graph Neural Network (GAT/GCN) on connectivity
- [ ] Alternative: 4D CNN (too heavy for 6GB - use patch/ROI)
- [ ] Input: ROI x ROI correlation matrix (200x200)
- [ ] Lightweight: MLP on graph metrics + upper triangle

### Verification
- [ ] Preprocessing completes < 15 min/subject
- [ ] Inference < 10s, VRAM < 4GB

---

## PHASE 7: Clinical/PANSS Module (AI Service)
**Duration**: 1-2 weeks
**Goal**: Clinical data model for fusion

### Preprocessing
- [ ] PANSS item normalization
- [ ] Subscale scores (positive, negative, general)
- [ ] Demographic encoding (age, sex, handedness)
- [ ] Missing data handling

### Model
- [ ] TabTransformer or MLP
- [ ] Input: PANSS items (30) + demographics (5)
- [ ] Output: probability
- [ ] SHAP explainability built-in

### Verification
- [ ] Inference < 100ms
- [ ] SHAP values computed

---

## PHASE 8: Multimodal Fusion
**Duration**: 3-4 weeks
**Goal**: Integrate all modalities

### Fusion Strategies
- [ ] **Late Fusion**: Weighted average of probabilities
- [ ] **Intermediate Fusion**: Concatenate penultimate features → MLP
- [ ] **Attention Fusion**: Cross-modal attention (lightweight)
- [ ] **Early Fusion**: Not feasible (different input spaces)

### Implementation
- [ ] Fusion module with configurable strategy
- [ ] Modality weighting (learned or heuristic)
- [ ] Missing modality handling (masking)
- [ ] Uncertainty quantification
- [ ] End-to-end training (optional) or stacked generalization

### Evaluation
- [ ] Subject-level CV with all available modalities
- [ ] Ablation: each modality contribution
- [ ] Comparison: fusion vs best single modality
- [ ] Statistical significance testing

### Verification
- [ ] Fusion improves over best single modality
- [ ] Inference < 5s total, VRAM < 6GB
- [ ] Handles missing modalities gracefully

---

## PHASE 9: FastAPI Integration
**Duration**: 1-2 weeks
**Goal**: Complete AI service with all endpoints

### Integration
- [ ] All modality endpoints working
- [ ] Fusion endpoint working
- [ ] Explainability endpoints (SHAP, Grad-CAM)
- [ ] Job queue worker consuming from Redis
- [ ] Callback to backend on completion
- [ ] Error handling and retry logic
- [ ] Request validation and sanitization
- [ ] Rate limiting
- [ ] Logging and monitoring

### Testing
- [ ] End-to-end integration tests
- [ ] Load testing (concurrent requests)
- [ ] GPU memory stress test
- [ ] Failure recovery tests

---

## PHASE 10: Node.js Backend Integration
**Duration**: 2 weeks
**Goal**: Backend ↔ AI Service communication

### Integration
- [ ] HTTP client for AI service with retries
- [ ] Job submission from backend to AI service
- [ ] Webhook/callback handling for job completion
- [ ] Result storage in PostgreSQL
- [ ] Explanation storage
- [ ] Progress polling endpoint for frontend

### Verification
- [ ] Full flow: upload → job → AI → results → DB
- [ ] Error handling: AI service down, timeout, OOM
- [ ] Concurrent job handling

---

## PHASE 11: React Frontend
**Duration**: 3-4 weeks
**Goal**: Complete clinician-facing UI

### Core Setup
- [ ] Vite + React 18 + TypeScript
- [ ] Tailwind CSS configuration
- [ ] Redux Toolkit + RTK Query
- [ ] React Router
- [ ] Authentication flow (login, protected routes, token refresh)

### Pages/Components
- [ ] **Dashboard**: Patient list, stats, recent activity
- [ ] **Patient Detail**: Demographics, files, assessments, analyses
- [ ] **File Upload**: Drag-drop, progress, validation feedback
- [ ] **PANSS Entry**: Form with validation, auto-scoring
- [ ] **Analysis Center**: Job submission, queue, progress
- [ ] **Results View**:
  - Prediction cards per modality
  - Probability gauges
  - Confidence indicators
  - Disclaimer banners
- [ ] **3D Brain Viewer**: (Phase 12)
- [ ] **Explainability Panel**: SHAP beeswarm, Grad-CAM overlays
- [ ] **Reports**: List, generate, download, preview
- [ ] **Settings**: Profile, preferences

### UX Requirements
- [ ] Responsive design (desktop/tablet)
- [ ] Loading states, skeletons
- [ ] Error boundaries
- [ ] Accessibility (WCAG 2.1 AA)
- [ ] Dark mode support

### Verification
- [ ] `npm run test` passes
- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] E2E tests with Playwright
- [ ] Lighthouse score > 90

---

## PHASE 12: 3D Brain + Explainability Visualization
**Duration**: 2-3 weeks
**Goal**: Interactive 3D brain with explanation overlays

### 3D Brain (React Three Fiber)
- [ ] Brain mesh loading (glTF from MNI template)
- [ ] Parcellation overlay (Desikan/Schaefer)
- [ ] Color mapping for: volumes, activation, importance
-   [ ] Click-to-inspect region details
-   [ ] Layer toggles (GM, WM, surfaces)
-   [ ] Camera controls (orbit, pan, zoom)

### Explainability Visualizations
- [ ] **EEG**: Topographic maps (MNE-style), channel importance
- [ ] **sMRI**: 3D heatmaps on brain surface, regional bar charts
- [ ] **fMRI**: Connectivity matrix, graph visualization, network views
- [ ] **Fusion**: Modality contribution weights, attention maps
- [ ] **SHAP**: Beeswarm, waterfall, dependence plots (Chart.js)
- [ ] **Grad-CAM**: 3D overlay on brain mesh

### Verification
- [ ] 60fps on typical hardware
- [ ] Works with missing modalities
- [ ] Export views as PNG for reports

---

## PHASE 13: PDF Reporting
**Duration**: 2 weeks
**Goal**: Clinical-quality PDF reports

### Report Generation
- [ ] Template system (HTML → PDF via Puppeteer/Playwright)
- [ ] Report sections:
  - Patient demographics
  - Clinical summary (PANSS history)
  - Data quality metrics
  - Per-modality predictions with confidence
  - Fusion prediction
  - Explainability figures
  - Limitations & disclaimers
  - References
- [ ] Dynamic content based on available modalities
- [ ] Batch generation for multiple patients
- [ ] Digital signature placeholder

### Verification
- [ ] PDF renders correctly
- [ ] All figures included
- [ ] Disclaimer prominent
- [ ] Generation < 30s

---

## PHASE 14: Security + Testing
**Duration**: 2 weeks
**Goal**: Production readiness

### Security
- [ ] Input validation/sanitization everywhere
- [ ] SQL injection prevention (Prisma)
- [ ] XSS prevention (CSP headers)
- [ ] CSRF protection
- [ ] Rate limiting on all endpoints
- [ ] File upload validation (magic bytes, size, type)
- [ ] Secure headers (Helmet.js)
- [ ] Audit log completeness
- [ ] Data encryption at rest (pgcrypto)
- [ ] TLS configuration

### Testing
- [ ] Penetration testing checklist
- [ ] Load testing (k6)
- [ ] Chaos engineering (service failures)
- [ ] Backup/restore verification
- [ ] GDPR/HIPAA compliance review

---

## PHASE 15: Docker + Final Integration
**Duration**: 1-2 weeks
**Goal**: Production deployment package

### Docker
- [ ] Multi-stage builds for all services
- [ ] Docker Compose production override
- [ ] Nginx reverse proxy with SSL
- [ ] Health checks for all services
- [ ] Resource limits (CPU, memory, GPU)
- [ ] Volume management

### Documentation
- [ ] Deployment guide
- [ ] API documentation (OpenAPI/Swagger)
- [ ] User manual
- [ ] Developer guide
- [ ] Model cards for each AI model

### Final Verification
- [ ] `docker compose -f docker-compose.prod.yml up -d` works
- [ ] All services healthy
- [ ] End-to-end flow verified
- [ ] Performance benchmarks documented

---

## Phase Dependencies

```
Phase 1
    │
    ▼
Phase 2 ◀──────────────────────┐
    │                           │
    ▼                           │
Phase 3 ◀──┐                    │
    │      │                    │
    ▼      │                    │
Phase 4   │                    │
    │      │                    │
    ▼      │                    │
Phase 5   │                    │
    │      │                    │
    ▼      │                    │
Phase 6   │                    │
    │      │                    │
    ▼      │                    │
Phase 7   │                    │
    │      │                    │
    ▼      │                    │
Phase 8   │                    │
    │      │                    │
    ▼      │                    │
Phase 9   │                    │
    │      │                    │
    ▼      ▼                    │
Phase 10 ◀── (Backend integration)
    │
    ▼
Phase 11 ◀──────────────────────┘
    │
    ▼
Phase 12
    │
    ▼
Phase 13
    │
    ▼
Phase 14
    │
    ▼
Phase 15
```

---

## Milestone Gates

Each phase must pass:
1. **Code Quality**: Lint + typecheck pass
2. **Tests**: Unit + integration pass
3. **Functionality**: Manual verification of all deliverables
4. **Performance**: Meets hardware constraints (RTX 4050)
5. **Documentation**: Updated for changes
6. **No Fabricated Metrics**: All numbers from real evaluation