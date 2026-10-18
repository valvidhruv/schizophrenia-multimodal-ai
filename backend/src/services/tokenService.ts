import crypto from 'crypto';
import type { AuthPrincipal, Role } from '../types';

const ROLES: readonly string[] = ['admin', 'clinician', 'researcher'];
const FUTURE_SKEW_SECONDS = 30;

export class TokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenError';
    Object.setPrototypeOf(this, TokenError.prototype);
  }
}

export interface TokenSubject {
  userId: string;
  role: Role;
}

function base64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function hmac(data: string, secret: string): Buffer {
  return crypto.createHmac('sha256', secret).update(data, 'utf8').digest();
}

function decodeJson(part: string): Record<string, unknown> | null {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    if (typeof decoded === 'object' && decoded !== null) {
      return decoded as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export function signAccessToken(
  subject: TokenSubject,
  secret: string,
  ttlSeconds: number,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      sub: subject.userId,
      role: subject.role,
      iat: nowSeconds,
      exp: nowSeconds + ttlSeconds,
    })
  );
  const signature = hmac(`${header}.${payload}`, secret).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

export function verifyAccessToken(
  token: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): AuthPrincipal {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0].length === 0 || parts[1].length === 0) {
    throw new TokenError('malformed token');
  }
  const [headerPart, payloadPart, signaturePart] = parts;

  const expected = hmac(`${headerPart}.${payloadPart}`, secret);
  const provided = Buffer.from(signaturePart, 'base64url');
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    throw new TokenError('signature verification failed');
  }

  const header = decodeJson(headerPart);
  if (!header || header.alg !== 'HS256' || header.typ !== 'JWT') {
    throw new TokenError('unsupported token header');
  }

  const payload = decodeJson(payloadPart);
  if (!payload) {
    throw new TokenError('invalid token payload');
  }

  const { sub, role, iat, exp } = payload;
  if (typeof sub !== 'string' || sub.length === 0) {
    throw new TokenError('missing subject');
  }
  if (typeof role !== 'string' || !ROLES.includes(role)) {
    throw new TokenError('invalid role');
  }
  if (typeof iat !== 'number' || !Number.isFinite(iat)) {
    throw new TokenError('invalid issued-at claim');
  }
  if (typeof exp !== 'number' || !Number.isFinite(exp)) {
    throw new TokenError('invalid expiry claim');
  }
  if (iat > nowSeconds + FUTURE_SKEW_SECONDS) {
    throw new TokenError('token issued in the future');
  }
  if (nowSeconds >= exp) {
    throw new TokenError('token expired');
  }

  return { userId: sub, role: role as Role, iat, exp };
}
