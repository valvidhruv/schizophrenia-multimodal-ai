# Phase 1E-B: Patient Creator Accountability

- **Date**: 2026-11-12
- **Status**: Accepted
- **Scope**: `backend/src/services/patientService.ts`,
  `backend/src/routes/patients.ts`, patient service/route unit tests,
  `backend/src/patients.integration.test.ts`

## Context

Phase 1D created patients through a raw-SQL store that always wrote
`patients.created_by = NULL` because user provisioning did not exist. Phase 1E-A added
database-backed authentication, and authenticated requests now carry a verified
`req.auth` principal. Phase 1E-B uses that principal to populate the existing
`patients.created_by` foreign key.

No schema change is required: `backend/migrations/0001_initial_schema.sql` already
defines `created_by UUID REFERENCES users(id)` and its index.

## Decision: the route supplies a minimal creator capability

`PatientStore.create` now requires a second `creator` argument typed as
`PatientCreator = Pick<AuthPrincipal, 'userId'>`. The create handler requires
`req.auth` and passes the authenticated principal to the store. The store reads only
`creator.userId`.

This keeps the data layer independent of request parsing while ensuring the repository
receives identity that came from the verified authentication middleware. The store does
not accept a creator from `CreatePatientInput`.

## Decision: creator identity is server-derived

The patient creator is never read from the request body, query string, or headers. The
existing strict Zod body schema strips unknown fields before the handler runs, so a
client-supplied `createdBy`, `created_by`, or `userId` cannot override the authenticated
principal. The insert uses parameterized SQL:

```sql
INSERT INTO patients (subject_id, diagnosis, age, sex, handedness, created_by)
VALUES ($1, $2, $3, $4, $5, $6)
```

The sixth parameter is `creator.userId`.

## Decision: reads remain global

`GET /api/patients` and `GET /api/patients/:id` are unchanged. No `created_by` filter or
ownership check is added. All authenticated roles retain their existing global read
access, and the existing admin/clinician create restriction is unchanged.

## Decision: created_by stays internal

`PatientRecord` and the API response shape are unchanged. `created_by` is not exposed in
patient responses. Creator accountability is available through the persisted column and
the existing audit record, which records the same `req.auth.userId` as `actorUserId`.

## Decision: error handling is unchanged

Duplicate `subjectId` still maps only `23505` on `patients_subject_id_key` to
`409 CONFLICT`. Other database errors, including a creator foreign-key violation, remain
generic log-safe `500 INTERNAL_ERROR` responses. In production the authentication
validator already requires the user to exist and be active; user deletion is not exposed
by the API yet.

## Tests added or updated

- `patientService.test.ts`: creator ID is passed as `$6`, the creator UUID is never
  interpolated into SQL text, optional fields still map, duplicate handling is
  unchanged, and a `patients_created_by_fkey` violation is wrapped without leaking
  driver properties.
- `routes/patients.test.ts`: authenticated creator propagation, unauthenticated
  creation rejection before store access, request-body creator spoofing resistance, and
  audit actor equality with the authenticated creator.
- `patients.integration.test.ts` (gated by `TEST_DATABASE_URL`): a real `users` fixture
  satisfies the foreign key; created patients are checked directly for
  `created_by = authenticated user id`; the audit actor is checked for the same ID;
  unauthenticated creation inserts no row; other authenticated roles can still read all
  patients; and `created_by` is not exposed.

## Known limitations / not in scope

1. Existing patients created in earlier phases keep `created_by = NULL`; no backfill is
   performed.
2. No patient ownership or creator-based access control is introduced.
3. No user deletion lifecycle policy is added for users referenced by patients.
4. The gated live-database suite is not executed without an approved disposable
   `TEST_DATABASE_URL`; no migrations are applied by the suite.
5. No migrations, `.env` changes, dependency changes, commits, or pushes are part of
   this phase.
