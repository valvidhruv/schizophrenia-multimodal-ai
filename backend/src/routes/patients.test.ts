import request from 'supertest';
import { createApp } from '../app';
import { loadConfig } from '../config';
import { DISCLAIMER } from '../constants';
import { ApiError } from '../errors';
import { signAccessToken } from '../services/tokenService';
import type { AuditRecord, Role } from '../types';
import type { PatientRecord, PatientStore } from '../services/patientService';

const TEST_SECRET = 'unit-test-secret-value-123456';
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const CLINICIAN_ID = '22222222-2222-4222-8222-222222222222';
const RESEARCHER_ID = '33333333-3333-4333-8333-333333333333';
const PATIENT_ID = '44444444-4444-4444-8444-444444444444';
const MISSING_ID = '55555555-5555-4555-8555-555555555555';
const MAX_SAFE_PAGE = Math.floor(Number.MAX_SAFE_INTEGER / 20) + 1;

const baseEnv = {
  NODE_ENV: 'test',
  JWT_SECRET: TEST_SECRET,
  BACKEND_RATE_LIMIT_WINDOW_MS: '60000',
  BACKEND_RATE_LIMIT_MAX: '1000',
};

const patient: PatientRecord = {
  id: PATIENT_ID,
  subjectId: 'SCHZ_001',
  diagnosis: 'schizophrenia',
  age: 35,
  sex: 'male',
  handedness: 'right',
  eegAvailable: true,
  smriAvailable: false,
  fmriAvailable: true,
  clinicalAvailable: true,
  panssAvailable: true,
  createdAt: '2026-10-18T01:02:03.000Z',
  updatedAt: '2026-10-18T04:05:06.000Z',
};

const emptyPage = {
  data: [],
  pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
};

const populatedPage = {
  data: [patient],
  pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
};

function fakeStore(overrides: Partial<PatientStore> = {}): PatientStore {
  return {
    create: jest.fn().mockResolvedValue(patient),
    findById: jest.fn().mockResolvedValue(patient),
    list: jest.fn().mockResolvedValue(emptyPage),
    ...overrides,
  };
}

function appWith(store?: PatientStore, records?: AuditRecord[]) {
  return createApp({
    config: loadConfig(baseEnv),
    auditRecorder: (record) => {
      records?.push(record);
    },
    patientStore: store,
  });
}

function token(userId: string, role: Role): string {
  return `Bearer ${signAccessToken({ userId, role }, TEST_SECRET, 900)}`;
}

const admin = token(ADMIN_ID, 'admin');
const clinician = token(CLINICIAN_ID, 'clinician');
const researcher = token(RESEARCHER_ID, 'researcher');

afterEach(() => {
  jest.restoreAllMocks();
});

