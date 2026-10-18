# Phase 1C: Backend API Scaffold (Validation, Auth, Rate Limiting, Audit Foundations)

- **Date**: 2026-10-18
- **Status**: Accepted
- **Scope**: `backend/src/app.ts`, `backend/src/main.ts`, `backend/src/config/`,
  `backend/src/errors.ts`, `backend/src/middleware/`, `backend/src/routes/`,
  `backend/src/schemas/`, `backend/src/services/{tokenService,auditService}.ts`,
  `backend/src/types/`, `backend/src/constants.ts`

## Context

Phase 1C adds the minimal backend scaffold behind the existing health endpoints:
validated environment configuration, Zod request validation, unified error
handling, role-based authorization plumbing, rate limiting, and audit
foundations. All domain routes (`/api/patients`, `/api/files`, `/api/analysis`,
`/api/reports`, PANSS, uploads) are registered with their contract and
validation, and every write route carries a role gate per
`2026-10-18-role-permission-matrix.md` (reads require any authenticated role;
new gates on upload, file validation, analysis job create/cancel, and report
generation were added by the 2026-10-18 security review fixes). All of them
return `501 NOT_IMPLEMENTED`. No response invents patient data, predictions,
or metrics.

The PostgreSQL layer (`db.ts`), the raw-SQL migration runner (`migrate.ts`,
`backend/migrations/`), all four health endpoints, the `DISCLAIMER` constant,
the frontend, and the AI service are unchanged.

## Decision: no new dependencies

- **HS256 tokens via `node:crypto`** instead of `jsonwebtoken`/`bcrypt`. The
  token service pins the `alg`/`typ` header (rejecting `alg: none`), verifies
  signatures with `crypto.timingSafeEqual` after a length check, enforces a
  30-second future-skew bound, a role allowlist, and `exp`/`iat` claim types.
  No password hashing exists yet because there is no login endpoint; adding
  `bcrypt` now would be an unused dependency.
- **In-house fixed-window rate limiter** instead of `express-rate-limit`. It
  supports per-key windows, configurable `windowMs`/`max`, injectable clock,
  `X-RateLimit-*`/`Retry-After` headers, and bounds memory at 10 000 tracked
  keys with expired-entry pruning.

## Decision: unified error contract

Every error response follows `API_DESIGN.md`:

```json
{ "error": { "code": "...", "message": "...", "details": [...] },
  "timestamp": "...", "disclaimer": "Research prototype - ..." }
```

Codes: `VALIDATION_ERROR` (400, with `field` details prefixed `params.`/`query.`),
`UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `RATE_LIMITED` (429),
`PAYLOAD_TOO_LARGE` (413), `AUTH_NOT_CONFIGURED` (501), `NOT_IMPLEMENTED` (501),
`INTERNAL_ERROR` (500). Malformed JSON bodies map to 400; unexpected errors log
once as `INTERNAL_ERROR` only (deliberate 501s do not dump stacks).

## Decision: fail-closed authentication

With `JWT_SECRET` unset, `authenticate` returns `501 AUTH_NOT_CONFIGURED`
before any route handler - the API never falls back to accepting unauthenticated
access. Production config additionally requires a 32+ character non-placeholder
secret. Config parsing treats blank values as unset, names only the offending
variable, and never echoes secret values in error messages.

## Decision: injectable audit recorder (not persisted yet)

Audit records (timestamp, method, path without query string, status, actor
id/role, IP, truncated user-agent) are emitted through an injectable
`AuditRecorder`; the default writes one JSON line to the console. Bodies, query
strings, and tokens are never recorded. Recorder failures (synchronous throws
or rejected promises) are logged to stderr and never crash the process or the
request. Nothing is written to the database
because no new tables are permitted in this phase; a persistent, immutable
audit table is deferred to a later phase with its own decision record.

## Decision: layered rate limits

Global limit from config (default 100 requests / 15 min per IP) applied inside
the `/api` router, plus route-level limits: uploads 5/min, analysis job
creation/cancellation 20/min, report generation 10/min.

## Known limitations / security issues

1. **No login or password storage.** Tokens are only minted inside tests.
   User provisioning, credential storage, refresh tokens (`JWT_REFRESH_SECRET`
   in `.env.example` is unused), and token revocation are not implemented.
2. **Rate limiting is in-process and fixed-window.** Not shared across multiple
   server instances (no Redis-backed limiter); a fixed window permits a burst
   across the window boundary.
3. **Audit is not tamper-evident.** Console/injected recorder only; process
   restarts lose records. Database persistence requires a future migration.
4. **CORS is an allowlist** (`BACKEND_CORS_ORIGIN`, default
   `http://localhost:5173`); TLS termination and request size policy are
   expected from the reverse proxy in production. Bearer-header auth means no
   cookie CSRF surface, but no CSRF defense is implemented either.
5. **501 stubs** intentionally return no domain data; endpoint behavior beyond
   status codes is unspecified until its implementation phase.

## Not changed

- `backend/src/db.ts`, `backend/src/migrate.ts`, `backend/migrations/` (Phase 1B).
- Health endpoints (`/health`, `/api/health`, `/health/db`, `/api/health/db`)
  and their exact response fields, including `DISCLAIMER`.
- `.env.example` (documents `BACKEND_PORT`, `BACKEND_CORS_ORIGIN`,
  `BACKEND_RATE_LIMIT_*`, `JWT_ACCESS_EXPIRY`, `JWT_SECRET`; the 2026-10-18
  security review fixes added the `TRUST_PROXY` block - see
  `2026-10-18-trust-proxy-client-ip.md`).
- Frontend and AI service; no schema migrations; no fabricated metrics or data.
