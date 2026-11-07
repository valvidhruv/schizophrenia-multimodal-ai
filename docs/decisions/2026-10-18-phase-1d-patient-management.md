# Phase 1D: Database-Backed Patient Management (Create, Get, Paginated List)

- **Date**: 2026-10-18
- **Status**: Accepted
- **Scope**: `backend/src/services/patientService.ts`, `backend/src/routes/patients.ts`,
  `backend/src/routes/index.ts`, `backend/src/app.ts`, `backend/src/main.ts`,
  `backend/src/errors.ts`, `backend/src/middleware/asyncHandler.ts`,
  `backend/src/schemas/patient.ts`, `backend/src/testing/disposableDatabaseUrl.ts`,
  patient/ integration and unit tests, `backend/src/requestLogging.test.ts`

## Context

Phase 1D replaces the `501 NOT_IMPLEMENTED` stubs for three scoped endpoints with real
persistence against the Phase 1B raw-SQL schema: `POST /api/patients`,
`GET /api/patients/:id`, and `GET /api/patients` (paginated, filtered, searchable).
No schema changes, no migrations, no new dependencies. `PUT`/`DELETE /api/patients/:id`
remain 501 stubs (one phase at a time). All responses are derived from stored rows or
explicit request input - no invented patients, empty placeholder relations, or metrics.

## Decision: optional patient store with 501 fallback

The store is injected (`CreateAppOptions.patientStore` -> `ApiRouterOptions` ->
`createPatientsRouter(patientStore?)`). When no store is configured the routes keep
their exact Phase 1C behavior (validation and role gates still run, then 501), which is
also the correct behavior for a backend started without database configuration. This
preserves `scaffold.test.ts` and `authorization.test.ts` untouched.

## Decision: database configuration is checked without connecting

`main.ts` injects `createSqlPatientStore()` only when `initDatabase()` reports
`configured: true`. That path validates `DATABASE_URL` and constructs a lazy `pg`
Pool; it does not open a connection. `createSqlPatientStore()` itself performs no I/O,
and the first query connects lazily. Integration-suite gating is purely string-based
(`disposableDatabaseUrl()`), so a skipped suite never touches PostgreSQL. The existing
Phase 1B startup `SELECT 1` probe is unchanged and unrelated to this wiring.

## Decision: created_by is NULL until user provisioning exists

`patients.created_by` is a foreign key to `users(id)`, but no login or user-provisioning
endpoint exists yet (Phase 1C limitation), so any non-NULL value would violate the FK
and fail every insert. Inserts therefore pass an explicit `created_by = NULL`; actor
accountability for creations is carried by the audit record (`actorUserId`, `actorRole`,
timestamp, path, status). When users can be provisioned, this column should be populated
with a verified existing user id (FK-safe lookup), which requires its own change record.

## Decision: status codes and error mapping

- `201` on create, `200` on get/list, `404` (`Patient not found.`) for an unknown
  id, `409 CONFLICT` for duplicate `subjectId` (per `API_DESIGN.md`).
- The `409` mapping fires only for PostgreSQL `23505` **on `patients_subject_id_key`**.
  Any other constraint violation, or any other database error, becomes a generic
  `500 INTERNAL_ERROR`; driver error objects never reach the response.
- `ApiError.conflict()` was added as a static sibling of the existing helpers.

## Decision: query parsing without mutating Express internals

`validate` deliberately does not write parsed query/params back, and Express 4 exposes
`req.query` as a read-only getter. After middleware validation succeeds, the list
handler re-runs `listPatientsQuerySchema.parse(req.query)` to obtain typed, defaulted
values (`page=1`, `limit=20`, hard max `100`). Role gates stay first in the middleware
chain, so authorization precedes validation and store access.

## Decision: safe pagination offsets

`page` and `limit` keep their Phase 1C defaults and bounds (`page >= 1`,
`1 <= limit <= 100`). After defaults are applied, `listPatientsQuerySchema` rejects any
request whose offset `(page - 1) * limit` is not a safe JavaScript integer. The rejection
flows through the normal validation middleware as `400 VALIDATION_ERROR` with
`query.page`, before the store is called, instead of reaching PostgreSQL with an
overflowed `OFFSET` or producing an inconsistent `500`. With the default limit of 20,
the largest valid page is `450359962737050`; `450359962737051` is rejected. Boundary
tests cover both values.

## Decision: parameterized SQL only

