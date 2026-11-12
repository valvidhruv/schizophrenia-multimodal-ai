import request from 'supertest';
import { createApp } from './app';
import { loadConfig } from './config';
import { signAccessToken } from './services/tokenService';
import { acceptSignedPrincipals } from './testing/principal';

const TEST_SECRET = 'unit-test-secret-value-123456';
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const PATIENT_ID = '44444444-4444-4444-8444-444444444444';

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

describe('access log sanitization', () => {
  let writeSpy: jest.SpyInstance;

  beforeEach(() => {
    writeSpy = jest.spyOn(process.stdout, 'write');
    writeSpy.mockImplementation(() => true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  test('omits query strings and record identifiers from access log lines', async () => {
    const app = createApp({
      config: loadConfig({
        NODE_ENV: 'test',
        JWT_SECRET: TEST_SECRET,
        BACKEND_RATE_LIMIT_WINDOW_MS: '60000',
        BACKEND_RATE_LIMIT_MAX: '1000',
      }),
      auditRecorder: () => undefined,
      validatePrincipal: acceptSignedPrincipals,
    });
    const token = signAccessToken({ userId: ADMIN_ID, role: 'admin' }, TEST_SECRET, 900);

    const res = await request(app)
      .get(`/api/patients/${PATIENT_ID}?search=SECRET_SUBJECT_TERM`)
      .set('Authorization', `Bearer ${token}`);
    await flush();

    expect(res.status).toBe(501);
    const logged = writeSpy.mock.calls
      .map((args: unknown[]) => String(args[0]))
      .join('');
    expect(logged).toContain('GET /api/patients/:id 501');
    expect(logged).not.toContain('SECRET_SUBJECT_TERM');
    expect(logged).not.toContain('search=');
    expect(logged).not.toContain(PATIENT_ID);
  });
});
