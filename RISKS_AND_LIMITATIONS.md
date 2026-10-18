# Risks and Limitations

## Technical Risks

### 1. GPU Memory Constraints (RTX 4050 6GB VRAM)
**Risk**: Models may exceed VRAM during training/inference
**Impact**: OOM errors, inability to train larger models
**Mitigation**:
- Mixed precision (FP16) mandatory
- Gradient checkpointing for 3D models
- Patch-based inference for sMRI/fMRI
- Batch size 1 for volumetric data
- Model quantization (INT8) for deployment
- CPU offloading for preprocessing
- Clear VRAM between modalities

### 2. Limited Training Data
**Risk**: Public schizophrenia datasets are small (n=100-300 per site)
**Impact**: Overfitting, poor generalization, unreliable metrics
**Mitigation**:
- Subject-level nested cross-validation
- Data augmentation (noise, warping, dropout)
- Transfer learning from large neuroimaging datasets
- Regularization (dropout, weight decay, early stopping)
- Report confidence intervals, not point estimates
- Explicitly label as "prototype - not for clinical use"

### 3. Multi-site Heterogeneity
**Risk**: Different scanners, protocols, preprocessing pipelines
**Impact**: Site effects dominate disease effects
**Mitigation**:
- Harmonization (ComBat, neuroHarmonize)
- Site as covariate
- Domain adaptation
- Train/test splits respect site boundaries
- Document all acquisition parameters

### 4. Modality Alignment
**Risk**: Different subjects across modalities (no true multimodal patients)
**Impact**: Fusion learns dataset artifacts, not biology
**Mitigation**:
- Only fuse when same subject has multiple modalities
- Subject-level metadata tracking (eeg_available, smri_available, etc.)
- Missing modality handling in fusion
- Never fabricate multimodal subjects

### 5. Preprocessing Pipeline Variability
**Risk**: Small preprocessing changes alter results significantly
**Impact**: Non-reproducible findings
**Mitigation**:
- Version-controlled preprocessing parameters
- Containerized preprocessing (Docker)
- Cache preprocessed outputs with parameter hashes
- Document exact pipeline steps

---

## Clinical/Regulatory Risks

### 6. Not a Medical Device
**Risk**: Users may misinterpret as diagnostic tool
**Impact**: Clinical misuse, liability
**Mitigation**:
- Prominent disclaimers on every prediction screen
- "Research prototype / Decision support only" in UI
- No autonomous diagnosis language
- Require clinician sign-off on reports
- Audit trail for all predictions

### 7. Regulatory Compliance
**Risk**: HIPAA, GDPR, FDA SaMD regulations
**Impact**: Legal exposure, cannot deploy clinically
**Mitigation**:
- Design for compliance from start
- No PHI in logs
- Encryption at rest/transit
- Access controls and audit logs
- Data deletion workflows
- Consult regulatory expert before clinical deployment

### 8. Bias and Fairness
**Risk**: Models trained on WEIRD populations (Western, Educated, Industrialized, Rich, Democratic)
**Impact**: Poor performance on underrepresented groups
**Mitigation**:
- Document training demographics
- Evaluate performance by age, sex, ethnicity subgroups
- Report disparities
- Collect diverse data
- Fairness metrics in evaluation

---

## Data Science Risks

### 9. Data Leakage
**Risk**: Subject-level splits not respected; preprocessing on full dataset
**Impact**: Inflated performance metrics
**Mitigation**:
- Subject-level splits ONLY
- Preprocessing fit on train, apply to test
- Nested cross-validation
- Automated leakage detection in CI

### 10. Multiple Comparisons
**Risk**: Testing many models/configurations, reporting best
**Impact**: False positive findings
**Mitigation**:
- Pre-register analysis plan
- Correct for multiple comparisons
- Report all experiments, not just best
- Hold-out test set untouched until final evaluation

### 11. Metric Fabrication
**Risk**: Pressure to report good numbers
**Impact**: Scientific fraud, loss of credibility
**Mitigation**:
- NEVER fabricate metrics (hard rule in AGENTS.md)
- All metrics from actual evaluation scripts
- Version-controlled evaluation notebooks
- Raw predictions saved for audit

---

## Operational Risks

### 12. Model Drift
**Risk**: Performance degrades on new data/scanners
**Impact**: Unreliable predictions over time
**Mitigation**:
- Monitor prediction distributions
- Periodic re-evaluation on new data
- Model versioning and rollback
- Retraining pipeline

### 13. Dependency Vulnerabilities
**Risk**: ML ecosystem moves fast; security vulnerabilities
**Impact**: Supply chain attacks
**Mitigation**:
- Pin dependency versions
- Automated security scanning (Dependabot, Snyk)
- Minimal dependencies
- Regular updates in controlled manner

### 14. Single Point of Failure
**Risk**: AI service GPU node failure
**Impact**: No predictions available
**Mitigation**:
- Health checks and auto-restart
- Queue persistence (Redis)
- Graceful degradation (return cached results)
- Multi-GPU support for future

---

## Limitations

### 1. Prototype Scope
- Not validated for clinical use
- Limited to research/decision-support context
- No regulatory clearance
- Small sample sizes in public datasets

### 2. Modalities
- EEG: Resting-state eyes-closed only (initially)
- sMRI: T1w only (no DTI, FLAIR, etc.)
- fMRI: Resting-state only (no task fMRI initially)
- Clinical: PANSS only (no other scales initially)

### 3. Population
- Adult schizophrenia vs healthy controls
- Not validated for: prodromal, first-episode, pediatric, geriatric
- Not differential diagnosis (bipolar, schizoaffective, etc.)

### 4. Hardware
- Single GPU (RTX 4050 6GB)
- No multi-GPU training
- No distributed training
- CPU-only fallback not optimized

### 5. Explainability
- SHAP approximations for deep models (KernelSHAP slow)
- Grad-CAM limited to CNN architectures
- Attention weights ≠ causal explanations
- Clinical interpretability not validated

### 6. Deployment
- Local/docker only initially
- No cloud deployment configured
- No horizontal scaling
- No model A/B testing framework

---

## Risk Register Summary

| ID | Risk | Likelihood | Impact | Priority | Mitigation Status |
|----|------|------------|--------|----------|-------------------|
| T1 | GPU OOM | High | High | Critical | Designed for |
| T2 | Small data | High | High | Critical | CV + augmentation |
| T3 | Site effects | High | High | Critical | Harmonization |
| T4 | Modality alignment | Medium | High | High | Metadata tracking |
| T5 | Preprocessing variability | Medium | Medium | High | Versioned pipelines |
| C1 | Misuse as diagnostic | Medium | Critical | Critical | UI disclaimers |
| C2 | Regulatory | Low | Critical | High | Design for compliance |
| C3 | Bias | High | High | High | Subgroup analysis |
| D1 | Data leakage | Medium | Critical | Critical | Nested CV enforced |
| D2 | Multiple comparisons | Medium | High | High | Pre-registration |
| D3 | Fabricated metrics | Low | Critical | Critical | **Hard rule** |
| O1 | Model drift | Medium | Medium | Medium | Monitoring |
| O2 | Dependencies | Medium | Medium | Medium | Pinning + scanning |
| O3 | SPOF | Low | High | Medium | Queue persistence |

---

## Acceptance Criteria for Production Readiness

Before any clinical pilot:
- [ ] All risks rated Medium+ have documented mitigations
- [ ] External validation on held-out site
- [ ] Bias analysis across demographics
- [ ] Regulatory pathway defined
- [ ] Clinical workflow integration tested
- [ ] Liability insurance obtained
- [ ] IRB approval for study