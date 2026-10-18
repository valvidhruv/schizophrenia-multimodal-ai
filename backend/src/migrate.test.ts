jest.mock('./db', () => ({
  initDatabase: jest.fn(),
  closeDatabase: jest.fn().mockResolvedValue(undefined),
  withClient: jest.fn(),
  withTransaction: jest.fn(),
  sanitizeDatabaseError: jest.fn((err: unknown) =>
    err instanceof Error ? err.message : String(err)
  ),
}));

import fs from 'fs';
import os from 'os';
import path from 'path';
import { withClient, withTransaction, initDatabase, closeDatabase } from './db';
import {
  discoverMigrations,
  buildPlan,
  computeChecksum,
  runUp,
  runStatus,
  main,
} from './migrate';
import type { AppliedMigrationRow } from './migrate';

const mockWithClient = withClient as jest.Mock;
const mockWithTransaction = withTransaction as jest.Mock;
const mockInitDatabase = initDatabase as jest.Mock;
const mockCloseDatabase = closeDatabase as jest.Mock;

interface QueryCall {
  sql: string;
  params?: unknown[];
}

interface MockClient {
  query: jest.Mock;
  release: jest.Mock;
  calls: QueryCall[];
}

function createClient(
  responseFor: (sql: string) => unknown = () => ({ rows: [] })
): MockClient {
  const calls: QueryCall[] = [];
  const query = jest.fn(async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    return responseFor(sql);
  });
  return { query, release: jest.fn(), calls };
}

interface ClientOptions {
  applied?: AppliedMigrationRow[];
  present?: boolean;
  failSql?: string;
  lockAcquired?: boolean;
}

function setupClients(options: ClientOptions = {}): {
  lockClient: MockClient;
  txClient: MockClient;
} {
  const lockClient = createClient((sql) => {
    if (/pg_try_advisory_lock/i.test(sql)) {
      return { rows: [{ locked: options.lockAcquired ?? true }] };
    }
    if (/to_regclass/i.test(sql)) {
      return { rows: [{ present: options.present ?? true }] };
    }
    if (/FROM schema_migrations/i.test(sql)) {
      return { rows: options.applied ?? [] };
    }
    return { rows: [] };
  });
  const txClient = createClient((sql) => {
    if (options.failSql && sql === options.failSql) {
      throw new Error('SQL error');
    }
    return { rows: [] };
  });
  mockWithClient.mockImplementation(
    (fn: (client: MockClient) => Promise<unknown>) => fn(lockClient)
  );
  mockWithTransaction.mockImplementation(
    (fn: (client: MockClient) => Promise<unknown>) => fn(txClient)
  );
  return { lockClient, txClient };
}

function writeMigration(dir: string, filename: string, sql: string): void {
  fs.writeFileSync(path.join(dir, filename), sql, 'utf8');
}

