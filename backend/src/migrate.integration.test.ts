import { initDatabase, closeDatabase, query } from './db';
import { runUp, discoverMigrations } from './migrate';
import { disposableDatabaseUrl } from './testing/disposableDatabaseUrl';

const EXPECTED_TABLES = [
  'users',
  'refresh_tokens',
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

  test('creates refresh-token family columns and indexes', async () => {
    await runUp();
    const columns = await query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'refresh_tokens'`
    );
    const familyId = columns.find((column) => column.column_name === 'family_id');
    expect(familyId).toMatchObject({ is_nullable: 'NO' });
    expect(columns.map((column) => column.column_name)).toEqual(
      expect.arrayContaining(['family_id', 'replaced_by', 'expires_at'])
    );

    const indexes = await query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef
       FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'refresh_tokens'`
    );
    const indexNames = indexes.map((index) => index.indexname);
    expect(indexNames).toEqual(
      expect.arrayContaining([
        'idx_refresh_tokens_family_id',
        'idx_refresh_tokens_active_family',
      ])
    );
    const activeFamily = indexes.find(
      (index) => index.indexname === 'idx_refresh_tokens_active_family'
    );
    expect(activeFamily?.indexdef).toMatch(/WHERE.*revoked_at IS NULL/i);
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
