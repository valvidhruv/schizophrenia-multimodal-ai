# FastAPI AI Service Architecture

## Service Structure

```
ai-service/
├── app/
│   ├── __init__.py
│   ├── main.py                 # FastAPI app factory
│   ├── config.py               # Settings management
│   ├── dependencies.py         # Dependency injection
│   ├── middleware/             # Custom middleware
│   ├── routes/
│   │   ├── __init__.py
│   │   ├── health.py           # /health, /ready
│   │   ├── eeg.py              # POST /eeg
│   │   ├── smri.py             # POST /smri
│   │   ├── fmri.py             # POST /fmri
│   │   ├── fusion.py           # POST /fusion
│   │   └── explain.py          # POST /explain
│   ├── models/
│   │   ├── __init__.py
│   │   ├── registry.py         # Model loading/versioning
│   │   ├── eeg/
│   │   │   ├── __init__.py
│   │   │   ├── architecture.py # EEGNet, TCN, etc.
│   │   │   ├── preprocessing.py
│   │   │   └── inference.py
│   │   ├── smri/
│   │   │   ├── __init__.py
│   │   │   ├── architecture.py # 3D CNN, ResNet3D
│   │   │   ├── preprocessing.py
│   │   │   └── inference.py
│   │   ├── fmri/
│   │   │   ├── __init__.py
│   │   │   ├── architecture.py # 4D CNN, Graph NN
│   │   │   ├── preprocessing.py
│   │   │   └── inference.py
│   │   ├── fusion/
│   │   │   ├── __init__.py
│   │   │   ├── architectures.py
│   │   │   └── inference.py
│   │   └── clinical/
│   │       ├── __init__.py
│   │       ├── architecture.py # MLP, TabTransformer
│   │       ├── preprocessing.py
│   │       └── inference.py
│   ├── explainability/
│   │   ├── __init__.py
│   │   ├── shap_explainer.py
│   │   ├── gradcam.py
│   │   ├── attention_viz.py
│   │   └── feature_importance.py
│   ├── preprocessing/
│   │   ├── __init__.py
│   │   ├── eeg_preprocessor.py
│   │   ├── smri_preprocessor.py
│   │   ├── fmri_preprocessor.py
│   │   └── clinical_preprocessor.py
│   ├── schemas/
│   │   ├── __init__.py
│   │   ├── requests.py
│   │   └── responses.py
│   ├── utils/
│   │   ├── __init__.py
│   │   ├── gpu_memory.py
│   │   ├── caching.py
│   │   └── file_utils.py
│   └── workers/
│       ├── __init__.py
│       ├── job_queue.py
│       └── model_worker.py
├── models/                     # Model weights (gitignored)
│   ├── eeg/
│   ├── smri/
│   ├── fmri/
│   ├── fusion/
│   └── clinical/
├── cache/                      # Preprocessed data cache
├── tests/
├── requirements.txt
├── requirements-dev.txt
├── Dockerfile
├── pyproject.toml
└── README.md
```

## API Endpoints

### Health Checks
```
GET /health          # Liveness probe
GET /ready           # Readiness probe (models loaded)
```

### EEG Inference
```
POST /eeg
Body: {
  "file_path": "/data/eeg/sub-01_task-rest_eeg.edf",
  "subject_id": "SCHZ_001",
  "model_version": "eeg_v1.2.0",
  "preprocessing_params": {
    "l_freq": 0.5,
    "h_freq": 100,
    "notch_freq": 50,
    "ica": true
  }
}
Response: {
  "prediction": "schizophrenia",
  "probability": 0.87,
  "confidence": "high",
  "latency_ms": 1250,
  "preprocessing_info": {...},
  "features": {...}
}
```

### sMRI Inference
```
POST /smri
Body: {
  "file_path": "/data/smri/sub-01_T1w.nii.gz",
  "subject_id": "SCHZ_001",
  "model_version": "smri_v1.0.0",
  "preprocessing_params": {
    "template": "MNI152",
    "resolution": "1mm"
  }
}
```

### fMRI Inference
```
POST /fmri
Body: {
  "file_path": "/data/fmri/sub-01_task-rest_bold.nii.gz",
  "subject_id": "SCHZ_001",
  "model_version": "fmri_v1.0.0",
  "preprocessing_params": {
    "tr": 2.0,
    "slice_timing": true,
    "motion_correction": true,
    "spatial_smoothing": 6
  }
}
```

