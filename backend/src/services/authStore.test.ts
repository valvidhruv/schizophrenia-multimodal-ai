import type {
  AuthClient,
  AuthQueryFn,
  AuthTransactionFn,
  CreateAuthUserInput,
} from './authStore';
import { createSqlAuthStore } from './authStore';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const FAMILY_ID = '44444444-4444-4444-8444-444444444444';

const userRow = {
  id: USER_ID,
  email: 'clinician@example.test',
  password_hash: 'stored-hash',
  full_name: 'Test Clinician',
  role: 'clinician' as const,
  is_active: true,
  last_login: null,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-01T00:00:00.000Z'),
};

function queryFnFrom(mock: jest.Mock): AuthQueryFn {
  return mock as unknown as AuthQueryFn;
}

function transactionFrom(clientQuery: jest.Mock): AuthTransactionFn {
  return (async <T>(fn: (client: AuthClient) => Promise<T>): Promise<T> => {
    const client = { query: clientQuery } as unknown as AuthClient;
    return fn(client);
  }) as AuthTransactionFn;
}

describe('SQL auth store user reads', () => {
  test('maps a database row to the public auth record shape', async () => {
    const queryFn = jest.fn().mockResolvedValue([userRow]);
    const store = createSqlAuthStore({ queryFn: queryFnFrom(queryFn) });

    const user = await store.findUserByEmail('clinician@example.test');

    expect(queryFn).toHaveBeenCalledWith(
      expect.stringContaining('FROM users WHERE email = $1'),
      ['clinician@example.test']
    );
    expect(user).toEqual({
      id: USER_ID,
      email: 'clinician@example.test',
      passwordHash: 'stored-hash',
      fullName: 'Test Clinician',
      role: 'clinician',
      isActive: true,
      lastLogin: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  test('returns null when no user matches', async () => {
    const queryFn = jest.fn().mockResolvedValue([]);
    const store = createSqlAuthStore({ queryFn: queryFnFrom(queryFn) });

    await expect(store.findUserById(USER_ID)).resolves.toBeNull();
  });

  test('sanitizes database errors', async () => {
    const queryFn = jest
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
          code: 'ECONNREFUSED',
        })
      );
    const store = createSqlAuthStore({ queryFn: queryFnFrom(queryFn) });

    let caught: unknown;
    try {
      await store.findUserById(USER_ID);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('Auth store operation failed');
    expect((caught as Error).message).not.toContain('127.0.0.1');
  });
});

describe('SQL auth store login sessions', () => {
  const expiresAt = new Date('2026-02-01T00:00:00.000Z');

  test('locks the user, checks the verified hash, and stores the token atomically', async () => {
    const clientQuery = jest
      .fn()
      .mockResolvedValueOnce({
        rows: [{ id: USER_ID, password_hash: 'stored-hash' }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const store = createSqlAuthStore({
      queryFn: queryFnFrom(jest.fn()),
      withTransactionFn: transactionFrom(clientQuery),
    });

    await expect(
      store.createLoginSession({
        userId: USER_ID,
        expectedPasswordHash: 'stored-hash',
        familyId: FAMILY_ID,
        tokenHash: 'hashed-token',
        expiresAt,
      })
    ).resolves.toBe('created');

    expect(clientQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('FOR UPDATE'),
      [USER_ID]
    );
    expect(clientQuery.mock.calls[0][0]).toContain('password_hash');
    expect(clientQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('last_login = NOW()'),
      [USER_ID]
    );
    expect(clientQuery).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('INSERT INTO refresh_tokens'),
      [USER_ID, FAMILY_ID, 'hashed-token', expiresAt]
    );
  });

  test('creates no token when the password hash changed after verification', async () => {
    const clientQuery = jest.fn().mockResolvedValueOnce({
      rows: [{ id: USER_ID, password_hash: 'newer-hash' }],
      rowCount: 1,
    });
    const store = createSqlAuthStore({
      queryFn: queryFnFrom(jest.fn()),
      withTransactionFn: transactionFrom(clientQuery),
    });

    await expect(
      store.createLoginSession({
        userId: USER_ID,
        expectedPasswordHash: 'stored-hash',
        familyId: FAMILY_ID,
        tokenHash: 'hashed-token',
        expiresAt,
      })
    ).resolves.toBe('stale');
    expect(clientQuery).toHaveBeenCalledTimes(1);
  });

  test('creates no token when the user is missing or inactive', async () => {
    const clientQuery = jest.fn().mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const store = createSqlAuthStore({
      queryFn: queryFnFrom(jest.fn()),
      withTransactionFn: transactionFrom(clientQuery),
    });

    await expect(
      store.createLoginSession({
        userId: USER_ID,
        expectedPasswordHash: 'stored-hash',
        familyId: FAMILY_ID,
        tokenHash: 'hashed-token',
        expiresAt,
      })
    ).resolves.toBe('missing');
    expect(clientQuery).toHaveBeenCalledTimes(1);
  });
});

describe('SQL auth store logout', () => {

  test('revokes every active token in the family on logout', async () => {
    const clientQuery = jest
      .fn()
      .mockResolvedValueOnce({
        rows: [{ user_id: USER_ID, family_id: FAMILY_ID }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ id: USER_ID }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const store = createSqlAuthStore({
      queryFn: queryFnFrom(jest.fn()),
      withTransactionFn: transactionFrom(clientQuery),
    });

    await store.revokeRefreshToken('current-hash');

    expect(clientQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('FOR UPDATE'),
      [USER_ID]
    );
    expect(clientQuery).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('WHERE family_id = $1 AND revoked_at IS NULL'),
      [FAMILY_ID]
    );
  });
});

describe('SQL auth store user writes', () => {
  test('creates a user and maps the returned row', async () => {
    const queryFn = jest.fn().mockResolvedValue([userRow]);
    const store = createSqlAuthStore({ queryFn: queryFnFrom(queryFn) });
    const input: CreateAuthUserInput = {
      email: 'clinician@example.test',
      passwordHash: 'stored-hash',
      fullName: 'Test Clinician',
      role: 'clinician',
    };

    const user = await store.createUser(input);

    expect(queryFn).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO users'),
      ['clinician@example.test', 'stored-hash', 'Test Clinician', 'clinician']
    );
    expect(user.id).toBe(USER_ID);
  });

  test('maps a unique email violation to a 409 conflict', async () => {
    const violation = Object.assign(
      new Error('duplicate key value violates unique constraint "users_email_key"'),
      { code: '23505', constraint: 'users_email_key' }
    );
    const queryFn = jest.fn().mockRejectedValue(violation);
    const store = createSqlAuthStore({ queryFn: queryFnFrom(queryFn) });

    await expect(
      store.createUser({
        email: 'clinician@example.test',
        passwordHash: 'stored-hash',
        fullName: 'Test Clinician',
        role: 'clinician',
      })
    ).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT',
      message: 'A user with this email already exists.',
    });
  });

  test('locks the user, verifies the hash, and revokes all tokens on password change', async () => {
    const clientQuery = jest
      .fn()
      .mockResolvedValueOnce({
        rows: [{ id: USER_ID, password_hash: 'stored-hash' }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const withTransactionFn = transactionFrom(clientQuery);
    const store = createSqlAuthStore({
      queryFn: queryFnFrom(jest.fn()),
      withTransactionFn,
    });

    await expect(
      store.changePassword(USER_ID, 'stored-hash', 'new-hash')
    ).resolves.toBe('changed');

    expect(clientQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('FOR UPDATE'),
      [USER_ID]
    );
    expect(clientQuery.mock.calls[0][0]).toContain('FROM users');
    expect(clientQuery.mock.calls[0][0]).toContain('password_hash');
    expect(clientQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE users'),
      [USER_ID, 'stored-hash', 'new-hash']
    );
    expect(clientQuery).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('UPDATE refresh_tokens'),
      [USER_ID]
    );
    expect(clientQuery.mock.calls[2][0]).toContain('revoked_at = NOW()');
  });

  test('does not update or revoke tokens when the expected hash is stale', async () => {
    const clientQuery = jest.fn().mockResolvedValueOnce({
      rows: [{ id: USER_ID, password_hash: 'newer-hash' }],
      rowCount: 1,
    });
    const store = createSqlAuthStore({
      queryFn: queryFnFrom(jest.fn()),
      withTransactionFn: transactionFrom(clientQuery),
    });

    await expect(
      store.changePassword(USER_ID, 'stored-hash', 'new-hash')
    ).resolves.toBe('stale');
    expect(clientQuery).toHaveBeenCalledTimes(1);
  });

  test('does not revoke refresh tokens when the user is missing or inactive', async () => {
    const clientQuery = jest.fn().mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const withTransactionFn = transactionFrom(clientQuery);
    const store = createSqlAuthStore({
      queryFn: queryFnFrom(jest.fn()),
      withTransactionFn,
    });

    await expect(
      store.changePassword(USER_ID, 'stored-hash', 'new-hash')
    ).resolves.toBe('missing');
    expect(clientQuery).toHaveBeenCalledTimes(1);
  });
});

describe('SQL auth store refresh token rotation', () => {
  const expiresAt = new Date('2026-02-01T00:00:00.000Z');
  const activeToken = {
    id: 'old-token-id',
    user_id: USER_ID,
    family_id: FAMILY_ID,
    expires_at: expiresAt,
    revoked_at: null,
    expired: false,
  };

  test('locks the user, inserts the replacement in the same family, and preserves expiry', async () => {
    const clientQuery = jest
      .fn()
      .mockResolvedValueOnce({ rows: [userRow], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [activeToken], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'new-token-id' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const withTransactionFn = transactionFrom(clientQuery);
    const store = createSqlAuthStore({
      queryFn: queryFnFrom(jest.fn()),
      withTransactionFn,
    });

    const user = await store.rotateRefreshToken({
      currentTokenHash: 'old-hash',
      newTokenHash: 'new-hash',
    });

    expect(user?.id).toBe(USER_ID);
    expect(clientQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('FOR UPDATE OF u'),
      ['old-hash']
    );
    expect(clientQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('FROM refresh_tokens'),
      ['old-hash']
    );
    expect(clientQuery).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('INSERT INTO refresh_tokens'),
      [USER_ID, FAMILY_ID, 'new-hash', expiresAt]
    );
    expect(clientQuery).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('SET revoked_at = NOW(), replaced_by = $2'),
      ['old-token-id', 'new-token-id']
    );
  });

  test('returns null for an unknown refresh token without modifying tokens', async () => {
    const clientQuery = jest.fn().mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const withTransactionFn = transactionFrom(clientQuery);
    const store = createSqlAuthStore({
      queryFn: queryFnFrom(jest.fn()),
      withTransactionFn,
    });

    await expect(
      store.rotateRefreshToken({
        currentTokenHash: 'missing-hash',
        newTokenHash: 'new-hash',
      })
    ).resolves.toBeNull();
    expect(clientQuery).toHaveBeenCalledTimes(1);
  });

  test('revokes the whole family when a rotated token is replayed', async () => {
    const clientQuery = jest
      .fn()
      .mockResolvedValueOnce({ rows: [userRow], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ ...activeToken, revoked_at: new Date('2026-01-02T00:00:00.000Z') }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const withTransactionFn = transactionFrom(clientQuery);
    const store = createSqlAuthStore({
      queryFn: queryFnFrom(jest.fn()),
      withTransactionFn,
    });

    await expect(
      store.rotateRefreshToken({
        currentTokenHash: 'rotated-hash',
        newTokenHash: 'new-hash',
      })
    ).resolves.toBeNull();

    expect(clientQuery).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('WHERE family_id = $1 AND revoked_at IS NULL'),
      [FAMILY_ID]
    );
    expect(clientQuery).toHaveBeenCalledTimes(3);
  });

  test('returns null for an expired token without inserting a replacement', async () => {
    const clientQuery = jest
      .fn()
      .mockResolvedValueOnce({ rows: [userRow], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ ...activeToken, expired: true }],
        rowCount: 1,
      });
    const withTransactionFn = transactionFrom(clientQuery);
    const store = createSqlAuthStore({
      queryFn: queryFnFrom(jest.fn()),
      withTransactionFn,
    });

    await expect(
      store.rotateRefreshToken({
        currentTokenHash: 'expired-hash',
        newTokenHash: 'new-hash',
      })
    ).resolves.toBeNull();
    expect(clientQuery).toHaveBeenCalledTimes(2);
  });
});
