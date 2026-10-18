jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => {
    const client = { query: jest.fn(), release: jest.fn() };
    return {
      query: jest.fn(),
      end: jest.fn().mockResolvedValue(undefined),
      connect: jest.fn().mockResolvedValue(client),
      client,
    };
  }),
}));

import { Pool } from 'pg';
import {
  loadDatabaseConfig,
  initDatabase,
  checkDatabase,
  closeDatabase,
  sanitizeDatabaseError,
  withClient,
  withTransaction,
} from './db';

type MockClient = {
  query: jest.Mock;
  release: jest.Mock;
};

type MockPool = {
  query: jest.Mock;
  end: jest.Mock;
  connect: jest.Mock;
  client: MockClient;
};

function lastPool(): MockPool {
  const results = (Pool as unknown as jest.Mock).mock.results;
  return results[results.length - 1].value as MockPool;
}

afterEach(async () => {
  await closeDatabase();
  jest.clearAllMocks();
});

describe('loadDatabaseConfig', () => {
  test('returns null when DATABASE_URL is not set', () => {
    expect(loadDatabaseConfig({})).toBeNull();
  });

  test('returns the URL when valid', () => {
    const url = 'postgresql://user:pass@localhost:5432/schizophrenia_ai';
    expect(loadDatabaseConfig({ DATABASE_URL: url })).toBe(url);
  });

  test('throws on malformed URL without echoing the value', () => {
    const bad = 'not-a-url secret-value-123';
    expect(() => loadDatabaseConfig({ DATABASE_URL: bad })).toThrowError(
      /not a valid postgresql/
    );
    try {
      loadDatabaseConfig({ DATABASE_URL: bad });
    } catch (err) {
      expect((err as Error).message).not.toContain('secret-value-123');
    }
  });
});

describe('initDatabase', () => {
  test('creates a pool when DATABASE_URL is valid', () => {
    const { configured } = initDatabase({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    });
    expect(configured).toBe(true);
    expect(Pool).toHaveBeenCalledTimes(1);
    const options = (Pool as unknown as jest.Mock).mock.calls[0][0];
    expect(options.connectionString).toBe('postgresql://user:pass@localhost:5432/db');
    expect(options.max).toBeGreaterThan(0);
    expect(options.connectionTimeoutMillis).toBeGreaterThan(0);
  });

  test('returns not configured when DATABASE_URL is absent', () => {
    const { configured } = initDatabase({});
    expect(configured).toBe(false);
    expect(Pool).not.toHaveBeenCalled();
  });

  test('throws on malformed DATABASE_URL', () => {
    expect(() => initDatabase({ DATABASE_URL: 'ftp://nope' })).toThrowError(
      /not a valid postgresql/
    );
  });
});

describe('checkDatabase', () => {
  test('returns not_configured when the pool was never initialized', async () => {
    const result = await checkDatabase();
    expect(result).toEqual({ ok: false, reason: 'not_configured' });
  });

  test('executes SELECT 1 and reports latency on success', async () => {
    initDatabase({ DATABASE_URL: 'postgresql://user:pass@localhost:5432/db' });
    const pool = lastPool();
    pool.query.mockResolvedValue({ rows: [{ '?column?': 1 }] });

    const result = await checkDatabase();

    expect(pool.query).toHaveBeenCalledWith('SELECT 1');
    expect(result.ok).toBe(true);
    expect(typeof result.latencyMs).toBe('number');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.reason).toBeUndefined();
  });

  test('returns connection_failed with no error details on query failure', async () => {
    initDatabase({ DATABASE_URL: 'postgresql://user:s3cretpass@dbhost:5432/db' });
    const pool = lastPool();
    pool.query.mockRejectedValue(
      new Error('password authentication failed for user "user" host dbhost')
    );

    const result = await checkDatabase();

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('connection_failed');
    expect(result.latencyMs).toBeUndefined();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('s3cretpass');
    expect(serialized).not.toContain('dbhost');
    expect(serialized).not.toContain('password');
  });
});

describe('closeDatabase', () => {
  test('ends the pool exactly once', async () => {
    initDatabase({ DATABASE_URL: 'postgresql://user:pass@localhost:5432/db' });
    const pool = lastPool();
    await closeDatabase();
    await closeDatabase();
    expect(pool.end).toHaveBeenCalledTimes(1);
    await expect(checkDatabase()).resolves.toEqual({ ok: false, reason: 'not_configured' });
  });
});

describe('sanitizeDatabaseError', () => {
  test('redacts the connection string, credentials, and password patterns', () => {
    initDatabase({ DATABASE_URL: 'postgresql://dev:topsecret@postgres:5432/schizophrenia_ai' });
    const err = new Error(
      'connect failed: postgresql://dev:topsecret@postgres:5432/schizophrenia_ai password=topsecret'
    );
    (err as { code?: string }).code = 'ECONNREFUSED';

    const sanitized = sanitizeDatabaseError(err);

    expect(sanitized).not.toContain('topsecret');
    expect(sanitized).toContain('ECONNREFUSED');
    expect(sanitized).toContain('[redacted');
  });

  test('redacts a bare host, host:port, IPv4 address, and ENOTFOUND target', () => {
    const err = new Error(
      'getaddrinfo ENOTFOUND internal-db.example.com: connect ECONNREFUSED 10.0.0.5:5432 host internal-db.example.com'
    );
    (err as { code?: string }).code = 'ENOTFOUND';

    const sanitized = sanitizeDatabaseError(err);

    expect(sanitized).toContain('ENOTFOUND');
    expect(sanitized).not.toContain('internal-db.example.com');
    expect(sanitized).not.toContain('10.0.0.5');
  });
});

