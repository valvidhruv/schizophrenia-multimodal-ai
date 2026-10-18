# API Design Specification

## Base URL
- Development: `http://localhost:3001/api`
- Production: `https://api.domain.com/api`

## Authentication
All endpoints except `/auth/*` require `Authorization: Bearer <JWT>`

### Auth Endpoints
```
POST   /api/auth/login           # Email + password → access + refresh tokens
POST   /api/auth/register        # Admin only - create user
POST   /api/auth/refresh         # Refresh token → new access token
POST   /api/auth/logout          # Invalidate refresh token
GET    /api/auth/me              # Current user profile
PUT    /api/auth/me              # Update profile
PUT    /api/auth/password        # Change password
```

### Token Response
```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "user": {
    "id": "uuid",
    "email": "user@domain.com",
    "fullName": "Dr. Smith",
    "role": "clinician"
  }
}
```

## Patients

### Create Patient
```
POST /api/patients
Body: {
  "subjectId": "SCHZ_001",
  "diagnosis": "schizophrenia",
  "age": 35,
  "sex": "male",
  "handedness": "right"
}
Response: 201 { "id": "uuid", "subjectId": "SCHZ_001", ... }
```

### List Patients (paginated, filtered)
```
GET /api/patients?page=1&limit=20&diagnosis=schizophrenia&search=SCHZ
Response: {
  "data": [...],
  "pagination": { "page": 1, "limit": 20, "total": 150, "totalPages": 8 }
}
```

### Get Patient Detail
```
GET /api/patients/:id
Response: {
  "id": "uuid",
  "subjectId": "SCHZ_001",
  "diagnosis": "schizophrenia",
  "age": 35,
  "sex": "male",
  "eegAvailable": true,
  "smriAvailable": false,
  "fmriAvailable": true,
  "clinicalAvailable": true,
  "panssAvailable": true,
  "files": [...],
  "latestAssessment": {...},
  "latestAnalysis": {...}
}
```

### Update Patient
```
PUT /api/patients/:id
Body: { "diagnosis": "schizoaffective", "age": 36 }
```

### Delete Patient (soft - requires admin)
```
DELETE /api/patients/:id
```

## File Uploads

### Upload EEG
```
POST /api/patients/:id/upload/eeg
Content-Type: multipart/form-data
Fields:
  - file: .edf, .bdf, .set, .fif, .vhdr (max 500MB)
  - metadata: JSON string (optional) - { "task": "resting", "eyes": "closed" }
Response: 201 { "fileId": "uuid", "status": "uploaded" }
```

### Upload sMRI
```
POST /api/patients/:id/upload/smri
Content-Type: multipart/form-data
Fields:
  - file: .nii, .nii.gz, .mgz (max 2GB)
  - metadata: JSON string - { "sequence": "T1w", "resolution": "1mm" }
```

### Upload fMRI
```
POST /api/patients/:id/upload/fmri
Content-Type: multipart/form-data
Fields:
  - file: .nii, .nii.gz (max 2GB)
  - metadata: JSON string - { "task": "rest", "tr": 2.0, "volumes": 300 }
```

### File Validation Endpoint
```
POST /api/patients/:id/files/:fileId/validate
Response: { "valid": true, "metadata": {...}, "errors": [] }
```

### Get Patient Files
```
GET /api/patients/:id/files
Response: [{ "id": "uuid", "modality": "eeg", "fileName": "sub-01_task-rest_eeg.edf", "status": "processed", "uploadedAt": "..." }]
```

## Clinical Assessments (PANSS)