Values are always `$n` parameters; `WHERE` fragments are fixed literals assembled from
a fixed list. Searches use `subject_id ILIKE $n ESCAPE '\'` with `%`, `_`, and `\`
escaped in the term (patients have no name column, so `subjectId` is the only searchable
identifier); an empty search string is treated as no filter. `diagnosis` is an exact
match. Rows are ordered `created_at DESC, id DESC` with `LIMIT`/`OFFSET` computed from
the validated page. Unit tests assert the escaped parameter values and that no input
value ever appears in SQL text.

## Decision: separate count and page queries (consistency limitations)

`total`/`totalPages` come from a `COUNT(*)` statement followed by a separate page
statement, without a transaction or shared snapshot. Consequences, accepted for this
prototype:

1. Rows inserted or deleted between the two statements can make `total` differ
   slightly from the rows the page query returns.
2. `total` is also a point-in-time value that can go stale between requests, so two
   consecutive identical requests may report different totals under concurrent writes.
3. When `count = 0` the page query is skipped (data is provably empty); when the
   requested page is beyond the last page, `data` is `[]` while `total` still reflects
   the count query.
4. A single-statement `COUNT(*) OVER ()` alternative was rejected because with zero
   matching rows it cannot report `total` at all, and a snapshot transaction would hold
   a pool client for two reads. Neither is justified before real load requirements exist.

## Decision: log-safe database failures and sanitized access logs

- Non-conflict database errors are rethrown as
  `Patient store operation failed: ${sanitizeDatabaseError(err)}`. This drops the
  driver's enumerable properties (`detail`, `schema`, `table`, `constraint` can embed
  row values such as subject ids) and redacts connection strings, credentials, and
  hosts before the process-level logger ever sees the error. Error responses remain the
  fixed `Internal server error` payload. The original error object is not attached as
  `cause` because Node would print it with all raw properties.
- `409`/`404` messages are fixed strings and never echo identifiers.
- The access log now uses a custom morgan token: query strings are removed and UUID
  path segments are replaced with `:id` (`:method :sanitizedurl :status ...`,
  otherwise identical to the previous `dev` format). Audit records still contain the
  opaque resource UUID per AGENTS.md rule 14, but never bodies, query strings, or
  tokens; no code path logs `subjectId`.

## Decision: integration tests are gated and clean up safely

- The disposable-database gate was extracted verbatim from
  `migrate.integration.test.ts` into `src/testing/disposableDatabaseUrl.ts` so both
  suites share one safety check (explicit `TEST_DATABASE_URL`, never equal to
  `DATABASE_URL`, database name must end in `_test`/`_ci`).
- The suite runs **no migrations**: it verifies `to_regclass('public.patients')` and
  fails with an actionable message otherwise. The schema from `backend/migrations`
  must already be applied to `TEST_DATABASE_URL` before the suite runs, for example in
  an explicit CI setup step.
- Jest runs test files in parallel by default. On a fresh disposable database, run the
  migration and patient suites serially (`jest --runInBand`) or apply migrations in
  setup before either suite starts; otherwise the patient suite can check
  `to_regclass('public.patients')` before `migrate.integration.test.ts` has created it.
- Wildcard search assertions use the full `ph1d_it_...` subject id as the search term,
  so only suite-owned rows can match and unrelated rows in the disposable database
  cannot affect those assertions.
- Cleanup is deterministic: every subject id the suite may create is declared up
  front. `beforeAll` deletes any leftovers from a previous crashed run before tests
  start, and `afterAll` deletes the full known inventory even when individual tests
  failed part-way (`afterAll` always runs), guarded so the pool is closed in a
  `finally` block. Nothing outside the declared inventory is ever deleted.

## Tests added

- `patientService.test.ts`: placeholder-only SQL proof (hostile input), row mapping,
  `23505` -> 409 only for `patients_subject_id_key`, other errors wrapped log-safe
  with driver properties dropped, search escaping (`%`, `_`, `\`) exact-parameter
  assertions, filter/pagination SQL shape, limit/offset/totalPages math, zero-count
  and beyond-last-page behavior.
- `routes/patients.test.ts`: 201 shape + disclaimer, 409/404/500 mappings with no
  identifier leakage, validation and role gates blocking before store access, coerced
  query values reaching the store, safe/unsafe pagination-offset boundaries, audit
  record without query string, `PUT`/`DELETE` still 501 with a store configured.
- `patients.integration.test.ts` (gated, skipped without `TEST_DATABASE_URL`):
  create/read roundtrip, real-database duplicate -> 409, 404, pagination + diagnosis
  filter totals, and literal `%`/`_`/`\` wildcard searches scoped to the suite's
  `ph1d_it_...` subject ids against decoy rows.
- `requestLogging.test.ts`: access lines contain the sanitized path only.
- `asyncHandler.test.ts`: rejection/synchronous-throw forwarding.

## Known limitations / not in scope

1. `PUT` and `DELETE /api/patients/:id` remain 501 stubs; there is no soft-delete.
2. `updated_at` has no trigger in the schema, so it equals `created_at` until update
   logic lands.
3. Count/page consistency caveats above; no retry or snapshot semantics.
4. The integration suite was **not executed** locally (no `TEST_DATABASE_URL`); its
   constraints are proven by unit tests. Enabling it requires the schema to be applied
   to `TEST_DATABASE_URL` first and either serial execution or an explicit migration
   step in CI (see above); nothing applies migrations automatically.
5. `created_by` stays NULL (above); the `users` table is empty.
6. Detail responses omit `files` / `latestAssessment` / `latestAnalysis` shown in
   `API_DESIGN.md` - those belong to later phases and are not fabricated as empty.
7. No rate-limit or auth flow changes; no `.env` changes; nothing committed.

## Not changed

- `backend/migrations/`, `backend/src/migrate.ts`, `db.ts` query semantics,
  non-patient schemas, auth/validate/rate-limit/audit middleware behavior, health
  endpoints, frontend, AI service, `.env.example`.
- Existing migration integration assertions; the only change there is the shared
  `disposableDatabaseUrl` helper import.
