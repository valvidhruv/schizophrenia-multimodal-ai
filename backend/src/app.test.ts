jest.mock('./db', () => ({
  checkDatabase: jest.fn(),
}));

import request from 'supertest';
import { createApp } from './app';
import { checkDatabase } from './db';

const app = createApp();
const mockCheckDatabase = checkDatabase as jest.MockedFunction<typeof checkDatabase>;

const DISCLAIMER =
  'Research prototype - not for clinical diagnosis. Clinician review required.';

afterEach(() => {
  jest.clearAllMocks();
});

describe('existing process health endpoints (unchanged)', () => {
  test('GET /health returns 200 with process status only', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeDefined();
    expect(res.body.checks).toBeUndefined();
    expect(res.body.disclaimer).toBe(DISCLAIMER);
  });

  test('GET /api/health returns 200 with service status only', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('backend');
    expect(res.body.checks).toBeUndefined();
    expect(res.body.disclaimer).toBe(DISCLAIMER);
  });
});

describe('database health endpoint', () => {
  test('GET /health/db returns 200 when SELECT 1 succeeds', async () => {
    mockCheckDatabase.mockResolvedValue({ ok: true, latencyMs: 12 });

    const res = await request(app).get('/health/db');

    expect(mockCheckDatabase).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks.database).toEqual({ status: 'ok', latencyMs: 12 });
    expect(res.body.disclaimer).toBe(DISCLAIMER);
  });

  test('GET /api/health/db alias returns 200 when SELECT 1 succeeds', async () => {
    mockCheckDatabase.mockResolvedValue({ ok: true, latencyMs: 3 });

    const res = await request(app).get('/api/health/db');

    expect(res.status).toBe(200);
    expect(res.body.checks.database.status).toBe('ok');
  });

  test('GET /health/db returns 503 with fixed reason on connection failure', async () => {
    mockCheckDatabase.mockResolvedValue({ ok: false, reason: 'connection_failed' });

    const res = await request(app).get('/health/db');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('unavailable');
    expect(res.body.checks.database).toEqual({ status: 'unavailable', reason: 'connection_failed' });
    expect(res.body.disclaimer).toBe(DISCLAIMER);

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toMatch(/postgres:\/\//i);
    expect(serialized).not.toMatch(/password/i);
    expect(serialized).not.toMatch(/localhost/i);
    expect(serialized).not.toMatch(/dev@/i);
  });

  test('GET /health/db returns 503 reason not_configured when DATABASE_URL is absent', async () => {
    mockCheckDatabase.mockResolvedValue({ ok: false, reason: 'not_configured' });

    const res = await request(app).get('/health/db');

    expect(res.status).toBe(503);
    expect(res.body.checks.database.reason).toBe('not_configured');
  });

  test('GET /health/db stays safe when checkDatabase unexpectedly throws', async () => {
    mockCheckDatabase.mockRejectedValue(new Error('postgresql://user:pass@host/db blew up'));

    const res = await request(app).get('/health/db');

    expect(res.status).toBe(503);
    expect(res.body.checks.database.status).toBe('unavailable');
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('pass');
    expect(serialized).not.toContain('postgresql://');
  });
});
