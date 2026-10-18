import { ConfigError, loadConfig } from '../config';

describe('loadConfig', () => {
  test('applies safe defaults for an empty environment', () => {
    const config = loadConfig({});

    expect(config.nodeEnv).toBe('development');
    expect(config.port).toBe(3001);
    expect(config.corsOrigins).toEqual(['http://localhost:5173']);
    expect(config.rateLimit).toEqual({ windowMs: 900000, max: 100 });
    expect(config.auth.accessTokenSecret).toBeNull();
    expect(config.auth.accessTokenTtlSeconds).toBe(900);
    expect(config.databaseUrl).toBeNull();
    expect(config.redisUrl).toBeNull();
  });

  test('treats blank values as unset', () => {
    const config = loadConfig({ JWT_SECRET: '   ', DATABASE_URL: '', BACKEND_PORT: '' });

    expect(config.auth.accessTokenSecret).toBeNull();
    expect(config.databaseUrl).toBeNull();
    expect(config.port).toBe(3001);
  });

  test('parses a valid secret, expiry, and port', () => {
    const secret = 'a'.repeat(40);
    const config = loadConfig({
      JWT_SECRET: secret,
      JWT_ACCESS_EXPIRY: '2h',
      BACKEND_PORT: '4000',
    });

    expect(config.auth.accessTokenSecret).toBe(secret);
    expect(config.auth.accessTokenTtlSeconds).toBe(7200);
    expect(config.port).toBe(4000);
  });

  test('rejects a non-numeric rate limit and names the variable', () => {
    let caught: unknown;
    try {
      loadConfig({ BACKEND_RATE_LIMIT_MAX: 'lots' });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ConfigError);
    const issues = (caught as ConfigError).issues.join(' ');
    expect(issues).toContain('BACKEND_RATE_LIMIT_MAX');
  });

  test('never echoes a rejected secret value', () => {
    let caught: unknown;
    try {
      loadConfig({ JWT_SECRET: 'tiny' });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).message).not.toContain('tiny');
    expect((caught as ConfigError).message).toContain('JWT_SECRET');
  });

  test('rejects an unparsable access token expiry', () => {
    expect(() => loadConfig({ JWT_ACCESS_EXPIRY: 'soon' })).toThrow(ConfigError);
  });

  test('splits multiple allowed CORS origins', () => {
    const config = loadConfig({
      BACKEND_CORS_ORIGIN: 'http://localhost:5173, https://example.test',
    });

    expect(config.corsOrigins).toEqual([
      'http://localhost:5173',
      'https://example.test',
    ]);
  });

  test('rejects an out-of-range port', () => {
    expect(() => loadConfig({ BACKEND_PORT: '70000' })).toThrow(ConfigError);
  });

  test('rejects an unknown node environment', () => {
    expect(() => loadConfig({ NODE_ENV: 'staging' })).toThrow(ConfigError);
  });

  test('accepts the example placeholder outside production', () => {
    const config = loadConfig({ JWT_SECRET: 'REPLACE_WITH_RANDOM_JWT_SECRET' });

    expect(config.auth.accessTokenSecret).toBe('REPLACE_WITH_RANDOM_JWT_SECRET');
  });

  test('rejects a missing secret in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(ConfigError);
  });

  test('rejects the example placeholder in production', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        JWT_SECRET: 'REPLACE_WITH_RANDOM_JWT_SECRET',
      })
    ).toThrow(ConfigError);
  });

  test('rejects a short secret in production', () => {
    expect(() =>
      loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'a'.repeat(20) })
    ).toThrow(ConfigError);
  });

  test('disables trust proxy by default', () => {
    expect(loadConfig({}).trustProxy).toBe(false);
    expect(loadConfig({ TRUST_PROXY: '   ' }).trustProxy).toBe(false);
    expect(loadConfig({ TRUST_PROXY: '0' }).trustProxy).toBe(false);
  });

  test('parses a trust proxy hop count', () => {
    expect(loadConfig({ TRUST_PROXY: '1' }).trustProxy).toBe(1);
    expect(loadConfig({ TRUST_PROXY: '2' }).trustProxy).toBe(2);
    expect(loadConfig({ TRUST_PROXY: ' 3 ' }).trustProxy).toBe(3);
  });

  test('parses a trust proxy address list', () => {
    const config = loadConfig({ TRUST_PROXY: '10.0.0.1, 192.168.1.0/24' });

    expect(config.trustProxy).toEqual(['10.0.0.1', '192.168.1.0/24']);
  });

  test('rejects trust-all trust proxy values', () => {
    for (const value of ['true', 'yes', 'on', 'all', '*', 'TRUE']) {
      let caught: unknown;
      try {
        loadConfig({ TRUST_PROXY: value });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ConfigError);
      expect((caught as ConfigError).issues.join(' ')).toContain('TRUST_PROXY');
    }
  });

  test('rejects an out-of-range trust proxy hop count', () => {
    let caught: unknown;
    try {
      loadConfig({ TRUST_PROXY: '11' });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ConfigError);
    const issues = (caught as ConfigError).issues.join(' ');
    expect(issues).toContain('TRUST_PROXY');
    expect(issues).toContain('hop count');
  });

  test('rejects mixing a hop count with proxy addresses', () => {
    let caught: unknown;
    try {
      loadConfig({ TRUST_PROXY: '1,10.0.0.1' });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).issues.join(' ')).toContain('TRUST_PROXY');
  });

  test('rejects invalid trust proxy entries', () => {
    for (const value of [
      'example.com',
      '999.1.1.1',
      '01.1.1.1',
      '10.0.0.1/0',
      '10.0.0.1/33',
      '10.0.0.1/8/8',
      '10.0.0.,10.0.0.1',
      '::1',
      '2001:db8::/32',
    ]) {
      expect(() => loadConfig({ TRUST_PROXY: value })).toThrow(ConfigError);
    }
  });

  test('rejects IPv6 trust proxy entries with hop count guidance', () => {
    let caught: unknown;
    try {
      loadConfig({ TRUST_PROXY: '::1' });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ConfigError);
    const issues = (caught as ConfigError).issues.join(' ');
    expect(issues).toContain('TRUST_PROXY');
    expect(issues).toContain('hop count');
  });
});
