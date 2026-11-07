/**
 * Returns a connection string only when it points at a disposable test database.
 * Refuses the normal development database and any database whose name does not
 * end in `_test` or `_ci`, so integration suites can never run against real data.
 */
export function disposableDatabaseUrl(): string | null {
  const testUrl = (process.env.TEST_DATABASE_URL ?? '').trim();
  if (testUrl === '') {
    return null;
  }
  const devUrl = (process.env.DATABASE_URL ?? '').trim();
  if (devUrl !== '' && devUrl === testUrl) {
    return null;
  }
  try {
    const parsed = new URL(testUrl);
    const name = parsed.pathname.replace(/^\//, '');
    if (!/(_test|_ci)$/.test(name)) {
      return null;
    }
    return testUrl;
  } catch {
    return null;
  }
}
