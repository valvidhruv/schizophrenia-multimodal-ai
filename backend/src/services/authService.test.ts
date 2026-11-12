import { ApiError } from '../errors';
import type { AuthPrincipal } from '../types';
import type {
  AuthStore,
  AuthUserRecord,
  CreateAuthUserInput,
} from './authStore';
import {
  AuthService,
  hashRefreshToken,
  type AuthServiceOptions,
} from './authService';
import { hashPassword, verifyPassword } from './passwordService';
import { verifyAccessToken } from './tokenService';

const SECRET = 'unit-test-secret-value-123456';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const FAMILY_ID = '44444444-4444-4444-8444-444444444444';
const NOW_MS = 1_700_000_000_000;
const NOW_SECONDS = NOW_MS / 1000;
const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'a different strong password';

let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

function makeUser(overrides: Partial<AuthUserRecord> = {}): AuthUserRecord {
  return {
    id: USER_ID,
    email: 'clinician@example.test',
    passwordHash,
    fullName: 'Test Clinician',
    role: 'clinician',
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

function makeService(
  store: AuthStore,
  overrides: Partial<AuthServiceOptions> = {}
): AuthService {
  return new AuthService({
    store,
    accessTokenSecret: SECRET,
    accessTokenTtlSeconds: 900,
    refreshTokenTtlSeconds: 604800,
    now: () => NOW_MS,
    generateRefreshToken: () => 'refresh-token-one',
    generateFamilyId: () => FAMILY_ID,
    ...overrides,
  });
}

describe('AuthService login', () => {
  test('issues a session and persists only the refresh token hash', async () => {
    const user = makeUser();
    const store = fakeStore({
      findUserByEmail: jest.fn().mockResolvedValue(user),
    });
    const service = makeService(store);

    const result = await service.login({
      email: '  CLINICIAN@example.test ',
      password: PASSWORD,
    });

    expect(store.findUserByEmail).toHaveBeenCalledWith('clinician@example.test');
    expect(store.createLoginSession).toHaveBeenCalledWith({
      userId: USER_ID,
      expectedPasswordHash: passwordHash,
      familyId: FAMILY_ID,
      tokenHash: hashRefreshToken('refresh-token-one'),
      expiresAt: new Date(NOW_MS + 604800000),
    });
    expect(store.createLoginSession).not.toHaveBeenCalledWith(
      expect.objectContaining({ tokenHash: 'refresh-token-one' })
    );
    expect(result.session).toEqual({
      accessToken: expect.any(String),
      refreshToken: 'refresh-token-one',
      user: {
        id: USER_ID,
        email: user.email,
        fullName: user.fullName,
        role: 'clinician',
      },
    });
    expect(result.principal).toEqual({
      userId: USER_ID,
      role: 'clinician',
      iat: NOW_SECONDS,
      exp: NOW_SECONDS + 900,
    });
    expect(verifyAccessToken(result.session.accessToken, SECRET, NOW_SECONDS)).toEqual(
      result.principal
    );
  });

  test('rejects an unknown email without revealing account existence', async () => {
    const store = fakeStore();
    const service = makeService(store);

    await expect(
      service.login({ email: 'missing@example.test', password: PASSWORD })
    ).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Invalid email or password.',
    });
    expect(store.createLoginSession).not.toHaveBeenCalled();
  });

  test('rejects a bad password without creating a login session', async () => {
    const store = fakeStore({
      findUserByEmail: jest.fn().mockResolvedValue(makeUser()),
    });
    const service = makeService(store);

    await expect(
      service.login({ email: 'clinician@example.test', password: 'wrong password' })
    ).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    expect(store.createLoginSession).not.toHaveBeenCalled();
  });

  test('rejects an inactive account with the same invalid-credentials error', async () => {
    const store = fakeStore({
      findUserByEmail: jest.fn().mockResolvedValue(makeUser({ isActive: false })),
    });
    const service = makeService(store);

    await expect(
      service.login({ email: 'clinician@example.test', password: PASSWORD })
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      service.login({ email: 'clinician@example.test', password: PASSWORD })
    ).rejects.toMatchObject({
      status: 401,
      message: 'Invalid email or password.',
    });
    expect(store.createLoginSession).not.toHaveBeenCalled();
  });

  test('rejects a stale verified password without creating a session', async () => {
    const store = fakeStore({
      findUserByEmail: jest.fn().mockResolvedValue(makeUser()),
      createLoginSession: jest.fn().mockResolvedValue('stale'),
    });
    const service = makeService(store);

    await expect(
      service.login({ email: 'clinician@example.test', password: PASSWORD })
    ).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Invalid email or password.',
    });
    expect(store.createLoginSession).toHaveBeenCalledTimes(1);
  });

  test('returns 501 when the access-token secret is not configured', async () => {
    const store = fakeStore({
      findUserByEmail: jest.fn().mockResolvedValue(makeUser()),
    });
    const service = makeService(store, { accessTokenSecret: null });

    await expect(
      service.login({ email: 'clinician@example.test', password: PASSWORD })
    ).rejects.toMatchObject({ status: 501, code: 'AUTH_NOT_CONFIGURED' });
    expect(store.findUserByEmail).not.toHaveBeenCalled();
  });
});

