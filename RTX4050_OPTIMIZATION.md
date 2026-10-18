# RTX 4050 6GB Optimization Strategy

## Hardware Specifications
- **GPU**: NVIDIA RTX 4050 Laptop GPU
- **VRAM**: 6 GB GDDR6
- **CUDA Cores**: 2560
- **Tensor Cores**: 80 (4th gen)
- **System RAM**: 16 GB DDR5
- **Driver**: 550+ (CUDA 12.3+)

## Memory Budget

```
Total VRAM: 6144 MB
├── OS/Display:     ~500 MB (fixed)
├── PyTorch overhead: ~300 MB
├── Available:      ~5344 MB
│
├── Target per modality (inference):
│   ├── EEG:          1500 MB (batch 16, FP16)
│   ├── sMRI:         4500 MB (patch-based, batch 1, FP16)
│   ├── fMRI:         3000 MB (ROI-based, batch 1, FP16)
│   ├── Clinical:     200 MB (tiny MLP)
│   └── Fusion:       2000 MB (attention, batch 8)
│
└── Training (sequential, not parallel):
    ├── EEG:          4000 MB (batch 8-16, grad accum)
    ├── sMRI:         5000 MB (batch 1, grad accum 4)
    ├── fMRI:         4500 MB (batch 1, grad accum 4)
    └── Fusion:       3500 MB (batch 4-8)
```

## Optimization Techniques

### 1. Mixed Precision (FP16) - MANDATORY
```python
# Enable globally
torch.set_float32_matmul_precision('high')

# In training
scaler = torch.amp.GradScaler('cuda')
with torch.amp.autocast('cuda'):
    loss = model(x)
scaler.scale(loss).backward()
scaler.step(optimizer)
scaler.update()

# In inference
model.half()
with torch.inference_mode(), torch.amp.autocast('cuda'):
    output = model(input.half())
```
**Savings**: ~40-50% VRAM for model weights + activations

### 2. Gradient Checkpointing
```python
# For 3D CNNs (sMRI) and Transformers
model.gradient_checkpointing_enable()

# Or manual
from torch.utils.checkpoint import checkpoint
def forward(self, x):
    return checkpoint(self.layer, x, use_reentrant=False)
```
**Savings**: ~30% activation memory, ~20% slower

### 3. Gradient Accumulation
```python
# Effective batch size = batch_size * accum_steps
accum_steps = 4
for i, batch in enumerate(dataloader):
    loss = model(batch) / accum_steps
    scaler.scale(loss).backward()
    if (i + 1) % accum_steps == 0:
        scaler.step(optimizer)
        scaler.update()
        optimizer.zero_grad()
```
**Enables**: Larger effective batches without VRAM increase

### 4. Patch-Based Inference (sMRI/fMRI)
```python
# Instead of full 121x145x121 volume
# Process 64x64x64 patches with overlap
patch_size = 64
stride = 32
patches = extract_patches(volume, patch_size, stride)
outputs = []
for patch in patches:
    with torch.inference_mode():
        out = model(patch.unsqueeze(0))
    outputs.append(out)
reconstructed = stitch_patches(outputs, volume.shape, stride)
```
**Enables**: Full-volume inference on 6GB

### 5. Model Quantization (INT8)
```python
# Post-training quantization
model_int8 = torch.quantization.quantize_dynamic(
    model, {nn.Linear, nn.Conv3d}, dtype=torch.qint8
)

# Or TensorRT for deployment
import tensorrt as trt
# Export ONNX → TensorRT engine
```
**Savings**: ~75% model size, ~2-3x faster inference

### 6. torch.compile (PyTorch 2.0+)
```python
# Reduces overhead, fuses kernels
model = torch.compile(model, mode="reduce-overhead", fullgraph=True)
# For dynamic shapes
model = torch.compile(model, mode="max-autotune")
```
**Speedup**: 10-30% inference speed

### 7. Flash Attention (if using attention)
```python
# For fusion attention modules
from flash_attn import flash_attn_func
# Or use PyTorch's scaled_dot_product_attention (2.0+)
with torch.backends.cuda.sdp_kernel(enable_flash=True):
    attn = F.scaled_dot_product_attention(q, k, v)
```
**Savings**: ~2x memory for attention, faster

### 8. CPU Offloading for Preprocessing
```python
# Keep preprocessing on CPU, only inference on GPU
def preprocess_on_cpu(file_path):
    # All MNE/NiBabel/Nilearn operations
    return preprocessed_numpy_array

# Transfer only final tensor to GPU
tensor = torch.from_numpy(array).pin_memory().cuda(non_blocking=True)
```

### 9. Memory-Efficient Data Loading
```python
# Use memory mapping for large files
data = np.load(file_path, mmap_mode='r')

# Pin memory for faster GPU transfer
dataloader = DataLoader(dataset, pin_memory=True, num_workers=4)

# Prefetch to GPU
from torch.utils.data import DataLoader
prefetcher = DataPrefetcher(dataloader)
```

### 10. Clear Cache Between Modalities
```python
def clear_gpu_memory():
    torch.cuda.empty_cache()
    torch.cuda.ipc_collect()
    gc.collect()

# In inference pipeline
def run_modality(modality, data):
    clear_gpu_memory()
    model = load_model(modality)
    result = model(data)
    unload_model(model)
    clear_gpu_memory()
    return result
```

## Model Architecture Choices for 6GB

### EEG (1D/2D - Fits Easily)
| Architecture | Params | VRAM (inf) | VRAM (train) |
|--------------|--------|------------|--------------|
| EEGNet | ~300K | 200 MB | 1500 MB |
| TCN | ~500K | 300 MB | 2000 MB |
| ShallowConvNet | ~200K | 150 MB | 1000 MB |