describe('POST /api/patients with a store', () => {
  test('returns 201 with the record and disclaimer', async () => {
    const store = fakeStore();
    const app = appWith(store);

    const res = await request(app)
      .post('/api/patients')
      .set('Authorization', clinician)
      .send({
        subjectId: 'SCHZ_001',
        diagnosis: 'schizophrenia',
        age: 35,
        sex: 'male',
        handedness: 'right',
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ...patient, disclaimer: DISCLAIMER });
    expect(store.create).toHaveBeenCalledWith({
      subjectId: 'SCHZ_001',
      diagnosis: 'schizophrenia',
      age: 35,
      sex: 'male',
      handedness: 'right',
    });
  });

  test('rejects a researcher before the store is called', async () => {
    const store = fakeStore();
    const app = appWith(store);

    const res = await request(app)
      .post('/api/patients')
      .set('Authorization', researcher)
      .send({ subjectId: 'SCHZ_002' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(store.create).not.toHaveBeenCalled();
  });

  test('rejects an invalid body before the store is called', async () => {
    const store = fakeStore();
    const app = appWith(store);

    const res = await request(app)
      .post('/api/patients')
      .set('Authorization', admin)
      .send({ subjectId: 'SCHZ_001', age: 200 });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      expect.objectContaining({ field: 'age' }),
    ]);
    expect(store.create).not.toHaveBeenCalled();
  });

  test('maps a store conflict to 409 without echoing the subject id', async () => {
    const store = fakeStore({
      create: jest
        .fn()
        .mockRejectedValue(ApiError.conflict('A patient with this subjectId already exists.')),
    });
    const app = appWith(store);

    const res = await request(app)
      .post('/api/patients')
      .set('Authorization', admin)
      .send({ subjectId: 'SECRET_SUBJECT_777' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.message).toBe('A patient with this subjectId already exists.');
    expect(JSON.stringify(res.body)).not.toContain('SECRET_SUBJECT_777');
    expect(res.body.disclaimer).toBe(DISCLAIMER);
  });

  test('maps a store failure to a generic 500 with no leaked details', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = fakeStore({
      create: jest.fn().mockRejectedValue(new Error('insert failed for SECRET_SUBJECT_777')),
    });
    const app = appWith(store);

    const res = await request(app)
      .post('/api/patients')
      .set('Authorization', admin)
      .send({ subjectId: 'SECRET_SUBJECT_777' });

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(res.body.error.message).toBe('Internal server error');
    expect(JSON.stringify(res.body)).not.toContain('SECRET_SUBJECT_777');
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('GET /api/patients with a store', () => {
  test('returns the list envelope with disclaimer and default query values', async () => {
    const store = fakeStore({ list: jest.fn().mockResolvedValue(populatedPage) });
    const app = appWith(store);

    const res = await request(app).get('/api/patients').set('Authorization', researcher);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: [patient],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      disclaimer: DISCLAIMER,
    });
    expect(store.list).toHaveBeenCalledWith({ page: 1, limit: 20 });
  });

  test('passes coerced filters and pagination to the store', async () => {
    const store = fakeStore();
    const app = appWith(store);

    const res = await request(app)
      .get('/api/patients?page=3&limit=50&diagnosis=schizophrenia&search=SCHZ')
      .set('Authorization', admin);

    expect(res.status).toBe(200);
    expect(store.list).toHaveBeenCalledWith({
      page: 3,
      limit: 50,
      diagnosis: 'schizophrenia',
      search: 'SCHZ',
    });
  });

  test('rejects a limit above the maximum before the store is called', async () => {
    const store = fakeStore();
    const app = appWith(store);

    const res = await request(app)
      .get('/api/patients?limit=500')
      .set('Authorization', admin);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(store.list).not.toHaveBeenCalled();
  });

  test('rejects a non-numeric page before the store is called', async () => {
    const store = fakeStore();
    const app = appWith(store);

    const res = await request(app)
      .get('/api/patients?page=abc')
      .set('Authorization', admin);

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      expect.objectContaining({ field: 'query.page' }),
    ]);
    expect(store.list).not.toHaveBeenCalled();
  });

  test('accepts the largest page whose offset is a safe integer', async () => {
    const store = fakeStore();
    const app = appWith(store);

    const res = await request(app)
      .get(`/api/patients?page=${MAX_SAFE_PAGE}&limit=20`)
      .set('Authorization', admin);

    expect(res.status).toBe(200);
    expect(Number.isSafeInteger((MAX_SAFE_PAGE - 1) * 20)).toBe(true);
    expect(store.list).toHaveBeenCalledWith({ page: MAX_SAFE_PAGE, limit: 20 });
  });

  test('rejects the first page whose offset exceeds the safe integer range', async () => {
    const store = fakeStore();
    const app = appWith(store);

    const res = await request(app)
      .get(`/api/patients?page=${MAX_SAFE_PAGE + 1}&limit=20`)
      .set('Authorization', admin);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([
      expect.objectContaining({ field: 'query.page', message: 'page is too large' }),
    ]);
    expect(Number.isSafeInteger(MAX_SAFE_PAGE * 20)).toBe(false);
    expect(store.list).not.toHaveBeenCalled();
  });

  test('records an audit entry without the query string', async () => {
    const records: AuditRecord[] = [];
    const store = fakeStore();
    const app = appWith(store, records);

    await request(app)
      .get('/api/patients?search=TOPSECRET_TERM')
      .set('Authorization', admin);

    expect(records).toHaveLength(1);
    expect(records[0].statusCode).toBe(200);
    expect(records[0].path).toBe('/api/patients');
    expect(records[0].path).not.toContain('TOPSECRET_TERM');
    expect(records[0].actorUserId).toBe(ADMIN_ID);
  });

  test('maps a store failure to a generic 500', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = fakeStore({
      list: jest.fn().mockRejectedValue(new Error('count query failed for SECRET_SUBJECT_777')),
    });
    const app = appWith(store);

    const res = await request(app).get('/api/patients').set('Authorization', admin);

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('SECRET_SUBJECT_777');
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('GET /api/patients/:id with a store', () => {
  test('returns the record and disclaimer', async () => {
    const store = fakeStore();
    const app = appWith(store);

    const res = await request(app)
      .get(`/api/patients/${PATIENT_ID}`)
      .set('Authorization', researcher);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...patient, disclaimer: DISCLAIMER });
    expect(store.findById).toHaveBeenCalledWith(PATIENT_ID);
  });

  test('returns 404 when the store finds no patient', async () => {
    const store = fakeStore({ findById: jest.fn().mockResolvedValue(null) });
    const app = appWith(store);

    const res = await request(app)
      .get(`/api/patients/${MISSING_ID}`)
      .set('Authorization', admin);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toBe('Patient not found.');
    expect(res.body.disclaimer).toBe(DISCLAIMER);
  });

  test('rejects an invalid uuid before the store is called', async () => {
    const store = fakeStore();
    const app = appWith(store);

    const res = await request(app)
      .get('/api/patients/not-a-uuid')
      .set('Authorization', admin);

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      expect.objectContaining({ field: 'params.id' }),
    ]);
    expect(store.findById).not.toHaveBeenCalled();
  });
});

describe('unimplemented patient routes with a store configured', () => {
  test('update and delete still return 501', async () => {
    const store = fakeStore();
    const app = appWith(store);

    const put = await request(app)
      .put(`/api/patients/${PATIENT_ID}`)
      .set('Authorization', clinician)
      .send({ age: 36 });
    expect(put.status).toBe(501);
    expect(put.body.error.code).toBe('NOT_IMPLEMENTED');

    const del = await request(app)
      .delete(`/api/patients/${PATIENT_ID}`)
      .set('Authorization', admin);
    expect(del.status).toBe(501);
    expect(del.body.error.code).toBe('NOT_IMPLEMENTED');
  });
});
