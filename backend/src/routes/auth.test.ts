import request from 'supertest';
import { createApp } from '../app';
import { loadConfig } from '../config';
import { DISCLAIMER } from '../constants';
import { signAccessToken } from '../services/tokenService';
import type { AuthStore, AuthUserRecord } from '../services/authStore';
import { AuthService } from '../services/authService';
import { hashPassword } from '../services/passwordService';

const SECRET = 'unit-test-secret-value-123456';
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const CLINICIAN_ID = '22222222-2222-4222-8222-222222222222';
const PASSWORD = 'correct horse battery staple';

const config = loadConfig({
  NODE_ENV: 'test',
  JWT_SECRET: SECRET,
  BACKEND_RATE_LIMIT_WINDOW_MS: '60000',
  BACKEND_RATE_LIMIT_MAX: '1000',
});

let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

function makeUser(
  id: string,
  role: AuthUserRecord['role'],
  overrides: Partial<AuthUserRecord> = {}
): AuthUserRecord {
  return {
    id,
    email: `${role}@example.test`,
    passwordHash,
    fullName: `Test ${role}`,
    role,
    isActive: true,
    lastLogin: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function fakeStore(overrides: Partial<AuthStore> = {}): AuthStore {
  return {
    findUserByEmail: jest.fn().mockResolvedValue(null),
    findUserById: jest.fn().mockResolvedValue(null),
    createUser: jest.fn(),
    updateProfile: jest.fn().mockResolvedValue(null),
    changePassword: jest.fn().mockResolvedValue('missing'),
    createLoginSession: jest.fn().mockResolvedValue('created'),
    rotateRefreshToken: jest.fn().mockResolvedValue(null),
    revokeRefreshToken: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function appFor(store: AuthStore) {
  return createApp({
    config,
    auditRecorder: () => undefined,
    authService: new AuthService({
      store,
      accessTokenSecret: SECRET,
      accessTokenTtlSeconds: 900,
      refreshTokenTtlSeconds: 604800,
    }),
  });
}

function token(userId: string, role: AuthUserRecord['role']): string {
  return `Bearer ${signAccessToken({ userId, role }, SECRET, 900)}`;
}

describe('POST /api/auth/login', () => {
  test('returns a session and allows the access token to load the profile', async () => {
    const clinician = makeUser(CLINICIAN_ID, 'clinician');
    const store = fakeStore({
      findUserByEmail: jest.fn().mockResolvedValue(clinician),
      findUserById: jest.fn().mockResolvedValue(clinician),
    });
    const app = appFor(store);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: clinician.email, password: PASSWORD });

    expect(login.status).toBe(200);
    expect(login.body).toEqual({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      user: {
        id: CLINICIAN_ID,
        email: clinician.email,
        fullName: clinician.fullName,
        role: 'clinician',
      },
      disclaimer: DISCLAIMER,
    });
    expect(JSON.stringify(login.body)).not.toContain(passwordHash);

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`);

    expect(me.status).toBe(200);
    expect(me.body.id).toBe(CLINICIAN_ID);
    expect(me.body).not.toHaveProperty('passwordHash');
    expect(me.body.disclaimer).toBe(DISCLAIMER);
  });

  test('returns 401 for invalid credentials', async () => {
    const store = fakeStore();
    const app = appFor(store);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'missing@example.test', password: PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(res.body.disclaimer).toBe(DISCLAIMER);
  });

  test('rate limits repeated login attempts', async () => {
    const app = appFor(fakeStore());

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const res = await request(app).post('/api/auth/login').send({});
      expect(res.status).toBe(400);
    }

    const limited = await request(app).post('/api/auth/login').send({});
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('auth request user validation', () => {
  test('returns 401 when the current user no longer exists', async () => {
    const store = fakeStore();
    const app = appFor(store);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', token(CLINICIAN_ID, 'clinician'));

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  test('returns 401 when the user role changed after the token was issued', async () => {
    const store = fakeStore({
      findUserById: jest
        .fn()
        .mockResolvedValue(makeUser(CLINICIAN_ID, 'researcher')),
    });
    const app = appFor(store);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', token(CLINICIAN_ID, 'clinician'));

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  test('returns 503 when database user validation fails', async () => {
    const store = fakeStore({
      findUserById: jest.fn().mockRejectedValue(new Error('database unavailable')),
    });
    const app = appFor(store);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', token(CLINICIAN_ID, 'clinician'));

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AUTH_UNAVAILABLE');
  });
});

describe('POST /api/auth/register', () => {
  test('allows an admin to create a user without returning the password hash', async () => {
    const admin = makeUser(ADMIN_ID, 'admin');
    const created = makeUser('33333333-3333-4333-8333-333333333333', 'clinician', {
      email: 'new.clinician@example.test',
      fullName: 'New Clinician',
    });
    const store = fakeStore({
      findUserById: jest.fn().mockResolvedValue(admin),
      createUser: jest.fn().mockResolvedValue(created),
    });
    const app = appFor(store);

    const res = await request(app)
      .post('/api/auth/register')
      .set('Authorization', token(ADMIN_ID, 'admin'))
      .send({
        email: 'New.Clinician@Example.Test',
        fullName: 'New Clinician',
        role: 'clinician',
        password: PASSWORD,
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: created.id,
      email: created.email,
      fullName: created.fullName,
      role: created.role,
      isActive: true,
      lastLogin: null,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
      disclaimer: DISCLAIMER,
    });
    expect(store.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'new.clinician@example.test',
        fullName: 'New Clinician',
        role: 'clinician',
        passwordHash: expect.any(String),
      })
    );
    expect(JSON.stringify(res.body)).not.toContain(PASSWORD);
  });

  test('rejects a password shorter than the policy minimum', async () => {
    const admin = makeUser(ADMIN_ID, 'admin');
    const store = fakeStore({
      findUserById: jest.fn().mockResolvedValue(admin),
    });
    const app = appFor(store);

    const res = await request(app)
      .post('/api/auth/register')
      .set('Authorization', token(ADMIN_ID, 'admin'))
      .send({
        email: 'new.clinician@example.test',
        fullName: 'New Clinician',
        role: 'clinician',
        password: 'too-short',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([
      expect.objectContaining({ field: 'password' }),
    ]);
    expect(store.createUser).not.toHaveBeenCalled();
  });

  test('rejects a non-admin', async () => {
    const clinician = makeUser(CLINICIAN_ID, 'clinician');
    const store = fakeStore({
      findUserById: jest.fn().mockResolvedValue(clinician),
    });
    const app = appFor(store);

    const res = await request(app)
      .post('/api/auth/register')
      .set('Authorization', token(CLINICIAN_ID, 'clinician'))
      .send({
        email: 'new.clinician@example.test',
        fullName: 'New Clinician',
        role: 'clinician',
        password: PASSWORD,
      });

    expect(res.status).toBe(403);
    expect(store.createUser).not.toHaveBeenCalled();
  });
});

describe('session lifecycle routes', () => {
  test('refreshes a session with rotated credentials', async () => {
    const clinician = makeUser(CLINICIAN_ID, 'clinician');
    const store = fakeStore({
      rotateRefreshToken: jest.fn().mockResolvedValue(clinician),
    });
    const app = appFor(store);

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'current-refresh-token' });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));
    expect(res.body.user.id).toBe(CLINICIAN_ID);
  });

  test('logs out with a refresh token and returns 204', async () => {
    const store = fakeStore();
    const app = appFor(store);

    const res = await request(app)
      .post('/api/auth/logout')
      .send({ refreshToken: 'current-refresh-token' });

    expect(res.status).toBe(204);
    expect(store.revokeRefreshToken).toHaveBeenCalledTimes(1);
  });

  test('changes the password for the authenticated user', async () => {
    const clinician = makeUser(CLINICIAN_ID, 'clinician');
    const store = fakeStore({
      findUserById: jest.fn().mockResolvedValue(clinician),
      changePassword: jest.fn().mockResolvedValue('changed'),
    });
    const app = appFor(store);

    const res = await request(app)
      .put('/api/auth/password')
      .set('Authorization', token(CLINICIAN_ID, 'clinician'))
      .send({
        currentPassword: PASSWORD,
        newPassword: 'a different strong password',
      });

    expect(res.status).toBe(204);
    expect(store.changePassword).toHaveBeenCalledTimes(1);
  });
});
