-- 0001_initial_schema.sql
-- Phase 1B: initial schema from DATABASE_SCHEMA.md.
--
-- Applied by backend/src/migrate.ts inside a single transaction. Applied files are
-- immutable; the runner records a SHA-256 checksum and refuses to continue if a
-- previously applied file changes.
--
-- Extensions: gen_random_uuid() is required by the documented schema and comes from
-- pgcrypto on PostgreSQL < 13 (core on 13+). scripts/init-db.sql also creates the
-- extensions for the Docker entrypoint; this statement keeps the migration
-- self-contained. Environment-specific GRANTS stay in scripts/init-db.sql.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'clinician', 'researcher')),
    is_active BOOLEAN DEFAULT true,
    last_login TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ---------------------------------------------------------------------------
-- patients
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id VARCHAR(100) UNIQUE NOT NULL,
    diagnosis VARCHAR(50) CHECK (diagnosis IN ('schizophrenia', 'healthy_control', 'bipolar', 'schizoaffective', 'other', 'unknown')),
    age INTEGER CHECK (age >= 0 AND age <= 120),
    sex VARCHAR(20) CHECK (sex IN ('male', 'female', 'other', 'unknown')),
    handedness VARCHAR(20) CHECK (handedness IN ('right', 'left', 'ambidextrous', 'unknown')),
    eeg_available BOOLEAN DEFAULT false,
    smri_available BOOLEAN DEFAULT false,
    fmri_available BOOLEAN DEFAULT false,
    clinical_available BOOLEAN DEFAULT false,
    panss_available BOOLEAN DEFAULT false,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patients_subject_id ON patients(subject_id);
CREATE INDEX IF NOT EXISTS idx_patients_diagnosis ON patients(diagnosis);
CREATE INDEX IF NOT EXISTS idx_patients_created_by ON patients(created_by);

