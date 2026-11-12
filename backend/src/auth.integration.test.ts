import request from 'supertest';
import { createApp } from './app';
import { loadConfig } from './config';
import { closeDatabase, initDatabase, query } from './db';
import type { AuthStore } from './services/authStore';
import { createSqlAuthStore } from './services/authStore';
import {
  AuthService,
  hashRefreshToken,
} from './services/authService';
import { disposableDatabaseUrl } from './testing/disposableDatabaseUrl';

const TEST_SECRET = 'unit-test-secret-value-123456';
const TEST_EMAIL_PREFIX = 'ph1ea-it-';
const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'a different strong password';

const baseEnv = {
  NODE_ENV: 'test',
  JWT_SECRET: TEST_SECRET,
  BACKEND_RATE_LIMIT_WINDOW_MS: '60000',
  BACKEND_RATE_LIMIT_MAX: '1000',
};

const testUrl = disposableDatabaseUrl();
const describeLive = testUrl ? describe : describe.skip;

jest.setTimeout(30000);

interface TokenRow {
  id: string;
  user_id: string;
  family_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  replaced_by: string | null;
}

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

interface Gate {
  wait(): Promise<void>;
  waitForPending(count: number): Promise<void>;
  releaseNext(): void;
  releaseAll(): void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createGate(): Gate {
  const pending: Deferred[] = [];
  const arrivals: Array<{ count: number; resolve: () => void }> = [];

  function notifyArrivals(): void {
    for (let index = arrivals.length - 1; index >= 0; index -= 1) {
      if (pending.length >= arrivals[index].count) {
        const [arrival] = arrivals.splice(index, 1);
        arrival.resolve();
      }
    }
  }

  return {
    wait() {
      const waiter = deferred();
      pending.push(waiter);
      notifyArrivals();
      return waiter.promise;
    },
    waitForPending(count) {
      if (pending.length >= count) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        arrivals.push({ count, resolve });
      });
    },
    releaseNext() {
      pending.shift()?.resolve();
    },
    releaseAll() {
      for (const waiter of pending.splice(0)) {
        waiter.resolve();
      }
    },
  };
}

