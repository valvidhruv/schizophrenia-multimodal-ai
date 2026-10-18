import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { PoolClient } from 'pg';
import {
  initDatabase,
  closeDatabase,
  withClient,
  withTransaction,
  sanitizeDatabaseError,
} from './db';

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const ADVISORY_LOCK_NAME = 'schizophrenia_ai_schema_migrations';
const FILENAME_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;

const DEFAULT_MIGRATION_STATEMENT_TIMEOUT_MS = 300000;
const DEFAULT_MIGRATION_LOCK_TIMEOUT_MS = 60000;
const MIGRATION_LOCK_POLL_MS = 250;

export interface MigrationTimeouts {
  statementTimeoutMs: number;
  lockTimeoutMs: number;
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const trimmed = (value ?? '').trim();
  if (trimmed === '') {
    return fallback;
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

/**
 * Resolves migration timeouts from the environment. A single migration is given
 * a generous statement timeout (default 5 min) so long index builds do not fail,
 * and waiting for the advisory lock is bounded (default 1 min) so a stuck
 * concurrent runner fails loudly instead of hanging forever.
 */
export function resolveMigrationTimeouts(
  env: NodeJS.ProcessEnv = process.env
): MigrationTimeouts {
  return {
    statementTimeoutMs: readPositiveInt(
      env.MIGRATION_STATEMENT_TIMEOUT_MS,
      DEFAULT_MIGRATION_STATEMENT_TIMEOUT_MS
    ),
    lockTimeoutMs: readPositiveInt(
      env.MIGRATION_LOCK_TIMEOUT_MS,
      DEFAULT_MIGRATION_LOCK_TIMEOUT_MS
    ),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface MigrationFile {
  version: string;
  name: string;
  filename: string;
  fullPath: string;
  checksum: string;
  sql: string;
}

export interface AppliedMigrationRow {
  version: string;
  name: string;
  checksum: string;
}

export interface MigrationPlan {
  alreadyApplied: MigrationFile[];
  pending: MigrationFile[];
}

export interface MigrationRunResult {
  applied: MigrationFile[];
  skipped: MigrationFile[];
}

export function computeChecksum(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

export function parseMigrationFilename(
  filename: string
): { version: string; name: string } | null {
  const match = FILENAME_PATTERN.exec(filename);
  if (!match) {
    return null;
  }
  return { version: match[1], name: match[2] };
}

/** Reads migrations from disk, validates filenames, and returns them ordered by version. */
export function discoverMigrations(dir: string = MIGRATIONS_DIR): MigrationFile[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const sqlFiles = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();
  const seen = new Map<string, string>();
  const migrations: MigrationFile[] = [];
  for (const filename of sqlFiles) {
    const parsed = parseMigrationFilename(filename);
    if (!parsed) {
      throw new Error(
        `Invalid migration filename "${filename}"; expected NNNN_name.sql (lowercase letters, digits, underscores)`
      );
    }
    const previous = seen.get(parsed.version);
    if (previous) {
      throw new Error(
        `Duplicate migration version ${parsed.version}: "${previous}" and "${filename}"`
      );
    }
    seen.set(parsed.version, filename);
    const fullPath = path.join(dir, filename);
    const sql = fs.readFileSync(fullPath, 'utf8');
    migrations.push({
      version: parsed.version,
      name: parsed.name,
      filename,
      fullPath,
      checksum: computeChecksum(sql),
      sql,
    });
  }
  migrations.sort((a, b) => a.version.localeCompare(b.version));
  return migrations;
}

/**
 * Determines what to apply. Fails loudly on drift: an applied migration whose
 * file is missing or whose checksum changed is treated as a hard error, since
 * applied migration files are immutable.
 */
export function buildPlan(files: MigrationFile[], applied: AppliedMigrationRow[]): MigrationPlan {
  const appliedByVersion = new Map(applied.map((row) => [row.version, row]));
  const fileVersions = new Set(files.map((file) => file.version));

  for (const row of applied) {
    if (!fileVersions.has(row.version)) {
      throw new Error(
        `Applied migration ${row.version} (${row.name}) has no matching migration file; ` +
          'applied migrations are immutable and must not be removed'
      );
    }
  }

  const alreadyApplied: MigrationFile[] = [];
  const pending: MigrationFile[] = [];
  for (const file of files) {
    const row = appliedByVersion.get(file.version);
    if (!row) {
      pending.push(file);
      continue;
    }
    if (row.checksum !== file.checksum) {
      throw new Error(
        `Checksum mismatch for applied migration ${file.version} (${file.filename}); ` +
          'applied migration files are immutable'
      );
    }
    alreadyApplied.push(file);
  }
  return { alreadyApplied, pending };
}

async function migrationsTableExists(client: PoolClient): Promise<boolean> {
  const result = await client.query<{ present: boolean }>(
    "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS present"
  );
  return result.rows[0]?.present === true;
}

export async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      name TEXT NOT NULL,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      execution_ms INTEGER NOT NULL
    )`
  );
}

async function readApplied(client: PoolClient): Promise<AppliedMigrationRow[]> {
  const result = await client.query<AppliedMigrationRow>(
    'SELECT version, name, checksum FROM schema_migrations ORDER BY version'
  );
  return result.rows;
}

/**
 * Applies one migration and records it in a single transaction. If the SQL or
 * the tracking insert fails, the transaction rolls back and the error
 * propagates; no tracking row is written for a failed migration. The SQL text
 * is taken from the already-discovered migration (single read, consistent with
 * the checksum) and runs under a per-migration statement timeout so a slow
 * build cannot block the run indefinitely.
 */
export async function applyMigration(
  migration: MigrationFile,
  statementTimeoutMs: number
): Promise<number> {
  return withTransaction(
    async (client) => {
      const start = Date.now();
      await client.query(migration.sql);
      const executionMs = Date.now() - start;
      await client.query(
        'INSERT INTO schema_migrations (version, name, checksum, execution_ms) VALUES ($1, $2, $3, $4)',
        [migration.version, migration.name, migration.checksum, executionMs]
      );
      return executionMs;
    },
    { statementTimeoutMs }
  );
}

/**
 * Acquires a session-level advisory lock by polling. Waiting is bounded so a
 * stuck concurrent runner fails with a clear message instead of blocking
 * forever. If the lock is already held by this session this is a no-op refetch
 * that immediately succeeds.
 */
async function acquireAdvisoryLock(client: PoolClient, lockTimeoutMs: number): Promise<void> {
  const deadline = Date.now() + lockTimeoutMs;
  for (;;) {
    const result = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
      [ADVISORY_LOCK_NAME]
    );
    if (result.rows[0]?.locked === true) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out after ${lockTimeoutMs}ms waiting for the migration advisory lock; ` +
          'another migration may already be running'
      );
    }
    await delay(MIGRATION_LOCK_POLL_MS);
  }
}

