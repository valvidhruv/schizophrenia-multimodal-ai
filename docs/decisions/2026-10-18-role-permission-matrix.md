# Role Permission Matrix for API Routes

- **Date**: 2026-10-18
- **Status**: Accepted
- **Scope**: `backend/src/routes/*.ts` (authorization gates only)

## Context

The Phase 1C security review found that role gates existed on only 5 of 23
registered routes (patient create/update/delete, PANSS create) while every
other route was authenticated-only, and the Phase 1C decision record implied
gates were registered on all domain routes. No domain handlers exist yet (all
return `501 NOT_IMPLEMENTED`), so the middleware gates are currently the only
authorization layer in front of those endpoints.

Sources consulted:

- `API_DESIGN.md:8` - patient data reads require an authenticated role
  (admin, clinician, or researcher).
- `API_DESIGN.md:85` - patient deletion requires `admin`.
- `ARCHITECTURE.md:66` - a clinician creates the patient record.
- `DATABASE_SCHEMA.md:29` - roles are constrained to
  `admin | clinician | researcher`.
- `RISKS_AND_LIMITATIONS.md:67` - reports require clinician sign-off.

## Decision: explicit route/role matrix

| Route | Method | Required role(s) |
| --- | --- | --- |
| `/api/patients` | GET | any authenticated role |
| `/api/patients/:id` | GET | any authenticated role |
| `/api/patients/:id/files` | GET | any authenticated role |
| `/api/patients/:id/panss/history`, `/latest` | GET | any authenticated role |
| `/api/analysis/jobs`, `/jobs/:jobId` | GET | any authenticated role |
| `/api/analysis/patients/:patientId/latest`, `/history` | GET | any authenticated role |
| `/api/analysis/results/:resultId`, `/explanations` | GET | any authenticated role |
| `/api/reports/:reportId`, `/download`, `/patients/:patientId/reports` | GET | any authenticated role |
| `/api/patients` | POST | `admin`, `clinician` |
| `/api/patients/:id` | PUT | `admin`, `clinician` |
| `/api/patients/:id` | DELETE | `admin` |
| `/api/patients/:id/panss` | POST | `admin`, `clinician` |
| `/api/patients/:id/upload/:modality` | POST | `admin`, `clinician` |
| `/api/patients/:id/files/:fileId/validate` | POST | `admin`, `clinician` |
| `/api/analysis/jobs` | POST | `admin`, `clinician` |
| `/api/analysis/jobs/:jobId/cancel` | POST | `admin`, `clinician` |
| `/api/reports` | POST | `admin`, `clinician` |

## Decision rules

1. **Documented permissions are preserved verbatim.** Reads are open to any
   authenticated role (`API_DESIGN.md`); patient deletion stays `admin`-only;
   patient create/update and PANSS create keep their existing
   `admin`/`clinician` gates.
2. **Undocumented writes get the most restrictive documented write role**
   (`admin`, `clinician`). This covers file upload, file validation, analysis
   job creation/cancellation, and report generation. Researcher keeps read
   access everywhere. If documentation later grants researcher write access
   (for example job creation), the gate and this record change together.
3. **`requireRole` runs first** in the route chain, before rate limiting and
   validation, matching the existing `patients.ts` order: authorization is the
   cheapest check, denies never consume rate-limit quota, and role denials are
   reported before payload validation (403 wins over 400).
4. Gates are enforced in front of `501` handlers; they carry no database or
   clinical behavior and invent no data.

## Verification

`backend/src/routes/authorization.test.ts` asserts the matrix end to end:
missing token -> `401`, researcher on any write -> `403` (including before body
validation), allowed roles on gated writes -> `501 NOT_IMPLEMENTED`, empty PUT
body from an allowed role -> `400`, researcher on reads -> `501`. Existing
scaffold tests were kept; the analysis job creation test now uses a clinician
because researcher was never intended to create jobs.

## Not changed

- `patients.ts` and `clinical.ts` gate definitions (already matched the rules).
- No schema, migration, or handler changes; no new dependencies.