describeLive('auth integration (disposable test database)', () => {
  let app!: ReturnType<typeof createApp>;
  let service: AuthService;
  let realStore: AuthStore;
  let store: AuthStore;
  let loginGate: Gate | null = null;
  let passwordGate: Gate | null = null;
  let suiteReady = false;
  let userCounter = 0;

  function nextEmail(label: string): string {
    userCounter += 1;
    return `${TEST_EMAIL_PREFIX}${label}_${userCounter}@example.test`;
  }

  async function removeSeeded(): Promise<void> {
    await query(
      `DELETE FROM refresh_tokens
       WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
      [`${TEST_EMAIL_PREFIX}%`]
    );
    await query('DELETE FROM users WHERE email LIKE $1', [`${TEST_EMAIL_PREFIX}%`]);
  }

  async function createUser(email: string): Promise<{ id: string }> {
    const user = await service.register({
      email,
      fullName: 'Integration User',
      role: 'clinician',
      password: PASSWORD,
    });
    return { id: user.id };
  }

  async function login(
    email: string,
    password = PASSWORD
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    user: { id: string; email: string };
  }> {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email, password });
    expect(response.status).toBe(200);
    return response.body as {
      accessToken: string;
      refreshToken: string;
      user: { id: string; email: string };
    };
  }

  function refresh(refreshToken: string) {
    return request(app).post('/api/auth/refresh').send({ refreshToken });
  }

  async function findToken(tokenHash: string): Promise<TokenRow | undefined> {
    const rows = await query<TokenRow>(
      `SELECT id, user_id, family_id, token_hash, expires_at, revoked_at, replaced_by
       FROM refresh_tokens
       WHERE token_hash = $1`,
      [tokenHash]
    );
    return rows[0];
  }

  function requireToken(token: TokenRow | undefined): TokenRow {
    if (!token) {
      throw new Error('Expected a refresh-token row');
    }
    return token;
  }

  async function countActiveTokens(userId: string): Promise<number> {
    const rows = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM refresh_tokens
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId]
    );
    return Number(rows[0]?.count ?? '0');
  }

  beforeAll(async () => {
    const { configured } = initDatabase({ DATABASE_URL: testUrl as string });
    if (!configured) {
      throw new Error('TEST_DATABASE_URL is set but the database pool was not configured');
    }
    const rows = await query<{ users_table: string | null; tokens_table: string | null }>(
      `SELECT to_regclass('public.users') AS users_table,
              to_regclass('public.refresh_tokens') AS tokens_table`
    );
    if (rows[0]?.users_table == null || rows[0]?.tokens_table == null) {
      throw new Error(
        'The users and refresh_tokens tables must exist in the test database; apply backend/migrations before running this suite'
      );
    }

    realStore = createSqlAuthStore();
    store = {
      ...realStore,
      async createLoginSession(input) {
        if (loginGate) {
          await loginGate.wait();
        }
        return realStore.createLoginSession(input);
      },
      async changePassword(userId, expectedPasswordHash, newPasswordHash) {
        if (passwordGate) {
          await passwordGate.wait();
        }
        return realStore.changePassword(
          userId,
          expectedPasswordHash,
          newPasswordHash
        );
      },
    };
    service = new AuthService({
      store,
      accessTokenSecret: TEST_SECRET,
      accessTokenTtlSeconds: 900,
      refreshTokenTtlSeconds: 604800,
    });
    suiteReady = true;
  });

  beforeEach(async () => {
    await removeSeeded();
    app = createApp({
      config: loadConfig(baseEnv),
      auditRecorder: () => undefined,
      authService: service,
    });
  });

  afterEach(() => {
    loginGate?.releaseAll();
    passwordGate?.releaseAll();
    loginGate = null;
    passwordGate = null;
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

  test('logs in, validates against the database, and rotates without extending expiry', async () => {
    const email = nextEmail('rotation');
    const created = await createUser(email);
    const session = await login(email);
    expect(session.user.id).toBe(created.id);

    const stored = requireToken(await findToken(hashRefreshToken(session.refreshToken)));
    expect(stored.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.token_hash).not.toBe(session.refreshToken);
    expect(stored.revoked_at).toBeNull();
    const originalExpiry = new Date(stored.expires_at).getTime();

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${session.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(email);
    expect(me.body).not.toHaveProperty('passwordHash');

    const firstRotation = await refresh(session.refreshToken);
    expect(firstRotation.status).toBe(200);
    expect(firstRotation.body.refreshToken).not.toBe(session.refreshToken);

    const oldToken = requireToken(
      await findToken(hashRefreshToken(session.refreshToken))
    );
    const firstReplacement = requireToken(
      await findToken(hashRefreshToken(firstRotation.body.refreshToken))
    );
    expect(oldToken.revoked_at).not.toBeNull();
    expect(oldToken.replaced_by).toBe(firstReplacement.id);
    expect(firstReplacement.family_id).toBe(stored.family_id);
    expect(firstReplacement.revoked_at).toBeNull();
    expect(new Date(firstReplacement.expires_at).getTime()).toBe(originalExpiry);

    const secondRotation = await refresh(firstRotation.body.refreshToken);
    expect(secondRotation.status).toBe(200);
    const secondReplacement = requireToken(
      await findToken(hashRefreshToken(secondRotation.body.refreshToken))
    );
    expect(secondReplacement.family_id).toBe(stored.family_id);
    expect(new Date(secondReplacement.expires_at).getTime()).toBe(originalExpiry);
  });

  test('revokes the entire family and rejects descendants after replay', async () => {
    const email = nextEmail('replay');
    const created = await createUser(email);
    const session = await login(email);

    const rotated = await refresh(session.refreshToken);
    expect(rotated.status).toBe(200);

    const replay = await refresh(session.refreshToken);
    expect(replay.status).toBe(401);
    expect(replay.body.error.message).toBe('The refresh token is invalid or expired.');
    expect(JSON.stringify(replay.body)).not.toContain(session.refreshToken);

    const descendant = await refresh(rotated.body.refreshToken);
    expect(descendant.status).toBe(401);
    expect(await countActiveTokens(created.id)).toBe(0);

    const tokens = await query<{ revoked_at: Date | null }>(
      `SELECT revoked_at
       FROM refresh_tokens
       WHERE user_id = $1`,
      [created.id]
    );
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.every((token) => token.revoked_at !== null)).toBe(true);
  });

  test('allows only one concurrent refresh and leaves no valid replacement', async () => {
    const email = nextEmail('concurrent');
    const created = await createUser(email);
    const session = await login(email);

    const [first, second] = await Promise.all([
      refresh(session.refreshToken),
      refresh(session.refreshToken),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 401]);

    const winner = first.status === 200 ? first : second;
    expect(await countActiveTokens(created.id)).toBe(0);

    const after = await refresh(winner.body.refreshToken);
    expect(after.status).toBe(401);
  });

  test('revokes every token family when the password changes', async () => {
    const email = nextEmail('password');
    const created = await createUser(email);
    const firstSession = await login(email);
    const firstReplacement = await refresh(firstSession.refreshToken);
    expect(firstReplacement.status).toBe(200);
    const secondSession = await login(email);

    const changed = await request(app)
      .put('/api/auth/password')
      .set('Authorization', `Bearer ${secondSession.accessToken}`)
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(changed.status).toBe(204);
    expect(await countActiveTokens(created.id)).toBe(0);

    const familyRows = await query<{ count: string }>(
      `SELECT COUNT(DISTINCT family_id)::text AS count
       FROM refresh_tokens
       WHERE user_id = $1`,
      [created.id]
    );
    expect(familyRows[0]?.count).toBe('2');

    const firstAfter = await refresh(firstReplacement.body.refreshToken);
    expect(firstAfter.status).toBe(401);
    const secondAfter = await refresh(secondSession.refreshToken);
    expect(secondAfter.status).toBe(401);

    const oldPassword = await request(app)
      .post('/api/auth/login')
      .send({ email, password: PASSWORD });
    expect(oldPassword.status).toBe(401);
    await login(email, NEW_PASSWORD);
  });

  test('does not create a session when the verified password changes before token insert', async () => {
    const email = nextEmail('stale-login');
    const created = await createUser(email);
    const passwordSession = await login(email);
    const gate = createGate();
    loginGate = gate;

    const pendingLogin = request(app)
      .post('/api/auth/login')
      .send({ email, password: PASSWORD });

    try {
      await gate.waitForPending(1);

      const changed = await request(app)
        .put('/api/auth/password')
        .set('Authorization', `Bearer ${passwordSession.accessToken}`)
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
      expect(changed.status).toBe(204);

      gate.releaseNext();
      const staleLogin = await pendingLogin;
      loginGate = null;

      expect(staleLogin.status).toBe(401);
      expect(staleLogin.body.error.message).toBe('Invalid email or password.');
      expect(await countActiveTokens(created.id)).toBe(0);

      const oldPassword = await request(app)
        .post('/api/auth/login')
        .send({ email, password: PASSWORD });
      expect(oldPassword.status).toBe(401);

      await login(email, NEW_PASSWORD);
    } finally {
      gate.releaseAll();
      loginGate = null;
    }
  });

  test('does not let a stale concurrent password change overwrite the committed password', async () => {
    const email = nextEmail('stale-password');
    const created = await createUser(email);
    const firstSession = await login(email);
    const secondSession = await login(email);
    const gate = createGate();
    passwordGate = gate;
    const firstNewPassword = 'first new strong password';
    const secondNewPassword = 'second new strong password';

    const first = request(app)
      .put('/api/auth/password')
      .set('Authorization', `Bearer ${firstSession.accessToken}`)
      .send({ currentPassword: PASSWORD, newPassword: firstNewPassword });

    try {
      await gate.waitForPending(1);

      const second = request(app)
        .put('/api/auth/password')
        .set('Authorization', `Bearer ${secondSession.accessToken}`)
        .send({ currentPassword: PASSWORD, newPassword: secondNewPassword });
      await gate.waitForPending(2);

      gate.releaseNext();
      const firstResponse = await first;
      expect(firstResponse.status).toBe(204);

      gate.releaseNext();
      const secondResponse = await second;
      expect(secondResponse.status).toBe(401);
      expect(secondResponse.body.error.message).toBe(
        'Current password is incorrect.'
      );
      expect(await countActiveTokens(created.id)).toBe(0);

      const oldPassword = await request(app)
        .post('/api/auth/login')
        .send({ email, password: PASSWORD });
      expect(oldPassword.status).toBe(401);

      await login(email, firstNewPassword);

      const staleNewPassword = await request(app)
        .post('/api/auth/login')
        .send({ email, password: secondNewPassword });
      expect(staleNewPassword.status).toBe(401);
    } finally {
      gate.releaseAll();
      passwordGate = null;
    }
  });

  test('does not let a refresh replacement survive a concurrent password change', async () => {
    const email = nextEmail('race');
    const created = await createUser(email);
    const passwordSession = await login(email);
    const refreshSession = await login(email);

    const [changed, rotated] = await Promise.all([
      request(app)
        .put('/api/auth/password')
        .set('Authorization', `Bearer ${passwordSession.accessToken}`)
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }),
      refresh(refreshSession.refreshToken),
    ]);
    expect(changed.status).toBe(204);
    expect([200, 401]).toContain(rotated.status);
    expect(await countActiveTokens(created.id)).toBe(0);

    if (rotated.status === 200) {
      const after = await refresh(rotated.body.refreshToken);
      expect(after.status).toBe(401);
    }

    await login(email, NEW_PASSWORD);
  });

  test('rolls back rotation when the replacement insert fails', async () => {
    const email = nextEmail('rollback');
    const created = await createUser(email);
    const session = await login(email);
    const originalHash = hashRefreshToken(session.refreshToken);
    const before = requireToken(await findToken(originalHash));
    expect(before.revoked_at).toBeNull();

    await expect(
      store.rotateRefreshToken({
        currentTokenHash: originalHash,
        newTokenHash: originalHash,
      })
    ).rejects.toThrow('Auth store operation failed');

    const after = requireToken(await findToken(originalHash));
    expect(after.revoked_at).toBeNull();
    expect(after.replaced_by).toBeNull();

    const rotated = await refresh(session.refreshToken);
    expect(rotated.status).toBe(200);
    expect(created.id).toBe(session.user.id);
  });
});