### Fusion Inference
```
POST /fusion
Body: {
  "subject_id": "SCHZ_001",
  "modalities": ["eeg", "smri", "clinical"],
  "model_version": "fusion_v1.0.0",
  "fusion_method": "attention",
  "individual_results": {
    "eeg": {"probability": 0.87, "features": {...}},
    "smri": {"probability": 0.72, "features": {...}},
    "clinical": {"probability": 0.78, "features": {...}}
  }
}
```

### Explainability
```
POST /explain
Body: {
  "result_id": "uuid",
  "modality": "eeg",
  "methods": ["shap", "gradcam"],
  "num_samples": 100
}
Response: {
  "explanations": [
    {
      "method": "shap",
      "modality": "eeg",
      "values": [...],
      "feature_names": [...],
      "visualization_data": {...}
    }
  ]
}
```

## Model Registry

### Model Versioning
```
models/
├── eeg/
│   ├── v1.0.0/
│   │   ├── model.pt
│   │   ├── config.json
│   │   └── metrics.json
│   └── v1.2.0/ (latest)
├── smri/
├── fmri/
├── fusion/
└── clinical/
```

### Model Config (config.json)
```json
{
  "name": "EEGNet",
  "version": "1.2.0",
  "input_shape": [1, 64, 1000],
  "num_classes": 2,
  "class_names": ["healthy_control", "schizophrenia"],
  "training_dataset": "COBRE+BSNIP",
  "metrics": {
    "accuracy": 0.82,
    "auc": 0.89,
    "sensitivity": 0.85,
    "specificity": 0.79
  },
  "preprocessing": {
    "l_freq": 0.5,
    "h_freq": 100,
    "notch_freq": 50,
    "resample": 250
  },
  "hardware_requirements": {
    "min_vram_gb": 2,
    "recommended_vram_gb": 4
  }
}
```

## Preprocessing Pipelines

### EEG (MNE-based)
```python
# Steps:
1. Load raw (EDF/BDF/SET/FIF)
2. Resample to 250 Hz
3. Bandpass 0.5-100 Hz
4. Notch filter 50/60 Hz
5. Bad channel detection (RANSAC)
6. Re-reference (average)
7. ICA for artifact removal (eye, muscle)
8. Epoching (2s windows, 50% overlap)
9. Feature extraction: band power, connectivity, spectral
10. Normalize (z-score per subject)
```

### sMRI (MONAI/NiBabel)
```python
# Steps:
1. Load NIfTI
2. Reorient to RAS
3. N4 bias field correction
4. Skull stripping (HD-BET or SynthStrip)
5. Registration to MNI152 1mm
6. Tissue segmentation (FAST/SPM)
7. Parcellation (Desikan-Killiany / Schaefer)
8. Extract: volumes, thickness, surface area
9. VBM: modulation + smoothing (8mm)
10. Normalize (z-score per site)
```

### fMRI (MONAI/NiBabel/Nilearn)
```python
# Steps:
1. Load NIfTI
2. Slice timing correction
3. Motion correction (MCFLIRT)
4. Coregistration to T1w
5. Normalization to MNI
6. Spatial smoothing (6mm FWHM)
7. Temporal filtering (0.01-0.1 Hz)
8. Nuisance regression (WM, CSF, motion)
9. Parcellation (Schaefer 400 / AAL)
10. Compute correlation matrices
11. Graph metrics: degree, clustering, efficiency
```

## RTX 4050 6GB Optimization

### Memory Management
```python
# In config.py
class GPUConfig:
    MAX_VRAM_GB = 5.5  # Leave 0.5GB buffer
    USE_MIXED_PRECISION = True
    GRADIENT_CHECKPOINTING = True
    BATCH_SIZE_EEG = 16
    BATCH_SIZE_SMRI = 1   # 3D volumes
    BATCH_SIZE_FMRI = 1   # 4D volumes
    BATCH_SIZE_FUSION = 8
```

