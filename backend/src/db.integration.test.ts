import { initDatabase, checkDatabase, closeDatabase } from './db';

// Runs only when DATABASE_URL is provided, e.g.:
//   DATABASE_URL=postgresql://dev:dev@127.0.0.1:5432/schizophrenia_ai npm test
const describeLive = process.env.DATABASE_URL ? describe : describe.skip;

describeLive('database integration (live PostgreSQL)', () => {
  afterAll(async () => {
    await closeDatabase();
  });

  test('SELECT 1 succeeds against the real database', async () => {
    initDatabase();
    const result = await checkDatabase();
    expect(result.ok).toBe(true);
    expect(typeof result.latencyMs).toBe('number');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  }, 15000);
});