-- ---------------------------------------------------------------------------
-- patient_files
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patient_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    modality VARCHAR(20) NOT NULL CHECK (modality IN ('eeg', 'smri', 'fmri', 'clinical')),
    file_path VARCHAR(500) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    mime_type VARCHAR(100),
    checksum VARCHAR(64),
    metadata JSONB DEFAULT '{}',
    status VARCHAR(30) DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'validated', 'processing', 'processed', 'failed')),
    uploaded_by UUID REFERENCES users(id),
    uploaded_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_patient_files_patient_id ON patient_files(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_files_modality ON patient_files(modality);
CREATE INDEX IF NOT EXISTS idx_patient_files_status ON patient_files(status);

-- ---------------------------------------------------------------------------
-- clinical_assessments (PANSS)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinical_assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    assessment_type VARCHAR(50) NOT NULL DEFAULT 'panss',
    assessment_date DATE NOT NULL,
    p1_delusions INTEGER CHECK (p1_delusions BETWEEN 1 AND 7),
    p2_conceptual_disorg INTEGER CHECK (p2_conceptual_disorg BETWEEN 1 AND 7),
    p3_hallucinatory INTEGER CHECK (p3_hallucinatory BETWEEN 1 AND 7),
    p4_excitement INTEGER CHECK (p4_excitement BETWEEN 1 AND 7),
    p5_grandiosity INTEGER CHECK (p5_grandiosity BETWEEN 1 AND 7),
    p6_suspiciousness INTEGER CHECK (p6_suspiciousness BETWEEN 1 AND 7),
    p7_hostility INTEGER CHECK (p7_hostility BETWEEN 1 AND 7),
    n1_blunted_affect INTEGER CHECK (n1_blunted_affect BETWEEN 1 AND 7),
    n2_emotional_withdrawal INTEGER CHECK (n2_emotional_withdrawal BETWEEN 1 AND 7),
    n3_poor_rapport INTEGER CHECK (n3_poor_rapport BETWEEN 1 AND 7),
    n4_passive_social_withdrawal INTEGER CHECK (n4_passive_social_withdrawal BETWEEN 1 AND 7),
    n5_difficulty_abstract_thinking INTEGER CHECK (n5_difficulty_abstract_thinking BETWEEN 1 AND 7),
    n6_lack_spontaneity INTEGER CHECK (n6_lack_spontaneity BETWEEN 1 AND 7),
    n7_stereotyped_thinking INTEGER CHECK (n7_stereotyped_thinking BETWEEN 1 AND 7),
    g1_somatic_concern INTEGER CHECK (g1_somatic_concern BETWEEN 1 AND 7),
    g2_anxiety INTEGER CHECK (g2_anxiety BETWEEN 1 AND 7),
    g3_guilt_feelings INTEGER CHECK (g3_guilt_feelings BETWEEN 1 AND 7),
    g4_tension INTEGER CHECK (g4_tension BETWEEN 1 AND 7),
    g5_mannerisms_posturing INTEGER CHECK (g5_mannerisms_posturing BETWEEN 1 AND 7),
    g6_depression INTEGER CHECK (g6_depression BETWEEN 1 AND 7),
    g7_motor_retardation INTEGER CHECK (g7_motor_retardation BETWEEN 1 AND 7),
    g8_uncooperativeness INTEGER CHECK (g8_uncooperativeness BETWEEN 1 AND 7),
    g9_unusual_thought_content INTEGER CHECK (g9_unusual_thought_content BETWEEN 1 AND 7),
    g10_disorientation INTEGER CHECK (g10_disorientation BETWEEN 1 AND 7),
    g11_poor_attention INTEGER CHECK (g11_poor_attention BETWEEN 1 AND 7),
    g12_lack_judgment_insight INTEGER CHECK (g12_lack_judgment_insight BETWEEN 1 AND 7),
    g13_disturbance_volition INTEGER CHECK (g13_disturbance_volition BETWEEN 1 AND 7),
    g14_poor_impulse_control INTEGER CHECK (g14_poor_impulse_control BETWEEN 1 AND 7),
    g15_preoccupation INTEGER CHECK (g15_preoccupation BETWEEN 1 AND 7),
    g16_active_social_avoidance INTEGER CHECK (g16_active_social_avoidance BETWEEN 1 AND 7),
    positive_total INTEGER,
    negative_total INTEGER,
    general_total INTEGER,
    panss_total INTEGER,
    rater_id UUID REFERENCES users(id),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clinical_assessments_patient_id ON clinical_assessments(patient_id);
CREATE INDEX IF NOT EXISTS idx_clinical_assessments_date ON clinical_assessments(assessment_date);

-- ---------------------------------------------------------------------------
-- analysis_jobs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analysis_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    job_type VARCHAR(30) NOT NULL CHECK (job_type IN ('eeg', 'smri', 'fmri', 'fusion', 'full_pipeline')),
    status VARCHAR(30) DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'running', 'completed', 'failed', 'cancelled')),
    priority INTEGER DEFAULT 0,
    input_files JSONB DEFAULT '[]',
    parameters JSONB DEFAULT '{}',
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analysis_jobs_patient_id ON analysis_jobs(patient_id);
CREATE INDEX IF NOT EXISTS idx_analysis_jobs_status ON analysis_jobs(status);
CREATE INDEX IF NOT EXISTS idx_analysis_jobs_created_at ON analysis_jobs(created_at);

