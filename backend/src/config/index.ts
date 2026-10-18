import { z } from 'zod';

const EXPIRY_PATTERN = /^(\d+)(s|m|h|d)$/;
const EXPIRY_UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
const SECRET_ENV_KEYS = new Set(['JWT_SECRET']);
const PLACEHOLDER_PREFIX = 'REPLACE_WITH';
const TRUST_PROXY_HOP_MAX = 10;
const TRUST_ALL_VALUES = new Set(['true', 'yes', 'on', 'all', '*']);
const IPV4_OCTET = /^(0|[1-9]\d{0,2})$/;
const TRUST_PROXY_FORMAT_HELP =
  'TRUST_PROXY must be blank (disabled), a hop count from 1 to 10, or a comma-separated ' +
  'list of proxy IPv4 addresses/CIDR ranges (prefix 1-32); use a hop count for IPv6 proxies';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  BACKEND_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  BACKEND_CORS_ORIGIN: z.string().default('http://localhost:5173'),
  BACKEND_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(3600000).default(900000),
  BACKEND_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10000).default(100),
  JWT_SECRET: z.string().min(16, 'must be at least 16 characters').optional(),
  JWT_ACCESS_EXPIRY: z.string().regex(EXPIRY_PATTERN, 'must be a duration such as 15m').default('15m'),
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  TRUST_PROXY: z.string().optional(),
});

export class ConfigError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid configuration: ${issues.join('; ')}`);
    this.name = 'ConfigError';
    this.issues = issues;
    Object.setPrototypeOf(this, ConfigError.prototype);
  }
}

export type TrustProxySetting = false | number | string[];

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  corsOrigins: string[];
  rateLimit: { windowMs: number; max: number };
  auth: { accessTokenSecret: string | null; accessTokenTtlSeconds: number };
  databaseUrl: string | null;
  redisUrl: string | null;
  trustProxy: TrustProxySetting;
}

function blankToUndefined(env: NodeJS.ProcessEnv): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(env)) {
    normalized[key] = typeof value === 'string' && value.trim() === '' ? undefined : value;
  }
  return normalized;
}

function expiryToSeconds(raw: string): number {
  const match = EXPIRY_PATTERN.exec(raw);
  if (!match) {
    throw new ConfigError(['JWT_ACCESS_EXPIRY must be a duration such as 15m, 2h, or 7d']);
  }
  return Number(match[1]) * EXPIRY_UNIT_SECONDS[match[2]];
}

function isTrustedProxyEntry(value: string): boolean {
  const [address, prefix, ...extra] = value.split('/');
  if (extra.length > 0) {
    return false;
  }
  const octets = address.split('.');
  if (octets.length !== 4) {
    return false;
  }
  if (!octets.every((octet) => IPV4_OCTET.test(octet) && Number(octet) <= 255)) {
    return false;
  }
  if (prefix === undefined) {
    return true;
  }
  if (!/^\d{1,2}$/.test(prefix)) {
    return false;
  }
  const bits = Number(prefix);
  return bits >= 1 && bits <= 32;
}

function parseTrustProxy(raw: string | undefined): TrustProxySetting {
  if (raw === undefined) {
    return false;
  }
  const value = raw.trim();
  if (value === '') {
    return false;
  }
  if (TRUST_ALL_VALUES.has(value.toLowerCase())) {
    throw new ConfigError([
      'TRUST_PROXY must not enable trust-all proxies; set a hop count (e.g. 1) or a ' +
        'comma-separated list of proxy IPv4 addresses/CIDR ranges',
    ]);
  }
  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    if (hops === 0) {
      return false;
    }
    if (hops > TRUST_PROXY_HOP_MAX) {
      throw new ConfigError([
        `TRUST_PROXY hop count must be between 1 and ${TRUST_PROXY_HOP_MAX}; it must equal ` +
          'the exact number of proxies between clients and this server',
      ]);
    }
    return hops;
  }
  const parts = value.split(',');
  const entries = parts.map((part) => part.trim());
  if (entries.some((entry) => entry === '')) {
    throw new ConfigError([TRUST_PROXY_FORMAT_HELP]);
  }
  if (entries.some((entry) => /^\d+$/.test(entry))) {
    throw new ConfigError([
      'TRUST_PROXY must be either a hop count or a list of proxy addresses, not both',
    ]);
  }
  for (const entry of entries) {
    if (!isTrustedProxyEntry(entry)) {
      throw new ConfigError([`${TRUST_PROXY_FORMAT_HELP} (invalid entry: ${entry})`]);
    }
  }
  return entries;
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema.safeParse(blankToUndefined(env));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const key = issue.path.join('.');
      if (SECRET_ENV_KEYS.has(key)) {
        return `${key} must be a secret of at least 16 characters`;
      }
      return `${key || '(environment)'}: ${issue.message}`;
    });
    throw new ConfigError(issues);
  }

  const data = parsed.data;
  const productionIssues: string[] = [];
  if (data.NODE_ENV === 'production') {
    if (!data.JWT_SECRET) {
      productionIssues.push('JWT_SECRET is required in production');
    } else if (data.JWT_SECRET.startsWith(PLACEHOLDER_PREFIX)) {
      productionIssues.push('JWT_SECRET must not be the example placeholder in production');
    } else if (data.JWT_SECRET.length < 32) {
      productionIssues.push('JWT_SECRET must be at least 32 characters in production');
    }
  }
  if (productionIssues.length > 0) {
    throw new ConfigError(productionIssues);
  }

  return {
    nodeEnv: data.NODE_ENV,
    port: data.BACKEND_PORT,
    corsOrigins: data.BACKEND_CORS_ORIGIN.split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    rateLimit: {
      windowMs: data.BACKEND_RATE_LIMIT_WINDOW_MS,
      max: data.BACKEND_RATE_LIMIT_MAX,
    },
    auth: {
      accessTokenSecret: data.JWT_SECRET ?? null,
      accessTokenTtlSeconds: expiryToSeconds(data.JWT_ACCESS_EXPIRY),
    },
    databaseUrl: data.DATABASE_URL ?? null,
    redisUrl: data.REDIS_URL ?? null,
    trustProxy: parseTrustProxy(data.TRUST_PROXY),
  };
}