### Model Loading Strategy
```python
# Lazy loading with caching
class ModelRegistry:
    _cache = {}

    @classmethod
    def get_model(cls, modality: str, version: str):
        key = f"{modality}:{version}"
        if key not in cls._cache:
            cls._cache[key] = cls._load_model(modality, version)
        return cls._cache[key]

    @classmethod
    def _load_model(cls, modality, version):
        # Clear cache if needed
        if torch.cuda.memory_allocated() > 4.5 * 1024**3:
            cls._clear_oldest()
        # Load with mixed precision
        model = torch.load(path, map_location='cuda')
        model = model.half() if USE_MIXED_PRECISION else model
        model.eval()
        return model
```

### Inference Optimization
```python
# Use torch.compile (PyTorch 2.0+)
model = torch.compile(model, mode="reduce-overhead")

# Batch processing for EEG
@torch.inference_mode()
def infer_eeg_batch(model, batch):
    with torch.autocast(device_type='cuda', dtype=torch.float16):
        return model(batch)

# Gradient checkpointing for 3D models
model.gradient_checkpointing_enable()
```

## Caching Strategy

### Preprocessed Data Cache
```
cache/
├── eeg/
│   ├── SCHZ_001/
│   │   ├── preprocessed.npy
│   │   ├── features.npy
│   │   └── metadata.json
├── smri/
│   └── SCHZ_001/
├── fmri/
│   └── SCHZ_001/
└── clinical/
    └── SCHZ_001/
```

### Cache Invalidation
- Key: `{subject_id}_{file_checksum}_{preprocessing_params_hash}`
- TTL: 30 days
- Max cache size: 50 GB

## Job Queue (Redis + BullMQ compatible)

```python
# Worker process
async def process_job(job_data):
    job_id = job_data["job_id"]
    modality = job_data["modality"]

    # Update status: running
    await update_job_status(job_id, "running", progress=0)

    # Preprocess (with progress updates)
    preprocessed = await preprocess(modality, job_data, progress_callback)

    # Inference
    result = await inference(modality, preprocessed, job_data["model_version"])

    # Explainability (async, non-blocking)
    if job_data.get("explain", False):
        asyncio.create_task(generate_explanations(job_id, result))

    # Save results
    await save_results(job_id, result)

    # Update status: completed
    await update_job_status(job_id, "completed", progress=100)
```

## Configuration (Pydantic Settings)

```python
# config.py
class Settings(BaseSettings):
    # Service
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    WORKERS: int = 1

    # Model paths
    MODEL_DIR: Path = Path("/app/models")
    CACHE_DIR: Path = Path("/app/cache")

    # GPU
    CUDA_VISIBLE_DEVICES: str = "0"
    MAX_VRAM_GB: float = 5.5
    USE_MIXED_PRECISION: bool = True

    # Preprocessing
    EEG_TARGET_SR: int = 250
    SMRI_TEMPLATE: str = "MNI152_1mm"
    FMRI_TR: float = 2.0

    # External
    REDIS_URL: str = "redis://redis:6379/0"
    POSTGRES_URL: str = "postgresql://..."

    # Logging
    LOG_LEVEL: str = "INFO"

    class Config:
        env_file = ".env"
```

## Development Workflow

### Adding New Model
1. Create architecture in `models/{modality}/architecture.py`
2. Add preprocessing in `preprocessing/{modality}_preprocessor.py`
3. Create inference wrapper in `models/{modality}/inference.py`
4. Add route in `routes/{modality}.py`
5. Register in `models/registry.py`
6. Add tests in `tests/test_{modality}.py`
7. Document in `docs/models/{modality}.md`

### Testing
```bash
# Unit tests
pytest tests/ -v

# Integration test with sample data
pytest tests/integration/ -v

# Memory profiling
pytest tests/test_memory.py -v --memray
```

## Deployment

### Dockerfile
```dockerfile
FROM pytorch/pytorch:2.1-cuda12.1-cudnn8-runtime

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
```

### Docker Compose Service
```yaml
ai-service:
  build: ./ai-service
  deploy:
    resources:
      reservations:
        devices:
          - driver: nvidia
            count: 1
            capabilities: [gpu]
  environment:
    - CUDA_VISIBLE_DEVICES=0
    - MAX_VRAM_GB=5.5
  volumes:
    - ./ai-service/models:/app/models:ro
    - ./ai-service/cache:/app/cache
    - ./datasets:/data:ro
  depends_on:
    - redis
```