**Recommendation**: EEGNet (proven, lightweight, interpretable)

### sMRI (3D - Challenging)
| Architecture | Input | Params | VRAM (inf) | Strategy |
|--------------|-------|--------|------------|----------|
| 3D ResNet18 | 64³ | 11M | 3500 MB | Patch-based |
| 3D ResNet10 | 64³ | 3M | 2000 MB | Patch-based |
| Med3D (pretrained) | 64³ | 11M | 3500 MB | Patch + grad ckpt |
| VoxelCNN (custom) | 32³ | 1M | 1000 MB | Full volume |

**Recommendation**: 3D ResNet10 + patch inference + gradient checkpointing

### fMRI (Graph/2D - Moderate)
| Architecture | Input | Params | VRAM (inf) | Strategy |
|--------------|-------|--------|------------|----------|
| GAT (2-layer) | 200×200 | 500K | 800 MB | Full matrix |
| GCN | 200×200 | 300K | 600 MB | Full matrix |
| MLP on metrics | 500 | 100K | 100 MB | Trivial |
| BrainNetCNN | 200×200 | 2M | 1500 MB | Full matrix |

**Recommendation**: GAT on connectivity + MLP on graph metrics (ensemble)

### Fusion (Lightweight)
| Architecture | Params | VRAM | Strategy |
|--------------|--------|------|----------|
| Weighted avg | 0 | 0 MB | Baseline |
| Concat + MLP | 100K | 500 MB | Simple |
| Cross-attention | 500K | 1500 MB | FlashAttn |
| Tensor fusion | 1M | 2000 MB | Avoid |

**Recommendation**: Start with concat+MLP, then cross-attention with Flash Attention

## Training Strategies

### Sequential Training (Not Parallel)
```
Phase 1: Train EEG model    (max 4GB) → save → clear GPU
Phase 2: Train sMRI model   (max 5GB) → save → clear GPU
Phase 3: Train fMRI model   (max 4GB) → save → clear GPU
Phase 4: Train Clinical     (max 1GB) → save → clear GPU
Phase 5: Train Fusion       (max 3GB) → save
```

### Distillation for Deployment
```python
# Train large model (teacher) with grad accum
# Distill to smaller student for inference
student = SmallModel()
teacher = LargeModel()
loss = CE(student(x), y) + KL(student(x), teacher(x).detach())
```

## Monitoring

```python
# In training/inference
def log_gpu_memory(stage):
    allocated = torch.cuda.memory_allocated() / 1024**3
    reserved = torch.cuda.memory_reserved() / 1024**3
    max_allocated = torch.cuda.max_memory_allocated() / 1024**3
    logger.info(f"[{stage}] Allocated: {allocated:.2f}GB, Reserved: {reserved:.2f}GB, Peak: {max_allocated:.2f}GB")
    return allocated

# Alert if > 5.5GB
if log_gpu_memory("pre-inference") > 5.5:
    raise RuntimeError("VRAM budget exceeded")
```

## Benchmark Targets

| Task | Target Latency | Target VRAM | Batch Size |
|------|---------------|-------------|------------|
| EEG inference | < 500ms | < 1.5GB | 16 |
| sMRI inference | < 30s | < 5GB | 1 (patches) |
| fMRI inference | < 10s | < 3GB | 1 |
| Clinical inference | < 50ms | < 200MB | 32 |
| Fusion inference | < 2s | < 2GB | 8 |
| Full pipeline | < 60s | < 6GB (sequential) | N/A |

## Configuration File

```yaml
# ai-service/config/hardware.yaml
gpu:
  device: "cuda:0"
  max_vram_gb: 5.5
  mixed_precision: true
  gradient_checkpointing: true
  compile: true
  flash_attention: true

batch_sizes:
  eeg_train: 8
  eeg_infer: 16
  smri_train: 1
  smri_infer: 1  # patch-based
  fmri_train: 1
  fmri_infer: 1
  clinical_train: 32
  clinical_infer: 32
  fusion_train: 4
  fusion_infer: 8

grad_accum:
  eeg: 2
  smri: 4
  fmri: 4
  fusion: 2

models:
  eeg:
    architecture: "EEGNet"
    input_shape: [1, 64, 1000]  # channels, timepoints
    patch_inference: false
  smri:
    architecture: "ResNet3D_10"
    input_shape: [1, 64, 64, 64]  # patch size
    patch_size: 64
    patch_stride: 32
    gradient_checkpointing: true
  fmri:
    architecture: "GAT"
    input_shape: [200, 200]  # connectivity matrix
    hidden_dim: 128
    heads: 4
  clinical:
    architecture: "MLP"
    input_dim: 35  # 30 PANSS + 5 demo
    hidden_dims: [128, 64]
  fusion:
    architecture: "CrossAttention"
    modality_dims: {"eeg": 128, "smri": 128, "fmri": 128, "clinical": 64}
    fusion_dim: 256
    heads: 4
    flash_attention: true
```

## Emergency Procedures

### OOM During Training
1. Reduce batch size by half
2. Double gradient accumulation
3. Enable gradient checkpointing
4. Reduce model size (channels, layers)
5. Use CPU offloading for embeddings

### OOM During Inference
1. Reduce patch size (sMRI)
2. Process sequentially (not batch)
3. Clear cache between subjects
4. Use INT8 quantization

### Thermal Throttling
- Monitor GPU temp: `nvidia-smi -q -d TEMPERATURE`
- If > 83°C: reduce power limit `nvidia-smi -pl 120`
- Ensure laptop ventilation