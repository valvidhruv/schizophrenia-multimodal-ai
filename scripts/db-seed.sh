#!/usr/bin/env bash
# scripts/db-seed.sh - Seed database with development data
#
# NOT IMPLEMENTED. Prisma is not used in this project (see scripts/db-migrate.sh),
# and Phase 1B intentionally creates no seed data: no default administrator
# accounts, patients, clinical assessments, or model results (AGENTS.md rules 4
# and 9). This script fails clearly rather than pretending to work.
set -e

echo "db-seed.sh: seeding is not implemented in this project." >&2
echo "No default admin, patient, clinical, or model-result records are created." >&2
exit 1
