import request from 'supertest';
import { createApp } from '../app';
import { loadConfig } from '../config';
import { signAccessToken } from '../services/tokenService';
import type { AuditRecord, Role } from '../types';

const TEST_SECRET = 'unit-test-secret-value-123456';
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const CLINICIAN_ID = '22222222-2222-4222-8222-222222222222';
const RESEARCHER_ID = '33333333-3333-4333-8333-333333333333';
const PATIENT_ID = '44444444-4444-4444-8444-444444444444';

const DISCLAIMER =
  'Research prototype - not for clinical diagnosis. Clinician review required.';

const baseEnv = {
  NODE_ENV: 'test',
  JWT_SECRET: TEST_SECRET,
  BACKEND_CORS_ORIGIN: 'http://localhost:5173',
  BACKEND_RATE_LIMIT_WINDOW_MS: '60000',
  BACKEND_RATE_LIMIT_MAX: '1000',
};

const records: AuditRecord[] = [];

const app = createApp({
  config: loadConfig(baseEnv),
  auditRecorder: (record) => {
    records.push(record);
  },
});

function token(userId: string, role: Role): string {
  return signAccessToken({ userId, role }, TEST_SECRET, 900);
}

const adminAuth = `Bearer ${token(ADMIN_ID, 'admin')}`;
const clinicianAuth = `Bearer ${token(CLINICIAN_ID, 'clinician')}`;
const researcherAuth = `Bearer ${token(RESEARCHER_ID, 'researcher')}`;