/** Best-effort advisory unlock; returns the failure instead of throwing. */
async function tryReleaseAdvisoryLock(client: PoolClient): Promise<Error | null> {
  try {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [ADVISORY_LOCK_NAME]);
    return null;
  } catch (err) {
    return err instanceof Error ? err : new Error('advisory unlock failed');
  }
}

/**
 * Acquires a session-level advisory lock on a single checked-out client and
 * holds it for the whole callback, so concurrent runners cannot interleave.
 *
 * The lock is released before the client returns to the pool. The primary
 * callback error is always preserved; a failure to release the lock is reported
 * as a secondary diagnostic (and thrown only when there is no primary error).
 * With `destroyOnError` the underlying connection is destroyed on any throw, so
 * PostgreSQL releases the session-level lock even if the explicit unlock failed.
 */
async function withMigrationLock<T>(
  fn: (client: PoolClient) => Promise<T>,
  lockTimeoutMs: number
): Promise<T> {
  return withClient(
    async (client) => {
      await acquireAdvisoryLock(client, lockTimeoutMs);
      let result: T | undefined;
      let failed = false;
      let primaryError: unknown;
      try {
        result = await fn(client);
      } catch (err) {
        failed = true;
        primaryError = err;
      }
      const unlockError = await tryReleaseAdvisoryLock(client);
      if (failed) {
        if (unlockError) {
          console.error(
            'Migrate: warning: advisory unlock failed (secondary):',
            sanitizeDatabaseError(unlockError)
          );
        }
        throw primaryError;
      }
      if (unlockError) {
        throw new Error(
          `Failed to release the migration advisory lock: ${sanitizeDatabaseError(unlockError)}`
        );
      }
      return result as T;
    },
    { destroyOnError: true }
  );
}