function initWithPool(): MockPool {
  initDatabase({ DATABASE_URL: 'postgresql://user:pass@localhost:5432/db' });
  return lastPool();
}

describe('withClient', () => {
  test('throws when the pool is not initialized', async () => {
    await expect(withClient(async () => 1)).rejects.toThrow(/not initialized/);
  });

  test('checks out a client and always releases it', async () => {
    const pool = initWithPool();
    const result = await withClient(async (client) => {
      await client.query('SELECT 1');
      return 42;
    });

    expect(result).toBe(42);
    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(pool.client.query).toHaveBeenCalledWith('SELECT 1');
    expect(pool.client.release).toHaveBeenCalledTimes(1);
  });

  test('releases the client even when the callback throws', async () => {
    const pool = initWithPool();
    await expect(
      withClient(async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(pool.client.release).toHaveBeenCalledTimes(1);
  });

  test('destroys the connection (release with an Error) when destroyOnError is set', async () => {
    const pool = initWithPool();
    await expect(
      withClient(
        async () => {
          throw new Error('boom');
        },
        { destroyOnError: true }
      )
    ).rejects.toThrow('boom');
    expect(pool.client.release).toHaveBeenCalledTimes(1);
    expect(pool.client.release.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  test('releases cleanly when destroyOnError is set but the callback succeeds', async () => {
    const pool = initWithPool();
    const result = await withClient(async () => 'ok', { destroyOnError: true });
    expect(result).toBe('ok');
    expect(pool.client.release).toHaveBeenCalledWith();
  });
});

describe('withTransaction', () => {
  test('wraps the callback in BEGIN/COMMIT and releases the client', async () => {
    const pool = initWithPool();
    const result = await withTransaction(async (client) => {
      await client.query('SELECT 1');
      return 'ok';
    });

    expect(result).toBe('ok');
    const statements = pool.client.query.mock.calls.map((call) => call[0]);
    expect(statements).toEqual(['BEGIN', 'SELECT 1', 'COMMIT']);
    expect(pool.client.release).toHaveBeenCalledTimes(1);
  });

  test('rolls back and rethrows when the callback fails, without committing', async () => {
    const pool = initWithPool();
    await expect(
      withTransaction(async () => {
        throw new Error('migration failed');
      })
    ).rejects.toThrow('migration failed');

    const statements = pool.client.query.mock.calls.map((call) => call[0]);
    expect(statements).toEqual(['BEGIN', 'ROLLBACK']);
    expect(statements).not.toContain('COMMIT');
    expect(pool.client.release).toHaveBeenCalledTimes(1);
  });

  test('rolls back when COMMIT fails', async () => {
    const pool = initWithPool();
    pool.client.query.mockImplementation(async (sql: string) => {
      if (sql === 'COMMIT') {
        throw new Error('commit failed');
      }
      return { rows: [] };
    });

    await expect(withTransaction(async () => 'value')).rejects.toThrow('commit failed');
    const statements = pool.client.query.mock.calls.map((call) => call[0]);
    expect(statements).toEqual(['BEGIN', 'COMMIT', 'ROLLBACK']);
  });

  test('applies a scoped statement timeout when requested', async () => {
    const pool = initWithPool();
    const result = await withTransaction(async () => 'ok', { statementTimeoutMs: 5000 });

    expect(result).toBe('ok');
    const statements = pool.client.query.mock.calls.map((call) => call[0]);
    expect(statements).toEqual(['BEGIN', 'SET LOCAL statement_timeout = 5000', 'COMMIT']);
  });

  test('does not set a statement timeout when none is requested', async () => {
    const pool = initWithPool();
    await withTransaction(async () => 'ok');
    const statements = pool.client.query.mock.calls.map((call) => call[0]);
    expect(statements.some((sql) => /statement_timeout/i.test(sql))).toBe(false);
  });

  test('preserves the original error and destroys the client when ROLLBACK also fails', async () => {
    const pool = initWithPool();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    pool.client.query.mockImplementation(async (sql: string) => {
      if (sql === 'ROLLBACK') {
        throw new Error('rollback failed');
      }
      return { rows: [] };
    });

    await expect(
      withTransaction(async () => {
        throw new Error('primary failure');
      })
    ).rejects.toThrow('primary failure');

    const statements = pool.client.query.mock.calls.map((call) => call[0]);
    expect(statements).toEqual(['BEGIN', 'ROLLBACK']);
    expect(pool.client.release).toHaveBeenCalledTimes(1);
    expect(pool.client.release.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(errorSpy).toHaveBeenCalledWith(
      'Database: warning: ROLLBACK failed (secondary):',
      expect.stringContaining('rollback failed')
    );
  });

  test('preserves the COMMIT error and destroys the client when ROLLBACK also fails', async () => {
    const pool = initWithPool();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    pool.client.query.mockImplementation(async (sql: string) => {
      if (sql === 'COMMIT') {
        throw new Error('commit failed');
      }
      if (sql === 'ROLLBACK') {
        throw new Error('rollback failed');
      }
      return { rows: [] };
    });

    await expect(withTransaction(async () => 'value')).rejects.toThrow('commit failed');

    const statements = pool.client.query.mock.calls.map((call) => call[0]);
    expect(statements).toEqual(['BEGIN', 'COMMIT', 'ROLLBACK']);
    expect(pool.client.release.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  test('releases the client cleanly when ROLLBACK succeeds', async () => {
    const pool = initWithPool();
    await expect(
      withTransaction(async () => {
        throw new Error('primary failure');
      })
    ).rejects.toThrow('primary failure');

    expect(pool.client.release).toHaveBeenCalledTimes(1);
    expect(pool.client.release.mock.calls[0][0]).toBeUndefined();
  });
});