### Create/Update PANSS
```
POST /api/patients/:id/panss
Body: {
  "assessmentDate": "2024-01-15",
  "p1": 4, "p2": 3, "p3": 5, "p4": 2, "p5": 1, "p6": 3, "p7": 2,
  "n1": 4, "n2": 3, "n3": 2, "n4": 3, "n5": 2, "n6": 3, "n7": 2,
  "g1": 2, "g2": 3, "g3": 1, "g4": 2, "g5": 2, "g6": 3, "g7": 2,
  "g8": 1, "g9": 3, "g10": 1, "g11": 2, "g12": 3, "g13": 2,
  "g14": 2, "g15": 2, "g16": 2,
  "notes": "Patient cooperative"
}
Response: 201 { "id": "uuid", "positiveTotal": 20, "negativeTotal": 19, "generalTotal": 33, "panssTotal": 72 }
```

### Get PANSS History
```
GET /api/patients/:id/panss/history
Response: [{ "id": "uuid", "assessmentDate": "2024-01-15", "positiveTotal": 20, "negativeTotal": 19, "generalTotal": 33, "panssTotal": 72, "rater": "Dr. Smith" }]
```

### Get Latest PANSS
```
GET /api/patients/:id/panss/latest
```

## Analysis Jobs

### Create Analysis Job
```
POST /api/analysis/jobs
Body: {
  "patientId": "uuid",
  "jobType": "fusion",
  "inputFileIds": ["uuid1", "uuid2"],
  "parameters": { "modelVersion": "v1.2.0", "threshold": 0.5 }
}
Response: 201 { "jobId": "uuid", "status": "queued" }
```

### Get Job Status
```
GET /api/analysis/jobs/:jobId
Response: { "id": "uuid", "status": "running", "progress": 45, "startedAt": "...", "estimatedCompletion": "..." }
```

### List Jobs for Patient
```
GET /api/analysis/jobs?patientId=uuid&status=completed
```

### Cancel Job
```
POST /api/analysis/jobs/:jobId/cancel
```

## Analysis Results

### Get Latest Results for Patient
```
GET /api/analysis/patients/:patientId/latest
Response: {
  "eeg": { "prediction": "schizophrenia", "probability": 0.87, "confidence": "high", "details": {...} },
  "smri": { "prediction": "schizophrenia", "probability": 0.72, "confidence": "medium", "details": {...} },
  "fmri": { "prediction": "healthy_control", "probability": 0.65, "confidence": "low", "details": {...} },
  "fusion": { "prediction": "schizophrenia", "probability": 0.82, "confidence": "high", "details": {...} }
}
```

### Get Analysis History
```
GET /api/analysis/patients/:patientId/history
Response: [{
  "jobId": "uuid",
  "jobType": "fusion",
  "createdAt": "...",
  "results": { "fusion": { "prediction": "...", "probability": 0.82 } }
}]
```

### Get Specific Result
```
GET /api/analysis/results/:resultId
```

### Get Explanations for Result
```
GET /api/analysis/results/:resultId/explanations
Response: [{
  "type": "shap",
  "modality": "eeg",
  "data": {...},
  "visualization": {...}
}]
```

## Reports

### Generate Report
```
POST /api/reports
Body: {
  "patientId": "uuid",
  "reportType": "comprehensive",
  "includedResultIds": ["uuid1", "uuid2"],
  "templateVersion": "v1.0"
}
Response: 202 { "reportId": "uuid", "status": "generating" }
```

### Get Report Status
```
GET /api/reports/:reportId
Response: { "id": "uuid", "status": "completed", "filePath": "/reports/uuid.pdf", "fileSize": 2048576 }
```

### Download Report
```
GET /api/reports/:reportId/download
Response: PDF file stream
```

### List Patient Reports
```
GET /api/patients/:patientId/reports
```

## Error Response Format
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input",
    "details": [
      { "field": "age", "message": "Must be between 0 and 120" }
    ]
  }
}
```

## HTTP Status Codes
- 200: Success
- 201: Created
- 202: Accepted (async)
- 400: Bad Request
- 401: Unauthorized
- 403: Forbidden
- 404: Not Found
- 409: Conflict
- 422: Unprocessable Entity
- 500: Internal Server Error

## Rate Limiting
- Auth: 10 req/min
- File upload: 5 req/min
- Analysis jobs: 20 req/min
- Reports: 10 req/min