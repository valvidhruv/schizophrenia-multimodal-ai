import request from 'supertest';
import { createApp } from './app';
import { DISCLAIMER } from './constants';
import { closeDatabase, initDatabase, query } from './db';
import { loadConfig } from './config';
import { signAccessToken } from './services/tokenService';
import { createSqlPatientStore } from './services/patientService';
import { disposableDatabaseUrl } from './testing/disposableDatabaseUrl';
import { acceptSignedPrincipals } from './testing/principal';

// Requires the existing schema to be applied to TEST_DATABASE_URL before this
// suite runs; it never applies migrations. On a fresh disposable database, run
// this suite serially (for example, `jest --runInBand`) or apply migrations in
// an explicit CI setup step to avoid racing migrate.integration.test.ts.
const TEST_SECRET = 'unit-test-secret-value-123456';
const CLINICIAN_ID = '22222222-2222-4222-8222-222222222222';
const MISSING_ID = '99999999-9999-4999-8999-999999999999';

const SUBJECT_CREATE = 'ph1d_it_create_001';
const SUBJECT_DUP = 'ph1d_it_dup_001';
const SUBJECT_LIST_PREFIX = 'ph1d_it_list_';
const SUBJECT_LIST_A = `${SUBJECT_LIST_PREFIX}a`;
const SUBJECT_LIST_B = `${SUBJECT_LIST_PREFIX}b`;
const SUBJECT_LIST_C = `${SUBJECT_LIST_PREFIX}c`;
const SUBJECT_PCT_LITERAL = 'ph1d_it_pct_A%B';
const SUBJECT_PCT_DECOY = 'ph1d_it_pct_AXB';
const SUBJECT_USCORE_LITERAL = 'ph1d_it_us_A_B';
const SUBJECT_USCORE_DECOY = 'ph1d_it_us_AXB';
const SUBJECT_BS_LITERAL = 'ph1d_it_bs_X\\Y';
const SUBJECT_BS_DECOY = 'ph1d_it_bs_XZY';

const TEST_SUBJECT_IDS = [
  SUBJECT_CREATE,
  SUBJECT_DUP,
  SUBJECT_LIST_A,
  SUBJECT_LIST_B,
  SUBJECT_LIST_C,
  SUBJECT_PCT_LITERAL,
  SUBJECT_PCT_DECOY,
  SUBJECT_USCORE_LITERAL,
  SUBJECT_USCORE_DECOY,
  SUBJECT_BS_LITERAL,
  SUBJECT_BS_DECOY,
];

const baseEnv = {
  NODE_ENV: 'test',
  JWT_SECRET: TEST_SECRET,
  BACKEND_RATE_LIMIT_WINDOW_MS: '60000',
  BACKEND_RATE_LIMIT_MAX: '1000',
};

const testUrl = disposableDatabaseUrl();
const describeLive = testUrl ? describe : describe.skip;

jest.setTimeout(15000);

