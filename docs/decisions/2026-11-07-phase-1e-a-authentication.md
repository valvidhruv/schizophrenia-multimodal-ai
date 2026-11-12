# Phase 1E-A: Database-Backed Authentication and User Bootstrap

- **Date**: 2026-11-07
- **Status**: Accepted
- **Scope**: `backend/migrations/0002_auth_refresh_tokens.sql`,
  `backend/src/services/passwordService.ts`, `backend/src/services/authStore.ts`,
  `backend/src/services/authService.ts`, `backend/src/schemas/auth.ts`,
  `backend/src/routes/auth.ts`, `backend/src/routes/index.ts`,
  `backend/src/middleware/auth.ts`, `backend/src/scripts/createAdmin.ts`,
  `backend/src/config/index.ts`, `backend/src/errors.ts`, `backend/src/app.ts`,
  `backend/src/main.ts`, auth unit/route/integration tests

## Context

Phase 1C authenticated requests with a stateless HS256 bearer token only: the token
signature and expiry were checked, but the user id and role in the token were never
checked against PostgreSQL. No login, refresh, logout, profile, password, or user
provisioning endpoint existed, and `users` was empty. Phase 1E-A adds the minimum real
identity layer needed before patient ownership and user-management phases.

## Decision: scrypt passwords without new dependencies

Passwords are hashed with Node's built-in `crypto.scrypt` using `N=16384`, `r=8`, `p=1`,
a 16-byte random salt, and a 32-byte-or-longer derived key. The stored format is
`scrypt$1$N$r$p$salt$key` with base64url salt/key fields. Verification parses and bounds
the stored parameters, recomputes the key, and uses `crypto.timingSafeEqual`. Unknown
emails run a dummy verification so login does not reveal whether an account exists.
Password policy is 12-128 characters and is enforced at request/CLI validation
boundaries; passwords are never accepted as CLI arguments.

## Decision: opaque, rotating, revocable refresh tokens

Refresh tokens are 32 random bytes encoded as base64url. Only their SHA-256 hex digest
is stored in `refresh_tokens`; the raw token is returned once to the client. Every token
issued from one login belongs to the same `family_id`, and `expires_at` is the absolute
expiry for that whole session. Refreshing locks the user row first and the current token
row second, then inserts a replacement in the same family with the original
`expires_at`, marks the old row revoked, and links it through `replaced_by` in one
transaction. Rotation therefore never extends the absolute session lifetime.

Expired, revoked, and unknown tokens all return the same `401`. Reuse of a previously
rotated or revoked token revokes all active tokens in that family, including descendants,
and still returns the generic `401`. Concurrent refreshes using the same token cannot
produce two valid replacements: the loser is treated as reuse and the family is revoked.
Logout locks the user row and revokes the presented token's whole family. Password change
locks the same user row first, then revokes every active refresh token for the user in
the same transaction as the new password hash. Access tokens remain short-lived (default
15 minutes) and are not revoked individually.

Login also closes the verify-then-insert race: after password verification it calls a
transactional session operation that locks the user row and compares the exact verified
hash before updating `last_login` and inserting the refresh token. If the password changed
after verification, no token is inserted and the generic invalid-credentials `401` is
returned. Password change passes the verified current hash to the store; the store
rechecks it under the same user lock, updates nothing when it has changed, and the service
returns the existing current-password `401`. A stale concurrent change therefore cannot
overwrite the committed password.

## Decision: authenticated requests re-check the database

`createAuthenticate(config, validatePrincipal)` still verifies the access-token
signature first, then calls the injected validator. The production validator loads the
user by id and requires `is_active = true` and an unchanged role. Missing users, inactive
users, and role changes return `401`. If validation itself fails (for example the
database is unavailable), the request fails closed with
`503 AUTH_UNAVAILABLE`; it never silently falls back to the token's claims. Requests
with no configured validator also fail closed, while a missing access-token secret keeps
the existing `501 AUTH_NOT_CONFIGURED` behavior.

## Decision: auth routes are public before the global auth gate