-- ---------------------------------------------------------------------------
-- analysis_results
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analysis_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES analysis_jobs(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    modality VARCHAR(20) NOT NULL CHECK (modality IN ('eeg', 'smri', 'fmri', 'fusion')),
    model_version VARCHAR(50) NOT NULL,
    prediction_label VARCHAR(50),
    prediction_probability DECIMAL(5,4),
    confidence_level VARCHAR(20) CHECK (confidence_level IN ('low', 'medium', 'high')),
    raw_output JSONB DEFAULT '{}',
    metrics JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analysis_results_job_id ON analysis_results(job_id);
CREATE INDEX IF NOT EXISTS idx_analysis_results_patient_id ON analysis_results(patient_id);
CREATE INDEX IF NOT EXISTS idx_analysis_results_modality ON analysis_results(modality);

-- ---------------------------------------------------------------------------
-- eeg_results
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS eeg_results (
    result_id UUID PRIMARY KEY REFERENCES analysis_results(id) ON DELETE CASCADE,
    sampling_rate INTEGER,
    n_channels INTEGER,
    duration_seconds DECIMAL(10,2),
    preprocessing_steps JSONB DEFAULT '[]',
    bad_channels JSONB DEFAULT '[]',
    ica_components_removed INTEGER,
    features_extracted JSONB DEFAULT '{}',
    delta_power DECIMAL(10,4),
    theta_power DECIMAL(10,4),
    alpha_power DECIMAL(10,4),
    beta_power DECIMAL(10,4),
    gamma_power DECIMAL(10,4),
    channel_importance JSONB DEFAULT '{}'
);

-- ---------------------------------------------------------------------------
-- smri_results
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS smri_results (
    result_id UUID PRIMARY KEY REFERENCES analysis_results(id) ON DELETE CASCADE,
    voxel_size_mm JSONB DEFAULT '{}',
    brain_volume_ml DECIMAL(10,2),
    gray_matter_volume_ml DECIMAL(10,2),
    white_matter_volume_ml DECIMAL(10,2),
    csf_volume_ml DECIMAL(10,2),
    regional_volumes JSONB DEFAULT '{}',
    cortical_thickness JSONB DEFAULT '{}',
    surface_area JSONB DEFAULT '{}',
    vbm_significant_clusters JSONB DEFAULT '[]'
);

-- ---------------------------------------------------------------------------
-- fmri_results
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fmri_results (
    result_id UUID PRIMARY KEY REFERENCES analysis_results(id) ON DELETE CASCADE,
    tr_seconds DECIMAL(5,3),
    n_volumes INTEGER,
    preprocessing_steps JSONB DEFAULT '[]',
    motion_params JSONB DEFAULT '{}',
    fd_mean DECIMAL(5,3),
    fd_max DECIMAL(5,3),
    correlation_matrix JSONB DEFAULT '{}',
    network_measures JSONB DEFAULT '{}',
    activation_maps JSONB DEFAULT '{}',
    ica_components JSONB DEFAULT '[]'
);

-- ---------------------------------------------------------------------------
-- fusion_results
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fusion_results (
    result_id UUID PRIMARY KEY REFERENCES analysis_results(id) ON DELETE CASCADE,
    fusion_method VARCHAR(50) NOT NULL,
    modalities_used JSONB DEFAULT '[]',
    modality_weights JSONB DEFAULT '{}',
    attention_weights JSONB DEFAULT '{}',
    individual_predictions JSONB DEFAULT '{}',
    fusion_strategy_details JSONB DEFAULT '{}'
);

-- ---------------------------------------------------------------------------
-- explanations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS explanations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    result_id UUID NOT NULL REFERENCES analysis_results(id) ON DELETE CASCADE,
    explanation_type VARCHAR(30) NOT NULL CHECK (explanation_type IN ('shap', 'gradcam', 'attention', 'feature_importance', 'counterfactual')),
    modality VARCHAR(20) NOT NULL CHECK (modality IN ('eeg', 'smri', 'fmri', 'fusion', 'clinical')),
    data JSONB NOT NULL,
    visualization_data JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_explanations_result_id ON explanations(result_id);
CREATE INDEX IF NOT EXISTS idx_explanations_type ON explanations(explanation_type);

-- ---------------------------------------------------------------------------
-- reports
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    report_type VARCHAR(30) NOT NULL CHECK (report_type IN ('analysis_summary', 'comprehensive', 'follow_up', 'custom')),
    title VARCHAR(255) NOT NULL,
    status VARCHAR(30) DEFAULT 'generating' CHECK (status IN ('generating', 'completed', 'failed')),
    file_path VARCHAR(500),
    file_size_bytes BIGINT,
    template_version VARCHAR(20),
    included_results JSONB DEFAULT '[]',
    generated_by UUID REFERENCES users(id),
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    downloaded_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_reports_patient_id ON reports(patient_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);

-- ---------------------------------------------------------------------------
-- audit_logs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id UUID,
    details JSONB DEFAULT '{}',
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
