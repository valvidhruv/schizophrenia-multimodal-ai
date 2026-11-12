import request from 'supertest';
import { createApp } from '../app';
import { loadConfig } from '../config';
import { signAccessToken } from '../services/tokenService';
import { acceptSignedPrincipals } from '../testing/principal';

const TEST_SECRET = 'unit-test-secret-value-123456';
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const CLINICIAN_ID = '22222222-2222-4222-8222-222222222222';
const RESEARCHER_ID = '33333333-3333-4333-8333-333333333333';
const PATIENT_ID = '44444444-4444-4444-8444-444444444444';
const FILE_ID = '55555555-5555-4555-8555-555555555555';
const JOB_ID = '66666666-6666-4666-8666-666666666666';
const REPORT_ID = '77777777-7777-4777-8777-777777777777';

const baseEnv = {
  NODE_ENV: 'test',
  JWT_SECRET: TEST_SECRET,
  BACKEND_RATE_LIMIT_WINDOW_MS: '60000',
  BACKEND_RATE_LIMIT_MAX: '1000',
};

const app = createApp({
  config: loadConfig(baseEnv),
  auditRecorder: () => undefined,
  validatePrincipal: acceptSignedPrincipals,
});

function authHeader(role: 'admin' | 'clinician' | 'researcher', userId: string): string {
  return `Bearer ${signAccessToken({ userId, role }, TEST_SECRET, 900)}`;
}

const admin = authHeader('admin', ADMIN_ID);
const clinician = authHeader('clinician', CLINICIAN_ID);
const researcher = authHeader('researcher', RESEARCHER_ID);

const validJobBody = { patientId: PATIENT_ID, jobType: 'eeg' };
const validReportBody = { patientId: PATIENT_ID, reportType: 'analysis_summary' };

type HttpMethod = 'POST' | 'PUT' | 'DELETE';

function call(method: HttpMethod, path: string) {
  const req = request(app);
  if (method === 'POST') {
    return req.post(path);
  }
  if (method === 'PUT') {
    return req.put(path);
  }
  return req.delete(path);
}

const writeRoutes: Array<{ method: HttpMethod; path: string }> = [
  { method: 'POST', path: '/api/patients' },
  { method: 'PUT', path: `/api/patients/${PATIENT_ID}` },
  { method: 'DELETE', path: `/api/patients/${PATIENT_ID}` },
  { method: 'POST', path: `/api/patients/${PATIENT_ID}/panss` },
  { method: 'POST', path: `/api/patients/${PATIENT_ID}/upload/eeg` },
  { method: 'POST', path: `/api/patients/${PATIENT_ID}/files/${FILE_ID}/validate` },
  { method: 'POST', path: '/api/analysis/jobs' },
  { method: 'POST', path: `/api/analysis/jobs/${JOB_ID}/cancel` },
  { method: 'POST', path: '/api/reports' },
];

const gatedWriteRoutes = [
  { method: 'POST' as const, path: `/api/patients/${PATIENT_ID}/upload/eeg` },
  { method: 'POST' as const, path: `/api/patients/${PATIENT_ID}/files/${FILE_ID}/validate` },
  { method: 'POST' as const, path: '/api/analysis/jobs' },
  { method: 'POST' as const, path: `/api/analysis/jobs/${JOB_ID}/cancel` },
];

const readRoutes = [
  '/api/patients',
  `/api/patients/${PATIENT_ID}`,
  `/api/patients/${PATIENT_ID}/files`,
  '/api/analysis/jobs',
  `/api/analysis/jobs/${JOB_ID}`,
  `/api/reports/${REPORT_ID}`,
];

describe('role authorization on write routes', () => {
  test('rejects every write route without a token', async () => {
    for (const route of writeRoutes) {
      const res = await call(route.method, route.path);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    }
  });

  test('rejects researcher on every write route', async () => {
    for (const route of writeRoutes) {
      const res = await call(route.method, route.path).set('Authorization', researcher);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  test('rejects researcher before body validation runs', async () => {
    const res = await request(app)
      .post('/api/analysis/jobs')
      .set('Authorization', researcher)
      .send({ patientId: PATIENT_ID, jobType: 'meg' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  test('allows clinician and admin on the gated write routes', async () => {
    for (const auth of [clinician, admin]) {
      for (const route of gatedWriteRoutes) {
        const res = await call(route.method, route.path)
          .set('Authorization', auth)
          .send(validJobBody);
        expect(res.status).toBe(501);
        expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
      }
    }
  });

  test('allows clinician and admin on report generation', async () => {
    for (const auth of [clinician, admin]) {
      const res = await request(app)
        .post('/api/reports')
        .set('Authorization', auth)
        .send(validReportBody);
      expect(res.status).toBe(501);
      expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
    }
  });
});

describe('patient update authorization', () => {
  test('rejects researcher on PUT with a valid body', async () => {
    const res = await request(app)
      .put(`/api/patients/${PATIENT_ID}`)
      .set('Authorization', researcher)
      .send({ age: 30 });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  test('returns 400 for an empty body from an allowed role', async () => {
    const res = await request(app)
      .put(`/api/patients/${PATIENT_ID}`)
      .set('Authorization', clinician)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([
      expect.objectContaining({ field: '(root)' }),
    ]);
  });

  test('allows clinician on PUT with a valid body', async () => {
    const res = await request(app)
      .put(`/api/patients/${PATIENT_ID}`)
      .set('Authorization', clinician)
      .send({ age: 30 });

    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
  });
});

describe('role authorization on read routes', () => {
  test('allows researcher on read routes', async () => {
    for (const path of readRoutes) {
      const res = await request(app).get(path).set('Authorization', researcher);
      expect(res.status).toBe(501);
      expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
    }
  });

  test('still requires a token on read routes', async () => {
    for (const path of readRoutes) {
      const res = await request(app).get(path);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    }
  });
});