`/api/auth` is mounted after the audit and global rate-limit middleware but before the
global `authenticate` middleware. Login, refresh, and logout are public endpoints;
registration and profile/password routes attach `authenticate` themselves. Registration
is additionally restricted to `admin`. Login, registration, refresh, logout, and
password changes use a stricter 10-requests-per-minute per-client limiter in addition to
the global limiter. Audit middleware records method/path/status/actor metadata only;
request bodies, passwords, and tokens are never logged.

## Decision: operator-only administrator bootstrap

`npm run create-admin -- --email <email> --full-name <name> --password-stdin` creates the
first administrator. The password is read from stdin, validated with the same schema as
registration, and hashed through `AuthService.register`. No administrator is created
automatically at startup, and no password is accepted via `--password` or echoed in
output or errors.

## Decision: refresh token storage

`refresh_tokens` stores `user_id`, `family_id`, the unique 64-character token hash,
`expires_at`, `revoked_at`, `replaced_by`, and `created_at`. Foreign keys cascade on
user deletion and null the replacement link when a successor is removed. Indexes cover
user lookup, family lookup, expiry, active user tokens, and active family tokens. The
migration is not applied automatically by application startup.

Migration `0002_auth_refresh_tokens.sql` was updated in place rather than followed by a
new migration because it is uncommitted and has not been applied. Migration 0001 is
unchanged and remains the prerequisite that creates `users` and `pgcrypto`.

## Tests added

- `passwordService.test.ts`: hash format, per-hash salts, correct/incorrect
  verification, malformed stored hashes, and length bounds.
- `authService.test.ts`: login success/failure/inactive/unconfigured behavior, stale
  verified-password rejection without a session, refresh rotation without a duplicate
  insert, invalid refresh, hashed logout, registration normalization/hashing, profile
  visibility, password change rules including stale-condition rejection, and principal
  validation.
- `authStore.test.ts`: row mapping, unique-email conflict mapping, sanitized database
  failures, atomic login-session lock/hash-check/last-login/insert behavior, stale and
  missing login sessions without writes, password-change token-family revocation under a
  user lock with expected-hash rejection, family-aware rotation locking/linking, replay
  family revocation, expired tokens, logout family revocation, and missing refresh tokens.
- `routes/auth.test.ts`: login/profile flow, invalid credentials, login rate limiting,
  database-validation `401`/`503` behavior, admin-only registration, password policy,
  refresh, logout, and password change.
- `scripts/createAdmin.test.ts`: argument validation and refusal of password arguments.
- `auth.integration.test.ts` (gated by `TEST_DATABASE_URL`): real login, hash storage,
  database user validation, rotation with preserved absolute expiry, replay family
  revocation, descendant rejection, concurrent refresh, multi-family password-change
  revocation, deterministic stale-login rejection, deterministic concurrent
  password-change rejection, concurrent password-change/rotation, and failed-rotation
  rollback. The stale-request tests pause after verification with explicit gates so the
  racing request cannot pass sequentially.
- Existing route tests inject a test principal validator; the migration integration
  expectations now cover `refresh_tokens`, `family_id`, `replaced_by`, `expires_at`, and
  the family/active-family indexes.

## Verification

- `npm run lint`, `npm run typecheck`, `npm run build`, and `git diff --check` pass.
- `npm test -- --runInBand`: 21 suites passed, 4 skipped; 246 tests passed,
  18 skipped. The skipped suites are the live-database integration suites
  (`db`, `auth`, `migrate`, `patients`) because no test database was used.

## Known limitations / not in scope

1. No user list, activation/deactivation, role-change, or admin reset endpoint yet.
2. Access tokens are not revocable before expiry; password changes revoke refresh
   tokens only.
3. Expired/revoked refresh-token rows are retained; no cleanup job exists yet.
4. No login lockout beyond rate limiting; no MFA.
5. `patients.created_by` remains `NULL`; patient ownership is a later phase.
6. The integration suite was not executed locally because no `TEST_DATABASE_URL` or
   database connection is permitted in this phase. Applied migrations are a prerequisite
   when it is enabled.
7. No frontend integration, `.env` changes, commits, or automatic migrations.
