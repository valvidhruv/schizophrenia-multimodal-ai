import request from 'supertest';
import { createApp } from './app';
import { loadConfig } from './config';
import type { AuditRecord } from './types';

const baseEnv = {
  NODE_ENV: 'test',
  JWT_SECRET: 'unit-test-secret-value-123456',
  BACKEND_RATE_LIMIT_WINDOW_MS: '60000',
  BACKEND_RATE_LIMIT_MAX: '1000',
};

interface TestApp {
  app: ReturnType<typeof createApp>;
  records: AuditRecord[];
}

function makeApp(env: Record<string, string> = {}): TestApp {
  const records: AuditRecord[] = [];
  const app = createApp({
    config: loadConfig({ ...baseEnv, ...env }),
    auditRecorder: (record) => {
      records.push(record);
    },
  });
  return { app, records };
}

describe('trust proxy configuration', () => {
  test('is disabled by default', () => {
    const { app } = makeApp();

    expect(app.get('trust proxy')).toBe(false);
  });

  test('applies a configured hop count', () => {
    const { app } = makeApp({ TRUST_PROXY: '1' });

    expect(app.get('trust proxy')).toBe(1);
  });

  test('applies a configured proxy address list', () => {
    const { app } = makeApp({ TRUST_PROXY: '10.0.0.1, 10.0.0.2' });

    expect(app.get('trust proxy')).toEqual(['10.0.0.1', '10.0.0.2']);
  });
});

describe('client IP with trust proxy disabled', () => {
  test('ignores X-Forwarded-For in audit records', async () => {
    const { app, records } = makeApp();

    await request(app).get('/api/patients').set('X-Forwarded-For', '1.2.3.4');

    expect(records).toHaveLength(1);
    expect(records[0].ip).toBeDefined();
    expect(records[0].ip).not.toBe('1.2.3.4');
  });

  test('keeps one rate limit bucket regardless of X-Forwarded-For', async () => {
    const { app } = makeApp({ BACKEND_RATE_LIMIT_MAX: '2' });

    const first = await request(app)
      .get('/api/patients')
      .set('X-Forwarded-For', '1.1.1.1');
    const second = await request(app)
      .get('/api/patients')
      .set('X-Forwarded-For', '2.2.2.2');
    const third = await request(app)
      .get('/api/patients')
      .set('X-Forwarded-For', '3.3.3.3');

    expect(first.status).toBe(401);
    expect(first.headers['x-ratelimit-remaining']).toBe('1');
    expect(second.status).toBe(401);
    expect(second.headers['x-ratelimit-remaining']).toBe('0');
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('client IP with trust proxy hop count 1', () => {
  test('records the rightmost X-Forwarded-For entry as the client IP', async () => {
    const { app, records } = makeApp({ TRUST_PROXY: '1' });

    await request(app)
      .get('/api/patients')
      .set('X-Forwarded-For', '9.9.9.9, 1.2.3.4');

    expect(records).toHaveLength(1);
    expect(records[0].ip).toBe('1.2.3.4');
  });

  test('falls back to the socket address without a forwarded header', async () => {
    const { app, records } = makeApp({ TRUST_PROXY: '1' });

    await request(app).get('/api/patients');

    expect(records).toHaveLength(1);
    expect(records[0].ip).toBeDefined();
    expect(records[0].ip).not.toBe('1.2.3.4');
  });

  test('separates rate limit buckets per forwarded client IP', async () => {
    const { app } = makeApp({ TRUST_PROXY: '1', BACKEND_RATE_LIMIT_MAX: '2' });

    const first = await request(app)
      .get('/api/patients')
      .set('X-Forwarded-For', '1.1.1.1');
    const second = await request(app)
      .get('/api/patients')
      .set('X-Forwarded-For', '1.1.1.1');
    const third = await request(app)
      .get('/api/patients')
      .set('X-Forwarded-For', '2.2.2.2');
    const fourth = await request(app)
      .get('/api/patients')
      .set('X-Forwarded-For', '1.1.1.1');

    expect(first.status).toBe(401);
    expect(first.headers['x-ratelimit-remaining']).toBe('1');
    expect(second.status).toBe(401);
    expect(second.headers['x-ratelimit-remaining']).toBe('0');
    expect(third.status).toBe(401);
    expect(third.headers['x-ratelimit-remaining']).toBe('1');
    expect(fourth.status).toBe(429);
  });
});

describe('client IP with an explicit proxy address list', () => {
  test('ignores X-Forwarded-For from an unlisted socket address', async () => {
    const { app, records } = makeApp({ TRUST_PROXY: '10.0.0.1' });

    await request(app).get('/api/patients').set('X-Forwarded-For', '1.2.3.4');

    expect(records).toHaveLength(1);
    expect(records[0].ip).toBeDefined();
    expect(records[0].ip).not.toBe('1.2.3.4');
  });
});