describe('AuthService refresh and logout', () => {
  test('rotates the refresh token and returns a new session without inserting twice', async () => {
    const user = makeUser();
    const store = fakeStore({
      rotateRefreshToken: jest.fn().mockResolvedValue(user),
    });
    const service = makeService(store, {
      generateRefreshToken: () => 'replacement-token',
    });

    const result = await service.refresh('current-token');

    expect(store.rotateRefreshToken).toHaveBeenCalledWith({
      currentTokenHash: hashRefreshToken('current-token'),
      newTokenHash: hashRefreshToken('replacement-token'),
    });
    expect(store.createLoginSession).not.toHaveBeenCalled();
    expect(result.session.refreshToken).toBe('replacement-token');
    expect(result.session.accessToken).toEqual(expect.any(String));
  });

  test('rejects an invalid or expired refresh token', async () => {
    const store = fakeStore();
    const service = makeService(store);

    await expect(service.refresh('missing-token')).rejects.toMatchObject({
      status: 401,
      message: 'The refresh token is invalid or expired.',
    });
  });

  test('revokes a refresh token by hash on logout', async () => {
    const store = fakeStore();
    const service = makeService(store);

    await service.logout('current-token');

    expect(store.revokeRefreshToken).toHaveBeenCalledWith(
      hashRefreshToken('current-token')
    );
  });
});

describe('AuthService registration and profile', () => {
  test('hashes the password and normalizes the email before creating a user', async () => {
    let captured: CreateAuthUserInput | undefined;
    const store = fakeStore({
      createUser: jest.fn(async (input: CreateAuthUserInput) => {
        captured = input;
        return makeUser({
          id: '22222222-2222-4222-8222-222222222222',
          email: input.email,
          fullName: input.fullName,
          role: input.role,
          passwordHash: input.passwordHash,
        });
      }),
    });
    const service = makeService(store);

    const user = await service.register({
      email: '  NEW.USER@Example.Test ',
      fullName: 'New User',
      role: 'researcher',
      password: PASSWORD,
    });

    expect(captured).toBeDefined();
    expect(captured?.email).toBe('new.user@example.test');
    expect(captured?.role).toBe('researcher');
    await expect(verifyPassword(PASSWORD, captured?.passwordHash ?? '')).resolves.toBe(
      true
    );
    expect(user).not.toHaveProperty('passwordHash');
    expect(user.email).toBe('new.user@example.test');
  });

  test('returns the current public profile without the password hash', async () => {
    const store = fakeStore({
      findUserById: jest.fn().mockResolvedValue(makeUser()),
    });
    const service = makeService(store);

    const user = await service.me(USER_ID);

    expect(user).not.toHaveProperty('passwordHash');
    expect(user.lastLogin).toBeNull();
    expect(user.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  test('rejects profile reads for an inactive user', async () => {
    const store = fakeStore({
      findUserById: jest.fn().mockResolvedValue(makeUser({ isActive: false })),
    });
    const service = makeService(store);

    await expect(service.me(USER_ID)).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHORIZED',
    });
  });
});

describe('AuthService password changes', () => {
  test('passes the verified hash to the store and stores a new hash', async () => {
    const store = fakeStore({
      findUserById: jest.fn().mockResolvedValue(makeUser()),
      changePassword: jest.fn().mockResolvedValue('changed'),
    });
    const service = makeService(store);

    await service.changePassword(USER_ID, {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    const call = jest.mocked(store.changePassword).mock.calls[0];
    expect(call?.[0]).toBe(USER_ID);
    expect(call?.[1]).toBe(passwordHash);
    await expect(verifyPassword(NEW_PASSWORD, call?.[2] ?? '')).resolves.toBe(true);
    await expect(verifyPassword(PASSWORD, call?.[2] ?? '')).resolves.toBe(false);
  });

  test('rejects a password change made stale before the store update', async () => {
    const store = fakeStore({
      findUserById: jest.fn().mockResolvedValue(makeUser()),
      changePassword: jest.fn().mockResolvedValue('stale'),
    });
    const service = makeService(store);

    await expect(
      service.changePassword(USER_ID, {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
      })
    ).rejects.toMatchObject({
      status: 401,
      message: 'Current password is incorrect.',
    });
    expect(store.changePassword).toHaveBeenCalledWith(
      USER_ID,
      passwordHash,
      expect.any(String)
    );
  });

  test('rejects an incorrect current password', async () => {
    const store = fakeStore({
      findUserById: jest.fn().mockResolvedValue(makeUser()),
    });
    const service = makeService(store);

    await expect(
      service.changePassword(USER_ID, {
        currentPassword: 'wrong password',
        newPassword: NEW_PASSWORD,
      })
    ).rejects.toMatchObject({
      status: 401,
      message: 'Current password is incorrect.',
    });
    expect(store.changePassword).not.toHaveBeenCalled();
  });

  test('rejects reuse of the current password before hashing', async () => {
    const store = fakeStore({
      findUserById: jest.fn().mockResolvedValue(makeUser()),
    });
    const service = makeService(store);

    await expect(
      service.changePassword(USER_ID, {
        currentPassword: PASSWORD,
        newPassword: PASSWORD,
      })
    ).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
    expect(store.changePassword).not.toHaveBeenCalled();
  });
});

describe('AuthService principal validation', () => {
  const principal: AuthPrincipal = {
    userId: USER_ID,
    role: 'clinician',
    iat: NOW_SECONDS,
    exp: NOW_SECONDS + 900,
  };

  test('accepts a matching active user', async () => {
    const store = fakeStore({
      findUserById: jest.fn().mockResolvedValue(makeUser()),
    });
    const service = makeService(store);

    await expect(service.validatePrincipal(principal)).resolves.toEqual(principal);
  });

  test('rejects a missing, inactive, or role-changed user', async () => {
    for (const user of [
      null,
      makeUser({ isActive: false }),
      makeUser({ role: 'researcher' }),
    ]) {
      const store = fakeStore({
        findUserById: jest.fn().mockResolvedValue(user),
      });
      const service = makeService(store);

      await expect(service.validatePrincipal(principal)).resolves.toBeNull();
    }
  });
});
