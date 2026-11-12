import { query as defaultQuery, sanitizeDatabaseError } from '../db';
import { ApiError } from '../errors';
import type { AuthPrincipal } from '../types';

export interface PatientRecord {
  id: string;
  subjectId: string;
  diagnosis: string | null;
  age: number | null;
  sex: string | null;
  handedness: string | null;
  eegAvailable: boolean;
  smriAvailable: boolean;
  fmriAvailable: boolean;
  clinicalAvailable: boolean;
  panssAvailable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePatientInput {
  subjectId: string;
  diagnosis?: string;
  age?: number;
  sex?: string;
  handedness?: string;
}

export type PatientCreator = Pick<AuthPrincipal, 'userId'>;

export interface ListPatientsQuery {
  page: number;
  limit: number;
  diagnosis?: string;
  search?: string;
}

export interface PatientPage {
  data: PatientRecord[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface PatientStore {
  create(input: CreatePatientInput, creator: PatientCreator): Promise<PatientRecord>;
  findById(id: string): Promise<PatientRecord | null>;
  list(query: ListPatientsQuery): Promise<PatientPage>;
}

export type PatientQueryFn = <T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
) => Promise<T[]>;

interface PatientRow {
  id: string;
  subject_id: string;
  diagnosis: string | null;
  age: number | null;
  sex: string | null;
  handedness: string | null;
  eeg_available: boolean;
  smri_available: boolean;
  fmri_available: boolean;
  clinical_available: boolean;
  panss_available: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

const SUBJECT_ID_UNIQUE_CONSTRAINT = 'patients_subject_id_key';

const PATIENT_COLUMNS = [
  'id',
  'subject_id',
  'diagnosis',
  'age',
  'sex',
  'handedness',
  'eeg_available',
  'smri_available',
  'fmri_available',
  'clinical_available',
  'panss_available',
  'created_at',
  'updated_at',
].join(', ');

function mapPatient(row: PatientRow): PatientRecord {
  return {
    id: row.id,
    subjectId: row.subject_id,
    diagnosis: row.diagnosis,
    age: row.age,
    sex: row.sex,
    handedness: row.handedness,
    eegAvailable: row.eeg_available,
    smriAvailable: row.smri_available,
    fmriAvailable: row.fmri_available,
    clinicalAvailable: row.clinical_available,
    panssAvailable: row.panss_available,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function isSubjectIdUniqueViolation(err: unknown): boolean {
  const candidate = err as { code?: unknown; constraint?: unknown } | null;
  return (
    candidate?.code === '23505' && candidate?.constraint === SUBJECT_ID_UNIQUE_CONSTRAINT
  );
}

function storeFailure(err: unknown): Error {
  return new Error(`Patient store operation failed: ${sanitizeDatabaseError(err)}`);
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function buildFilters(query: ListPatientsQuery): { text: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (query.diagnosis !== undefined) {
    params.push(query.diagnosis);
    conditions.push(`diagnosis = $${params.length}`);
  }
  if (query.search !== undefined && query.search !== '') {
    params.push(`%${escapeLikePattern(query.search)}%`);
    conditions.push(`subject_id ILIKE $${params.length} ESCAPE '\\'`);
  }
  return {
    text: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

async function create(
  input: CreatePatientInput,
  creator: PatientCreator,
  queryFn: PatientQueryFn
): Promise<PatientRecord> {
  let rows: PatientRow[];
  try {
    rows = await queryFn<PatientRow>(
      `INSERT INTO patients (subject_id, diagnosis, age, sex, handedness, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${PATIENT_COLUMNS}`,
      [
        input.subjectId,
        input.diagnosis ?? null,
        input.age ?? null,
        input.sex ?? null,
        input.handedness ?? null,
        creator.userId,
      ]
    );
  } catch (err) {
    if (isSubjectIdUniqueViolation(err)) {
      throw ApiError.conflict('A patient with this subjectId already exists.');
    }
    throw storeFailure(err);
  }
  const row = rows[0];
  if (!row) {
    throw new Error('Patient insert returned no row');
  }
  return mapPatient(row);
}

async function findById(id: string, queryFn: PatientQueryFn): Promise<PatientRecord | null> {
  let rows: PatientRow[];
  try {
    rows = await queryFn<PatientRow>(
      `SELECT ${PATIENT_COLUMNS} FROM patients WHERE id = $1`,
      [id]
    );
  } catch (err) {
    throw storeFailure(err);
  }
  const row = rows[0];
  return row ? mapPatient(row) : null;
}

async function list(query: ListPatientsQuery, queryFn: PatientQueryFn): Promise<PatientPage> {
  const filters = buildFilters(query);
  let total = 0;
  let rows: PatientRow[] = [];
  try {
    const countRows = await queryFn<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM patients ${filters.text}`,
      filters.params
    );
    total = countRows[0]?.total ?? 0;
    if (total > 0) {
      const offset = (query.page - 1) * query.limit;
      rows = await queryFn<PatientRow>(
        `SELECT ${PATIENT_COLUMNS} FROM patients ${filters.text}
         ORDER BY created_at DESC, id DESC
         LIMIT $${filters.params.length + 1} OFFSET $${filters.params.length + 2}`,
        [...filters.params, query.limit, offset]
      );
    }
  } catch (err) {
    throw storeFailure(err);
  }
  return {
    data: rows.map(mapPatient),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

export function createSqlPatientStore(
  options: { queryFn?: PatientQueryFn } = {}
): PatientStore {
  const queryFn = options.queryFn ?? defaultQuery;
  return {
    create: (input, creator) => create(input, creator, queryFn),
    findById: (id) => findById(id, queryFn),
    list: (query) => list(query, queryFn),
  };
}
