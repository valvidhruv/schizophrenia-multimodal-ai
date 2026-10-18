import { signAccessToken, TokenError, verifyAccessToken } from '../services/tokenService';
import type { Role } from '../types';

const SECRET = 'test-secret-with-enough-length';
const OTHER_SECRET = 'different-secret-with-enough-length';
const NOW = 1700000000;

describe('token service', () => {
  test('round-trips a clinician token', () => {
    const token = signAccessToken({ userId: 'u-1', role: 'clinician' }, SECRET, 900, NOW);
    const principal = verifyAccessToken(token, SECRET, NOW + 10);

    expect(principal.userId).toBe('u-1');
    expect(principal.role).toBe('clinician');
    expect(principal.iat).toBe(NOW);
    expect(principal.exp).toBe(NOW + 900);
  });

  test('rejects a token signed with a different secret', () => {
    const token = signAccessToken({ userId: 'u-1', role: 'admin' }, SECRET, 900, NOW);

    expect(() => verifyAccessToken(token, OTHER_SECRET, NOW)).toThrow(TokenError);
  });

  test('rejects a tampered payload', () => {
    const token = signAccessToken({ userId: 'u-1', role: 'clinician' }, SECRET, 900, NOW);
    const [header, payload, signature] = token.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      role: string;
    };
    decoded.role = 'admin';
    const forged = `${header}.${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${signature}`;

    expect(() => verifyAccessToken(forged, SECRET, NOW)).toThrow(TokenError);
  });

  test('rejects an expired token', () => {
    const token = signAccessToken({ userId: 'u-1', role: 'clinician' }, SECRET, 900, NOW);

    expect(() => verifyAccessToken(token, SECRET, NOW + 900)).toThrow('token expired');
  });

  test('rejects an empty signature (alg none style token)', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
      'base64url'
    );
    const payload = Buffer.from(
      JSON.stringify({ sub: 'u-1', role: 'admin', iat: NOW, exp: NOW + 900 })
    ).toString('base64url');

    expect(() => verifyAccessToken(`${header}.${payload}.`, SECRET, NOW)).toThrow(TokenError);
  });

  test('rejects a payload with an unknown role', () => {
    const token = signAccessToken(
      { userId: 'u-1', role: 'wizard' as Role },
      SECRET,
      900,
      NOW
    );

    expect(() => verifyAccessToken(token, SECRET, NOW)).toThrow('invalid role');
  });

  test('rejects a malformed token', () => {
    expect(() => verifyAccessToken('not-a-token', SECRET, NOW)).toThrow(TokenError);
  });

  test('rejects a token issued too far in the future', () => {
    const token = signAccessToken({ userId: 'u-1', role: 'clinician' }, SECRET, 900, NOW + 600);

    expect(() => verifyAccessToken(token, SECRET, NOW)).toThrow('issued in the future');
  });
});
