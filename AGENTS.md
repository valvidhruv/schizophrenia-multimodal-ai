# AGENTS.md - Permanent Project Rules

## Core Principles

1. **NO FABRICATED METRICS** - Every reported number (accuracy, AUC, sensitivity, specificity, F1, etc.) MUST come from actual evaluation code. Never invent, estimate, round up, or cherry-pick metrics.

2. **NO AUTONOMOUS DIAGNOSIS** - This is a DECISION SUPPORT prototype. All UI, reports, and API responses must clearly state: "Research prototype - not for clinical diagnosis. Clinician review required."

3. **SUBJECT-LEVEL SPLITS ONLY** - Train/validation/test splits MUST be at subject level. Never split epochs, slices, windows, or patches from the same subject across different sets.

4. **REAL DATA ONLY** - No synthetic data for evaluation. No fake predictions. No placeholder results in reports or UI.

5. **ONE PHASE AT A TIME** - Complete, test, verify, and document each phase fully before starting the next. No parallel phase development.

## Development Rules

6. **LINT FIRST** - Code must pass lint and typecheck before commit. CI enforces this.

7. **TESTS REQUIRED** - New functionality requires tests. Target >80% coverage for critical paths.

8. **DOCUMENT DECISIONS** - Architecture and design decisions recorded in `/docs/decisions/` with date and rationale.

9. **VERSION MODELS** - Every model has version, config.json, metrics.json, training dataset documented.

10. **GPU MEMORY AWARE** - All code targets RTX 4050 6GB VRAM. Profile VRAM usage in CI.

## Data Rules

11. **METADATA FIRST** - Every subject has: subject_id, diagnosis, age, sex, eeg_available, smri_available, fmri_available, clinical_available, panss_available.

12. **NO LEAKAGE** - Preprocessing fit on train only. No test data statistics in preprocessing. Nested CV mandatory.

13. **CACHE WITH HASHES** - Preprocessed data cached with parameter hash keys (subject_id + file_checksum + preprocessing_params_hash).

14. **AUDIT EVERYTHING** - All data access, predictions, reports, exports logged with user, timestamp, action.

## Communication Rules

15. **CONCISE OUTPUT** - Agent responses < 4 lines unless detail explicitly requested.

16. **NO PREAMBLE** - Answer directly. No "Here is what I'll do...", "Based on the information...", etc.

17. **STOP AFTER PHASE** - Complete phase, run verification, explain changes, show remaining issues, then STOP and wait for approval.

## Enforcement

- CI checks: lint, typecheck, tests, no-fabrication grep patterns
- Pre-commit hooks for formatting and basic checks
- Code review requirements for all merges
- Automated metric validation in evaluation scripts
- Git hooks prevent commits with "TODO: fake metric" patterns