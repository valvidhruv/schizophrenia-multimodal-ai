# Phase 1B: Raw-SQL Migration Runner

- **Date**: 2026-10-18
- **Status**: Accepted
- **Scope**: `backend/src/migrate.ts`, `backend/src/db.ts`, `backend/migrations/`

## Context

Phase 1B added a minimal, dependency-free migration runner on top of the existing
`pg` pool instead of adopting Prisma Migrate. `DATABASE_SCHEMA.md` (line 319)
permits raw SQL migrations, so the runner executes the versioned
`backend/migrations/NNNN_name.sql` files directly. Applied migrations are tracked
in a `schema_migrations` table (`version`, `name`, `checksum`, `applied_at`,
`execution_ms`).

Key guarantees:

- **Immutability**: each migration file's SHA-256 checksum is recorded on apply;
  a changed or missing applied file is a hard error (`buildPlan`).
- **Atomicity**: each migration's DDL and its tracking-row insert commit in a
  single transaction, so a failed migration leaves no tracking row.
- **Single runner**: an exclusive session-level advisory lock
  (`pg_advisory_lock(hashtext('schizophrenia_ai_schema_migrations'))`) serializes
  concurrent `migrate up` runs. Acquisition polls `pg_try_advisory_lock` with a
  bounded wait (`MIGRATION_LOCK_TIMEOUT_MS`, default 60s) and releases on every
  path, destroying the connection (`destroyOnError`) if an explicit unlock fails
  so PostgreSQL always drops the session lock.
- **Bounded DDL**: each migration runs under `SET LOCAL statement_timeout`
  (`MIGRATION_STATEMENT_TIMEOUT_MS`, default 5 min) so a slow index build cannot
  block the run forever.

## Decision: `migrate:status` does not take the exclusive lock

`runStatus` takes no advisory lock. It performs only reads (`to_regclass`,
`SELECT ... FROM schema_migrations`) and never creates the tracking table.

This is safe because each migration commits its DDL and tracking row in one
transaction. Under MVCC a concurrent reader can never observe a migration whose
DDL is not yet committed; it sees each migration as either fully applied or still
pending. The lock is unnecessary for status and would only make status block (up
to the lock timeout, then fail) while a long migration runs. A lock-free status
also cannot block or interfere with `migrate up`.

## Known limitation: `IF NOT EXISTS` does not validate existing objects

Every `CREATE TABLE` / `CREATE INDEX` in `0001_initial_schema.sql` (and
`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`) is guarded by `IF NOT EXISTS`.
That guard makes re-runs idempotent, but it **does not validate** an object that
already exists under the same name. If a table or index with the same name but
different columns, types, constraints, or expressions was created out of band,
the migration silently succeeds while the database diverges from
`DATABASE_SCHEMA.md`.

Do **not** attempt automatic repair. Dropping or recreating objects automatically
risks destroying real data and is unsafe on a live database.

### Recommended future work (read-only drift check)

Add a read-only verification step (new phase, separate from `up`) that:

1. Introspects expected schema from `information_schema` / `pg_catalog`
   (columns, types, nullability, defaults, primary keys, foreign keys, unique
   constraints, indexes).
2. Compares against the definitions in `DATABASE_SCHEMA.md` / the migration files.
3. Reports any divergence and exits non-zero so CI and deployment fail loudly.
4. Never mutates the database; remediation is always a reviewed, forward
   migration.

## Not changed

- **F9** (`hashtext()` is 32-bit, so advisory-lock keys have a negligible
  collision probability) is left as-is; the collision risk is acceptable.
- The documented schema in `DATABASE_SCHEMA.md` and the existing
  `0001_initial_schema.sql` are unchanged.