describeLive('patient management integration (disposable test database)', () => {
  let app: ReturnType<typeof createApp>;
  let suiteReady = false;

  const clinician = `Bearer ${signAccessToken(
    { userId: CLINICIAN_ID, role: 'clinician' },
    TEST_SECRET,
    900
  )}`;

  async function removeSeeded(): Promise<void> {
    await query('DELETE FROM patients WHERE subject_id = ANY($1)', [TEST_SUBJECT_IDS]);
  }

  function createPatient(subjectId: string, extra: Record<string, unknown> = {}) {
    return request(app)
      .post('/api/patients')
      .set('Authorization', clinician)
      .send({ subjectId, ...extra });
  }

  function getPath(pathAndQuery: string) {
    return request(app).get(pathAndQuery).set('Authorization', clinician);
  }

  beforeAll(async () => {
    const { configured } = initDatabase({ DATABASE_URL: testUrl as string });
    if (!configured) {
      throw new Error('TEST_DATABASE_URL is set but the database pool was not configured');
    }
    const rows = await query<{ exists_patients: string | null }>(
      "SELECT to_regclass('public.patients') AS exists_patients"
    );
    if (rows[0]?.exists_patients == null) {
      throw new Error(
        'The patients table does not exist in the test database; apply backend/migrations before running this suite'
      );
    }
    await removeSeeded();
    app = createApp({
      config: loadConfig(baseEnv),
      auditRecorder: () => undefined,
      patientStore: createSqlPatientStore(),
      validatePrincipal: acceptSignedPrincipals,
    });
    suiteReady = true;
  });

  afterAll(async () => {
    try {
      if (suiteReady) {
        await removeSeeded();
      }
    } finally {
      await closeDatabase();
    }
  });

  test('creates a patient, reads it back, and never exposes created_by', async () => {
    const created = await createPatient(SUBJECT_CREATE, {
      diagnosis: 'schizophrenia',
      age: 35,
      sex: 'male',
      handedness: 'right',
    });

    expect(created.status).toBe(201);
    expect(created.body.subjectId).toBe(SUBJECT_CREATE);
    expect(created.body.diagnosis).toBe('schizophrenia');
    expect(created.body.age).toBe(35);
    expect(created.body.eegAvailable).toBe(false);
    expect(created.body.smriAvailable).toBe(false);
    expect(created.body.fmriAvailable).toBe(false);
    expect(created.body.clinicalAvailable).toBe(false);
    expect(created.body.panssAvailable).toBe(false);
    expect(created.body.disclaimer).toBe(DISCLAIMER);
    expect(created.body).not.toHaveProperty('createdBy');
    expect(created.body.createdAt).toEqual(expect.any(String));

    const fetched = await getPath(`/api/patients/${created.body.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body).toEqual(created.body);
  });

  test('rejects a duplicate subject id with 409 and no identifier echo', async () => {
    const first = await createPatient(SUBJECT_DUP);
    expect(first.status).toBe(201);

    const second = await createPatient(SUBJECT_DUP);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('CONFLICT');
    expect(second.body.error.message).toBe(
      'A patient with this subjectId already exists.'
    );
    expect(JSON.stringify(second.body)).not.toContain(SUBJECT_DUP);
  });

  test('returns 404 for an unknown patient id', async () => {
    const res = await getPath(`/api/patients/${MISSING_ID}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toBe('Patient not found.');
    expect(res.body.disclaimer).toBe(DISCLAIMER);
  });

  test('lists patients with pagination and diagnosis filtering', async () => {
    expect((await createPatient(SUBJECT_LIST_A, { diagnosis: 'schizophrenia' })).status).toBe(201);
    expect((await createPatient(SUBJECT_LIST_B, { diagnosis: 'healthy_control' })).status).toBe(201);
    expect((await createPatient(SUBJECT_LIST_C, { diagnosis: 'healthy_control' })).status).toBe(201);

    const page1 = await getPath(
      `/api/patients?search=${SUBJECT_LIST_PREFIX}&page=1&limit=2`
    );
    expect(page1.status).toBe(200);
    expect(page1.body.pagination).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.disclaimer).toBe(DISCLAIMER);

    const page2 = await getPath(
      `/api/patients?search=${SUBJECT_LIST_PREFIX}&page=2&limit=2`
    );
    expect(page2.status).toBe(200);
    expect(page2.body.pagination).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 });
    expect(page2.body.data).toHaveLength(1);

    const filtered = await getPath(
      `/api/patients?search=${SUBJECT_LIST_PREFIX}&diagnosis=healthy_control&limit=100`
    );
    expect(filtered.status).toBe(200);
    expect(filtered.body.pagination.total).toBe(2);
    const found = filtered.body.data.map((row: { subjectId: string }) => row.subjectId);
    expect([...found].sort()).toEqual([SUBJECT_LIST_B, SUBJECT_LIST_C].sort());
  });

  test('treats percent, underscore, and backslash in searches literally', async () => {
    const pairs = [
      { literal: SUBJECT_PCT_LITERAL, decoy: SUBJECT_PCT_DECOY, search: SUBJECT_PCT_LITERAL },
      {
        literal: SUBJECT_USCORE_LITERAL,
        decoy: SUBJECT_USCORE_DECOY,
        search: SUBJECT_USCORE_LITERAL,
      },
      { literal: SUBJECT_BS_LITERAL, decoy: SUBJECT_BS_DECOY, search: SUBJECT_BS_LITERAL },
    ];

    for (const pair of pairs) {
      expect((await createPatient(pair.literal)).status).toBe(201);
      expect((await createPatient(pair.decoy)).status).toBe(201);

      const res = await getPath(
        `/api/patients?search=${encodeURIComponent(pair.search)}&limit=100`
      );
      expect(res.status).toBe(200);
      const found = res.body.data.map((row: { subjectId: string }) => row.subjectId);
      expect(found).toEqual([pair.literal]);
    }
  });
});