describe('Phase 1 API scaffold', () => {
  test('returns 401 without a token', async () => {
    const res = await request(app).get('/api/patients');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(res.body.disclaimer).toBe(DISCLAIMER);
    expect(res.body.timestamp).toBeDefined();
  });

  test('returns 501 NOT_IMPLEMENTED for an authorized request', async () => {
    const res = await request(app).get('/api/patients').set('Authorization', adminAuth);

    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
  });

  test('returns 403 for a role that is not allowed', async () => {
    const res = await request(app)
      .post('/api/patients')
      .set('Authorization', researcherAuth)
      .send({ subjectId: 'SCHZ_099' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  test('returns 400 with field details for an out-of-range age', async () => {
    const res = await request(app)
      .post('/api/patients')
      .set('Authorization', adminAuth)
      .send({ subjectId: 'SCHZ_001', age: 200 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([
      expect.objectContaining({ field: 'age' }),
    ]);
  });

  test('returns 400 for a missing subjectId', async () => {
    const res = await request(app)
      .post('/api/patients')
      .set('Authorization', adminAuth)
      .send({ age: 34 });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      expect.objectContaining({ field: 'subjectId' }),
    ]);
  });

  test('returns 501 for a valid create request', async () => {
    const res = await request(app)
      .post('/api/patients')
      .set('Authorization', adminAuth)
      .send({ subjectId: 'SCHZ_001', age: 34, sex: 'male' });

    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
  });

  test('enforces role gates on delete', async () => {
    const denied = await request(app)
      .delete(`/api/patients/${PATIENT_ID}`)
      .set('Authorization', clinicianAuth);
    expect(denied.status).toBe(403);

    const allowed = await request(app)
      .delete(`/api/patients/${PATIENT_ID}`)
      .set('Authorization', adminAuth);
    expect(allowed.status).toBe(501);
  });

  test('rejects an invalid path param with params. prefix', async () => {
    const res = await request(app)
      .get('/api/patients/not-a-uuid')
      .set('Authorization', adminAuth);

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      expect.objectContaining({ field: 'params.id' }),
    ]);
  });

  test('rejects an expired token', async () => {
    const expired = signAccessToken({ userId: ADMIN_ID, role: 'admin' }, TEST_SECRET, -60);
    const res = await request(app)
      .get('/api/patients')
      .set('Authorization', `Bearer ${expired}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  test('rejects malformed JSON with a 400', async () => {
    const res = await request(app)
      .post('/api/patients')
      .set('Authorization', adminAuth)
      .set('Content-Type', 'application/json')
      .send('{"subjectId":');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toContain('JSON');
  });

  test('returns 404 for an unknown authenticated endpoint', async () => {
    const res = await request(app)
      .get('/api/nope')
      .set('Authorization', adminAuth);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  test('rejects an out-of-range PANSS item', async () => {
    const body = {
      assessmentDate: '2026-01-15',
      p1: 4,
      p2: 4,
      p3: 9,
      p4: 4,
      p5: 4,
      p6: 4,
      p7: 4,
      n1: 3,
      n2: 3,
      n3: 3,
      n4: 3,
      n5: 3,
      n6: 3,
      n7: 3,
      g1: 2,
      g2: 2,
      g3: 2,
      g4: 2,
      g5: 2,
      g6: 2,
      g7: 2,
      g8: 2,
      g9: 2,
      g10: 2,
      g11: 2,
      g12: 2,
      g13: 2,
      g14: 2,
      g15: 2,
      g16: 2,
    };
    const res = await request(app)
      .post(`/api/patients/${PATIENT_ID}/panss`)
      .set('Authorization', clinicianAuth)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      expect.objectContaining({ field: 'p3' }),
    ]);
  });

  test('returns 501 for a valid PANSS submission', async () => {
    const body = {
      assessmentDate: '2026-01-15',
      p1: 4,
      p2: 4,
      p3: 4,
      p4: 4,
      p5: 4,
      p6: 4,
      p7: 4,
      n1: 3,
      n2: 3,
      n3: 3,
      n4: 3,
      n5: 3,
      n6: 3,
      n7: 3,
      g1: 2,
      g2: 2,
      g3: 2,
      g4: 2,
      g5: 2,
      g6: 2,
      g7: 2,
      g8: 2,
      g9: 2,
      g10: 2,
      g11: 2,
      g12: 2,
      g13: 2,
      g14: 2,
      g15: 2,
      g16: 2,
    };
    const res = await request(app)
      .post(`/api/patients/${PATIENT_ID}/panss`)
      .set('Authorization', clinicianAuth)
      .send(body);

    expect(res.status).toBe(501);
  });

  test('validates analysis job creation', async () => {
    const invalid = await request(app)
      .post('/api/analysis/jobs')
      .set('Authorization', clinicianAuth)
      .send({ patientId: PATIENT_ID, jobType: 'meg' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.details).toEqual([
      expect.objectContaining({ field: 'jobType' }),
    ]);

    const valid = await request(app)
      .post('/api/analysis/jobs')
      .set('Authorization', clinicianAuth)
      .send({ patientId: PATIENT_ID, jobType: 'eeg' });
    expect(valid.status).toBe(501);
  });

  test('validates upload modality', async () => {
    const invalid = await request(app)
      .post(`/api/patients/${PATIENT_ID}/upload/meg`)
      .set('Authorization', adminAuth);
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.details).toEqual([
      expect.objectContaining({ field: 'params.modality' }),
    ]);

    const valid = await request(app)
      .post(`/api/patients/${PATIENT_ID}/upload/eeg`)
      .set('Authorization', adminAuth);
    expect(valid.status).toBe(501);
  });

  test('enforces the configured rate limit', async () => {
    const limitedApp = createApp({
      config: loadConfig({ ...baseEnv, BACKEND_RATE_LIMIT_MAX: '2' }),
      auditRecorder: () => undefined,
    });
    const auth = `Bearer ${token(ADMIN_ID, 'admin')}`;

    const first = await request(limitedApp).get('/api/patients').set('Authorization', auth);
    const second = await request(limitedApp).get('/api/patients').set('Authorization', auth);
    const third = await request(limitedApp).get('/api/patients').set('Authorization', auth);

    expect(first.status).toBe(501);
    expect(second.status).toBe(501);
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('RATE_LIMITED');
    expect(third.headers['x-ratelimit-limit']).toBe('2');
    expect(third.headers['retry-after']).toBeDefined();
  });

  test('records audit entries without query strings', async () => {
    records.length = 0;
    await request(app)
      .get('/api/patients?search=HIDDEN_TERM')
      .set('Authorization', adminAuth);

    const audit = records.find((r) => r.path === '/api/patients');
    expect(audit).toBeDefined();
    const record = audit as AuditRecord;
    expect(record.action).toBe('GET');
    expect(record.statusCode).toBe(501);
    expect(record.actorUserId).toBe(ADMIN_ID);
    expect(record.actorRole).toBe('admin');
    expect(record.path).not.toContain('HIDDEN_TERM');
    expect(record.ip).toBeDefined();
  });

  test('records audit entries for unauthenticated requests', async () => {
    records.length = 0;
    await request(app).get('/api/patients');

    expect(records).toHaveLength(1);
    expect(records[0].statusCode).toBe(401);
    expect(records[0].actorUserId).toBeUndefined();
  });

  test('returns 501 AUTH_NOT_CONFIGURED when no secret is set', async () => {
    const noAuthApp = createApp({
      config: loadConfig({ NODE_ENV: 'test' }),
      auditRecorder: () => undefined,
    });

    const res = await request(noAuthApp).get('/api/patients');

    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('AUTH_NOT_CONFIGURED');
  });

  test('restricts CORS to the configured origin', async () => {
    const allowed = await request(app)
      .get('/api/health')
      .set('Origin', 'http://localhost:5173');
    expect(allowed.headers['access-control-allow-origin']).toBe(
      'http://localhost:5173'
    );

    const blocked = await request(app)
      .get('/api/health')
      .set('Origin', 'http://evil.example');
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('keeps health endpoints working', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.disclaimer).toBe(DISCLAIMER);
  });
});
