import crypto from 'crypto';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

const HASH_PREFIX = 'scrypt';
const HASH_VERSION = '1';
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_SALT_LENGTH = 16;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;
const MAX_ALLOWED_N = 32768;
const MAX_ALLOWED_R = 16;
const MAX_ALLOWED_P = 4;
const MAX_ALLOWED_KEY_LENGTH = 128;
const MAX_ALLOWED_SALT_LENGTH = 64;

interface ParsedHash {
  n: number;
  r: number;
  p: number;
  salt: Buffer;
  key: Buffer;
}

function deriveKey(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: crypto.ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keyLength, options, (err, derivedKey) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(derivedKey);
    });
  });
}

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split('$');
  if (parts.length !== 7) {
    return null;
  }
  const [prefix, version, rawN, rawR, rawP, rawSalt, rawKey] = parts;
  if (prefix !== HASH_PREFIX || version !== HASH_VERSION) {
    return null;
  }
  const n = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (
    !Number.isSafeInteger(n) ||
    !Number.isSafeInteger(r) ||
    !Number.isSafeInteger(p) ||
    n < 2 ||
    n > MAX_ALLOWED_N ||
    r < 1 ||
    r > MAX_ALLOWED_R ||
    p < 1 ||
    p > MAX_ALLOWED_P
  ) {
    return null;
  }
  const salt = Buffer.from(rawSalt, 'base64url');
  const key = Buffer.from(rawKey, 'base64url');
  if (
    salt.length < SCRYPT_SALT_LENGTH ||
    salt.length > MAX_ALLOWED_SALT_LENGTH ||
    key.length < 32 ||
    key.length > MAX_ALLOWED_KEY_LENGTH
  ) {
    return null;
  }
  return { n, r, p, salt, key };
}

export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length > PASSWORD_MAX_LENGTH) {
    throw new Error('Password is not valid for hashing');
  }
  const salt = crypto.randomBytes(SCRYPT_SALT_LENGTH);
  const key = await deriveKey(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  return [
    HASH_PREFIX,
    HASH_VERSION,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (typeof password !== 'string' || password.length > PASSWORD_MAX_LENGTH) {
    return false;
  }
  const parsed = parseHash(stored);
  if (!parsed) {
    return false;
  }
  try {
    const candidate = await deriveKey(password, parsed.salt, parsed.key.length, {
      N: parsed.n,
      r: parsed.r,
      p: parsed.p,
      maxmem: SCRYPT_MAXMEM,
    });
    return crypto.timingSafeEqual(candidate, parsed.key);
  } catch {
    return false;
  }
}
