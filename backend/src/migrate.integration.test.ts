import { initDatabase, closeDatabase, query } from './db';
import { runUp, discoverMigrations } from './migrate';
import { disposableDatabaseUrl } from './testing/disposableDatabaseUrl';

const EXPECTED_TABLES = [
  'users',
  'patients',
  'patient_files',
  'clinical_assessments',
  'analysis_jobs',
  'analysis_results',
  'eeg_results',
  'smri_results',
  'fmri_results',
  'fusion_results',
  'explanations',
  'reports',
  'audit_logs',
];

const testUrl = disposableDatabaseUrl();
const describeLive = testUrl ? describe : describe.skip;

describeLive('migration integration (disposable test database)', () => {
  beforeAll(() => {
    const { configured } = initDatabase({ DATABASE_URL: testUrl as string });
    if (!configured) {
      throw new Error('TEST_DATABASE_URL is set but the database pool was not configured');
    }
  });

  afterAll(async () => {
    await closeDatabase();
  });

  test('applies migrations and creates every documented table', async () => {
    await runUp();

    const rows = await query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [EXPECTED_TABLES]
    );
    const found = rows.map((row) => row.table_name);
    for (const table of EXPECTED_TABLES) {
      expect(found).toContain(table);
    }
  });

  test('records every migration file in schema_migrations', async () => {
    const files = discoverMigrations();
    const rows = await query<{ version: string }>(
      'SELECT version FROM schema_migrations ORDER BY version'
    );
    expect(rows).toHaveLength(files.length);
  });

  test('re-running migrations is a no-op', async () => {
    const second = await runUp();
    expect(second.applied).toHaveLength(0);
  });
});
