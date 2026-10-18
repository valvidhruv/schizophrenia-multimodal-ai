import { Pool } from 'pg';
import type { PoolClient } from 'pg';

export type DatabaseFailureReason = 'not_configured' | 'connection_failed';

export interface DatabaseHealthResult {
  ok: boolean;
  latencyMs?: number;
  reason?: DatabaseFailureReason;
}

const CONNECTION_TIMEOUT_MS = 5000;
const IDLE_TIMEOUT_MS = 30000;
const STATEMENT_TIMEOUT_MS = 10000;
const MAX_POOL_SIZE = 10;

let pool: Pool | null = null;
let activeConnectionString: string | null = null;

const POSTGRES_URL_PATTERN = /^postgres(ql)?:\/\/\S+$/i;

/**
 * Validates DATABASE_URL from the environment.
 * Returns null when not configured; throws when set but malformed.
 * The URL value itself is never included in any error message.
 */
export function loadDatabaseConfig(env: NodeJS.ProcessEnv = process.env): string | null {
  const url = (env.DATABASE_URL ?? '').trim();
  if (url === '') {
    return null;
  }
  if (!POSTGRES_URL_PATTERN.test(url)) {
    throw new Error('DATABASE_URL is set but is not a valid postgresql:// connection URL');
  }
  return url;
}

/**
 * Startup validation: validates configuration and creates the connection pool.
 * Throws on malformed configuration (caller decides how to fail).
 * Returns { configured: false } when DATABASE_URL is absent.
 */
export function initDatabase(env: NodeJS.ProcessEnv = process.env): { configured: boolean } {
  const url = loadDatabaseConfig(env);
  if (url === null) {
    pool = null;
    activeConnectionString = null;
    return { configured: false };
  }
  pool = new Pool({
    connectionString: url,
    max: MAX_POOL_SIZE,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
  });
  activeConnectionString = url;
  return { configured: true };
}

export function isDatabaseConfigured(): boolean {
  return pool !== null;
}

/**
 * Executes SELECT 1 and measures round-trip latency.
 * Never exposes error details, hostnames, users, or credentials in the result.
 */
export async function checkDatabase(): Promise<DatabaseHealthResult> {
  const activePool = pool;
  if (!activePool) {
    return { ok: false, reason: 'not_configured' };
  }
  const start = Date.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      activePool.query('SELECT 1'),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`database check timed out after ${CONNECTION_TIMEOUT_MS}ms`)),
          CONNECTION_TIMEOUT_MS
        );
      }),
    ]);
    return { ok: true, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, reason: 'connection_failed' };
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/** Reusable query helper for future phases. Throws if the pool is not initialized. */
export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const activePool = pool;
  if (!activePool) {
    throw new Error('Database is not initialized');
  }
  const result = await activePool.query(text, params);
  return result.rows as T[];
}

/**
 * Checks out a single client from the pool and guarantees release when the
 * callback settles. Use when several statements must run on the same session
 * (e.g. holding a session-level advisory lock). Throws if not initialized.
 *
 * When `destroyOnError` is set and the callback throws, the checked-out
 * connection is destroyed rather than returned to the pool. This matters for
 * session-scoped advisory locks: destroying the session guarantees PostgreSQL
 * releases the lock even if an explicit unlock failed.
 */
export async function withClient<T>(
  fn: (client: PoolClient) => Promise<T>,
  options: { destroyOnError?: boolean } = {}
): Promise<T> {
  const activePool = pool;
  if (!activePool) {
    throw new Error('Database is not initialized');
  }
  const client = await activePool.connect();
  try {
    const result = await fn(client);
    client.release();
    return result;
  } catch (err) {
    if (options.destroyOnError) {
      client.release(err instanceof Error ? err : new Error('withClient callback failed'));
    } else {
      client.release();
    }
    throw err;
  }
}

/**
 * Runs the callback inside a single transaction on one checked-out client.
 * Commits on success; on failure it attempts ROLLBACK and then rethrows the
 * original error. A ROLLBACK failure is reported as a secondary diagnostic and
 * never replaces the primary error. The client is always released, but when a
 * ROLLBACK failure leaves the session in an unknown transaction state the
 * connection is destroyed (released with an Error) so it can never be reused
 * from the pool.
 *
 * When `statementTimeoutMs` is provided it is applied to this transaction only
 * via `SET LOCAL statement_timeout`, leaving the pool-wide timeout untouched.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  options: { statementTimeoutMs?: number } = {}
): Promise<T> {
  const activePool = pool;
  if (!activePool) {
    throw new Error('Database is not initialized');
  }
  const client = await activePool.connect();
  let destroy = false;
  try {
    await client.query('BEGIN');
    if (options.statementTimeoutMs !== undefined) {
      const timeoutMs = Math.trunc(options.statementTimeoutMs);
      await client.query(`SET LOCAL statement_timeout = ${timeoutMs}`);
    }
    try {
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        destroy = true;
        console.error(
          'Database: warning: ROLLBACK failed (secondary):',
          sanitizeDatabaseError(rollbackErr)
        );
      }
      throw err;
    }
  } finally {
    if (destroy) {
      client.release(new Error('transaction client destroyed after failed ROLLBACK'));
    } else {
      client.release();
    }
  }
}

/** Closes the pool during graceful shutdown. */
export async function closeDatabase(): Promise<void> {
  const activePool = pool;
  pool = null;
  activeConnectionString = null;
  if (activePool) {
    await activePool.end();
  }
}

/**
 * Produces a log-safe error string: redacts the configured connection string,
 * any postgresql:// credentials, and password patterns. Use only for server logs,
 * never for API responses.
 */
export function sanitizeDatabaseError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  let message = raw;
  if (activeConnectionString) {
    message = message.split(activeConnectionString).join('[redacted-connection-url]');
  }
  message = message.replace(/postgres(ql)?:\/\/[^\s'"]+@/gi, 'postgresql://[redacted]@');
  message = message.replace(/password[=:\s]+\S+/gi, 'password=[redacted]');
  message = message.replace(/\bhost[=:\s]+("[^"]*"|'[^']*'|\S+)/gi, 'host=[redacted]');
  message = message.replace(/\b(?:getaddrinfo\s+)?ENOTFOUND\s+\S+/gi, 'ENOTFOUND [redacted-host]');
  message = message.replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '[redacted-host]');
  message = message.replace(/\b[a-z][a-z0-9.-]*:\d{2,5}\b/gi, '[redacted-host]');
  const code = (err as { code?: unknown })?.code;
  return typeof code === 'string' ? `${code}: ${message}` : message;
}