function applyTrackingInserts(client: MockClient): QueryCall[] {
  return client.calls.filter((call) => /INSERT INTO schema_migrations/i.test(call.sql));
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('discoverMigrations', () => {
  test('returns migrations ordered by version with sha256 checksums', () => {
    writeMigration(tmpDir, '0002_second.sql', 'SELECT 2;');
    writeMigration(tmpDir, '0001_first.sql', 'SELECT 1;');

    const files = discoverMigrations(tmpDir);

    expect(files.map((file) => file.filename)).toEqual([
      '0001_first.sql',
      '0002_second.sql',
    ]);
    expect(files[0].version).toBe('0001');
    expect(files[0].checksum).toBe(computeChecksum('SELECT 1;'));
  });

  test('ignores non-sql files', () => {
    fs.writeFileSync(path.join(tmpDir, 'notes.txt'), 'ignore me', 'utf8');
    expect(discoverMigrations(tmpDir)).toEqual([]);
  });

  test('rejects invalid migration filenames', () => {
    writeMigration(tmpDir, 'init.sql', 'SELECT 1;');
    expect(() => discoverMigrations(tmpDir)).toThrow(/Invalid migration filename/);
  });

  test('rejects duplicate migration versions', () => {
    writeMigration(tmpDir, '0001_a.sql', 'SELECT 1;');
    writeMigration(tmpDir, '0001_b.sql', 'SELECT 2;');
    expect(() => discoverMigrations(tmpDir)).toThrow(/Duplicate migration version 0001/);
  });

  test('ignores directories, including those whose names end in .sql', () => {
    fs.mkdirSync(path.join(tmpDir, '0001_dir.sql'));
    fs.mkdirSync(path.join(tmpDir, 'nested'));
    writeMigration(tmpDir, '0002_real.sql', 'SELECT 2;');

    const files = discoverMigrations(tmpDir);

    expect(files.map((file) => file.filename)).toEqual(['0002_real.sql']);
  });
});

describe('buildPlan', () => {
  test('marks everything pending when nothing has been applied', () => {
    writeMigration(tmpDir, '0001_first.sql', 'SELECT 1;');
    const files = discoverMigrations(tmpDir);

    const plan = buildPlan(files, []);

    expect(plan.pending).toHaveLength(1);
    expect(plan.alreadyApplied).toHaveLength(0);
  });

  test('skips applied migrations whose checksum matches', () => {
    writeMigration(tmpDir, '0001_first.sql', 'SELECT 1;');
    const files = discoverMigrations(tmpDir);
    const applied: AppliedMigrationRow[] = [
      { version: '0001', name: 'first', checksum: computeChecksum('SELECT 1;') },
    ];

    const plan = buildPlan(files, applied);

    expect(plan.pending).toHaveLength(0);
    expect(plan.alreadyApplied.map((file) => file.filename)).toEqual(['0001_first.sql']);
  });

  test('throws on checksum drift for an applied migration', () => {
    writeMigration(tmpDir, '0001_first.sql', 'SELECT 1;');
    const files = discoverMigrations(tmpDir);
    const applied: AppliedMigrationRow[] = [
      { version: '0001', name: 'first', checksum: '0'.repeat(64) },
    ];

    expect(() => buildPlan(files, applied)).toThrow(/immutable/);
  });

  test('throws when an applied migration has no matching file', () => {
    writeMigration(tmpDir, '0001_first.sql', 'SELECT 1;');
    const files = discoverMigrations(tmpDir);
    const applied: AppliedMigrationRow[] = [
      { version: '0002', name: 'ghost', checksum: '0'.repeat(64) },
    ];

    expect(() => buildPlan(files, applied)).toThrow(/no matching migration file/);
  });
});

describe('runUp', () => {
  test('applies pending migrations in order and records each in the tracking table', async () => {
    writeMigration(tmpDir, '0001_first.sql', 'SELECT 1;');
    writeMigration(tmpDir, '0002_second.sql', 'SELECT 2;');
    const { txClient } = setupClients();

    const result = await runUp(tmpDir);

    expect(result.applied.map((file) => file.filename)).toEqual([
      '0001_first.sql',
      '0002_second.sql',
    ]);
    const inserts = applyTrackingInserts(txClient);
    expect(inserts.map((call) => (call.params as unknown[])[0])).toEqual(['0001', '0002']);
  });

  test('skips already applied migrations and applies only the pending ones', async () => {
    writeMigration(tmpDir, '0001_first.sql', 'SELECT 1;');
    writeMigration(tmpDir, '0002_second.sql', 'SELECT 2;');
    const { txClient } = setupClients({
      applied: [
        { version: '0001', name: 'first', checksum: computeChecksum('SELECT 1;') },
      ],
    });

    const result = await runUp(tmpDir);

    expect(result.skipped.map((file) => file.filename)).toEqual(['0001_first.sql']);
    expect(result.applied.map((file) => file.filename)).toEqual(['0002_second.sql']);
    const inserts = applyTrackingInserts(txClient);
    expect(inserts).toHaveLength(1);
    expect((inserts[0].params as unknown[])[0]).toBe('0002');
  });

  test('does not mark a failed migration as applied and stops the run', async () => {
    writeMigration(tmpDir, '0001_bad.sql', 'SELECT broken;');
    writeMigration(tmpDir, '0002_next.sql', 'SELECT 2;');
    const { txClient } = setupClients({ failSql: 'SELECT broken;' });

    await expect(runUp(tmpDir)).rejects.toThrow('SQL error');

    expect(applyTrackingInserts(txClient)).toHaveLength(0);
    expect(mockWithTransaction).toHaveBeenCalledTimes(1);
  });

  test('acquires and releases the advisory lock even when a migration fails', async () => {
    writeMigration(tmpDir, '0001_bad.sql', 'SELECT broken;');
    const { lockClient } = setupClients({ failSql: 'SELECT broken;' });

    await expect(runUp(tmpDir)).rejects.toThrow('SQL error');

    expect(lockClient.calls.some((call) => /pg_try_advisory_lock/.test(call.sql))).toBe(true);
    expect(lockClient.calls.some((call) => /pg_advisory_unlock/.test(call.sql))).toBe(true);
  });

  test('fails loudly when the advisory lock cannot be acquired before the timeout', async () => {
    writeMigration(tmpDir, '0001_first.sql', 'SELECT 1;');
    setupClients({ lockAcquired: false });

    await expect(
      runUp(tmpDir, { statementTimeoutMs: 1000, lockTimeoutMs: 1 })
    ).rejects.toThrow(/Timed out after 1ms waiting for the migration advisory lock/);
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  test('preserves a thrown undefined from the operation and still releases the lock', async () => {
    writeMigration(tmpDir, '0001_first.sql', 'SELECT 1;');
    const lockClient = createClient((sql) => {
      if (/pg_try_advisory_lock/i.test(sql)) {
        return { rows: [{ locked: true }] };
      }
      if (/CREATE TABLE/i.test(sql)) {
        throw undefined;
      }
      return { rows: [] };
    });
    mockWithClient.mockImplementation((fn: (client: MockClient) => Promise<unknown>) =>
      fn(lockClient)
    );

    let caught: unknown = 'not-thrown';
    try {
      await runUp(tmpDir);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeUndefined();
    expect(lockClient.calls.some((call) => /pg_advisory_unlock/.test(call.sql))).toBe(true);
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  test('rejects drift before applying anything', async () => {
    writeMigration(tmpDir, '0001_first.sql', 'SELECT 1;');
    const { txClient } = setupClients({
      applied: [{ version: '0001', name: 'first', checksum: '0'.repeat(64) }],
    });

    await expect(runUp(tmpDir)).rejects.toThrow(/immutable/);
    expect(applyTrackingInserts(txClient)).toHaveLength(0);
  });
});

describe('runStatus', () => {
  test('reports all migrations pending without creating the tracking table', async () => {
    writeMigration(tmpDir, '0001_first.sql', 'SELECT 1;');
    const { lockClient } = setupClients({ present: false });

    const status = await runStatus(tmpDir);

    expect(status.alreadyApplied).toHaveLength(0);
    expect(status.pending.map((file) => file.filename)).toEqual(['0001_first.sql']);
    expect(lockClient.calls.some((call) => /CREATE TABLE/i.test(call.sql))).toBe(false);
  });

  test('reports applied and pending migrations when the table exists', async () => {
    writeMigration(tmpDir, '0001_first.sql', 'SELECT 1;');
    writeMigration(tmpDir, '0002_second.sql', 'SELECT 2;');
    setupClients({
      present: true,
      applied: [
        { version: '0001', name: 'first', checksum: computeChecksum('SELECT 1;') },
      ],
    });

    const status = await runStatus(tmpDir);

    expect(status.alreadyApplied.map((file) => file.filename)).toEqual(['0001_first.sql']);
    expect(status.pending.map((file) => file.filename)).toEqual(['0002_second.sql']);
  });

  test('does not acquire the migration advisory lock, so it reports during an active migration', async () => {
    writeMigration(tmpDir, '0001_first.sql', 'SELECT 1;');
    const { lockClient } = setupClients({ present: true, lockAcquired: false });

    const status = await runStatus(tmpDir);

    expect(status.pending.map((file) => file.filename)).toEqual(['0001_first.sql']);
    expect(lockClient.calls.some((call) => /advisory_lock/.test(call.sql))).toBe(false);
  });
});

describe('main', () => {
  test('returns 2 for an unknown command without touching the database', async () => {
    const code = await main(['bogus']);
    expect(code).toBe(2);
    expect(mockInitDatabase).not.toHaveBeenCalled();
  });

  test('returns 1 when DATABASE_URL is not configured', async () => {
    mockInitDatabase.mockReturnValue({ configured: false });
    const code = await main(['up']);
    expect(code).toBe(1);
  });

  test('returns 1 when the database configuration is invalid', async () => {
    mockInitDatabase.mockImplementation(() => {
      throw new Error('bad config');
    });
    const code = await main(['up']);
    expect(code).toBe(1);
  });

  test('returns 0 and closes the database for a successful status run', async () => {
    writeMigration(tmpDir, '0001_first.sql', 'SELECT 1;');
    mockInitDatabase.mockReturnValue({ configured: true });
    setupClients({ present: false });
    const previous = process.env.MIGRATIONS_DIR;
    process.env.MIGRATIONS_DIR = tmpDir;
    try {
      const code = await main(['status']);
      expect(code).toBe(0);
    } finally {
      if (previous === undefined) {
        delete process.env.MIGRATIONS_DIR;
      } else {
        process.env.MIGRATIONS_DIR = previous;
      }
    }
    expect(mockCloseDatabase).toHaveBeenCalled();
  });
});
