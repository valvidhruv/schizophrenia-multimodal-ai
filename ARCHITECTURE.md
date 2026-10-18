# Schizophrenia AI Platform - Architecture Document

## System Overview

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  React Frontend │────▶│  Node.js/Express │────▶│  PostgreSQL     │
│  (Vite + TS)    │     │  Backend         │     │  Database       │
└─────────────────┘     └────────┬─────────┘     └─────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    ▼                         ▼
           ┌─────────────────┐       ┌─────────────────┐
           │  File Storage   │       │  FastAPI AI     │
           │  (Local/S3)     │       │  Service        │
           └─────────────────┘       └────────┬────────┘
                                              │
                                    ┌─────────┴─────────┐
                                    ▼                   ▼
                           ┌─────────────────┐  ┌─────────────────┐
                           │  AI Models      │  │  Explainability │
                           │  (PyTorch)      │  │  (SHAP/GradCAM) │
                           └─────────────────┘  └─────────────────┘
```

## Component Responsibilities

### Frontend (React + Vite + TypeScript)
- Patient dashboard and management UI
- 3D brain visualization (React Three Fiber)
- Analysis results display with charts (Chart.js)
- PDF report viewer
- Authentication flow
- Real-time job status updates

### Backend (Node.js + Express + TypeScript)
- **Authentication**: JWT-based auth, role-based access
- **Patient CRUD**: Create, read, update, delete patients
- **File Management**: Upload, validate, store EEG/sMRI/fMRI files
- **Clinical Data**: PANSS assessments, clinical history
- **Analysis Jobs**: Queue, track, manage inference jobs
- **Report Generation**: Trigger PDF reports, manage templates
- **Audit Logging**: All actions logged for compliance
- **API Gateway**: Proxy to FastAPI AI service

### AI Service (FastAPI + Python)
- **EEG Pipeline**: Preprocessing (MNE) → Inference → Results
- **sMRI Pipeline**: Preprocessing (NiBabel/MONAI) → Inference → Results
- **fMRI Pipeline**: Preprocessing (NiBabel/MONAI) → Inference → Results
- **Fusion Module**: Multi-modal integration
- **Explainability**: SHAP, Grad-CAM, attention visualization
- **Model Management**: Load, version, serve models

### Database (PostgreSQL)
- Users, roles, permissions
- Patients with demographics
- File metadata and storage paths
- Clinical assessments (PANSS)
- Analysis jobs and results
- Explanations and visualizations
- Generated reports
- Audit trail

## Data Flow

1. **Patient Creation**: Clinician creates patient record via frontend
2. **File Upload**: Modalities uploaded → validated → stored → metadata saved
3. **Clinical Entry**: PANSS scores entered manually or imported
4. **Analysis Request**: User triggers analysis job
5. **Job Queue**: Backend creates job, calls FastAPI
6. **AI Inference**: FastAPI loads models, runs preprocessing + inference
7. **Results Storage**: Results saved to DB, linked to patient
8. **Explainability**: SHAP/Grad-CAM generated for results
9. **Visualization**: Frontend fetches results, renders 3D brain + charts
10. **Report**: PDF generated on demand with findings + explanations

## Security & Compliance
- No autonomous diagnosis - decision support only
- All predictions labeled as "AI-assisted probability estimates"
- Audit logging for all data access
- Role-based access control (clinician, researcher, admin)
- Data encryption at rest and in transit
- HIPAA/GDPR considerations in design

## Technology Stack Summary

| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, Redux Toolkit, Chart.js, Three.js, React Three Fiber |
| Backend | Node.js 20+, Express, TypeScript, Prisma ORM, JWT, Multer, BullMQ |
| AI Service | Python 3.11+, FastAPI, PyTorch, MNE, NiBabel, MONAI, SHAP, Grad-CAM |
| Database | PostgreSQL 15+ |
| Infrastructure | Docker, Docker Compose, GitHub Actions |