export async function runUp(
  dir: string = MIGRATIONS_DIR,
  timeouts: MigrationTimeouts = resolveMigrationTimeouts()
): Promise<MigrationRunResult> {
  return withMigrationLock(async (client) => {
    await ensureMigrationsTable(client);
    const files = discoverMigrations(dir);
    const applied = await readApplied(client);
    const plan = buildPlan(files, applied);

    const appliedNow: MigrationFile[] = [];
    for (const migration of plan.pending) {
      const executionMs = await applyMigration(migration, timeouts.statementTimeoutMs);
      appliedNow.push(migration);
      console.log(`Migrate: applied ${migration.filename} (${executionMs} ms)`);
    }
    return { applied: appliedNow, skipped: plan.alreadyApplied };
  }, timeouts.lockTimeoutMs);
}

/**
 * Reports which migrations are applied and which are pending.
 *
 * This deliberately does NOT take the exclusive migration advisory lock. Every
 * migration commits its DDL and its schema_migrations row in a single
 * transaction, so a reader can never observe a migration whose DDL is not yet
 * committed: it sees each migration either fully applied or still pending (via
 * MVCC). Skipping the lock means `migrate:status` neither blocks a running
 * migration nor fails with a lock timeout during one. It performs no writes and
 * never creates the tracking table, so it cannot interfere with `runUp`.
 */
export async function runStatus(
  dir: string = MIGRATIONS_DIR
): Promise<{ alreadyApplied: MigrationFile[]; pending: MigrationFile[] }> {
  return withClient(async (client) => {
    const files = discoverMigrations(dir);
    const present = await migrationsTableExists(client);
    const applied = present ? await readApplied(client) : [];
    const plan = buildPlan(files, applied);
    return { alreadyApplied: plan.alreadyApplied, pending: plan.pending };
  });
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const command = argv[0] ?? '';
  const dir = process.env.MIGRATIONS_DIR
    ? path.resolve(process.env.MIGRATIONS_DIR)
    : MIGRATIONS_DIR;

  if (command !== 'up' && command !== 'status') {
    console.error('Usage: migrate <up|status>');
    return 2;
  }

  try {
    const { configured } = initDatabase();
    if (!configured) {
      console.error('DATABASE_URL is not set; cannot run migrations');
      return 1;
    }
  } catch (err) {
    console.error('Invalid database configuration:', sanitizeDatabaseError(err));
    return 1;
  }

  try {
    if (command === 'up') {
      const result = await runUp(dir);
      console.log(
        `Migrate: done (${result.applied.length} applied, ${result.skipped.length} already applied)`
      );
    } else {
      const result = await runStatus(dir);
      console.log(`Migrate: applied (${result.alreadyApplied.length}):`);
      for (const migration of result.alreadyApplied) {
        console.log(`  ${migration.filename}`);
      }
      console.log(`Migrate: pending (${result.pending.length}):`);
      for (const migration of result.pending) {
        console.log(`  ${migration.filename}`);
      }
    }
    return 0;
  } catch (err) {
    console.error('Migration failed:', sanitizeDatabaseError(err));
    return 1;
  } finally {
    await closeDatabase();
  }
}

if (require.main === module) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
