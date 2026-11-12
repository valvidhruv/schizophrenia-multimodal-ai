import {
  PASSWORD_MAX_LENGTH,
  hashPassword,
  verifyPassword,
} from './passwordService';

const PASSWORD = 'correct horse battery staple';

describe('password hashing', () => {
  test('produces a versioned scrypt hash that verifies', async () => {
    const hash = await hashPassword(PASSWORD);

    expect(hash).toMatch(/^scrypt\$1\$16384\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    await expect(verifyPassword(PASSWORD, hash)).resolves.toBe(true);
  });

  test('uses a fresh salt for every hash', async () => {
    const first = await hashPassword(PASSWORD);
    const second = await hashPassword(PASSWORD);

    expect(first).not.toBe(second);
    await expect(verifyPassword(PASSWORD, second)).resolves.toBe(true);
  });

  test('rejects an incorrect password', async () => {
    const hash = await hashPassword(PASSWORD);

    await expect(verifyPassword(`${PASSWORD}!`, hash)).resolves.toBe(false);
  });

  test('rejects malformed stored hashes without throwing', async () => {
    const malformed = [
      '',
      'plain-text',
      'scrypt$1$16384$8$1$only-five-parts',
      'scrypt$2$16384$8$1$c2FsdA$a2V5',
      'scrypt$1$1$8$1$c2FsdA$a2V5',
      'scrypt$1$16384$8$1$c2FsdA',
    ];

    for (const stored of malformed) {
      await expect(verifyPassword(PASSWORD, stored)).resolves.toBe(false);
    }
  });

  test('refuses to hash an over-length password', async () => {
    await expect(hashPassword('a'.repeat(PASSWORD_MAX_LENGTH + 1))).rejects.toThrow(
      'Password is not valid for hashing'
    );
  });

  test('rejects an over-length password without hashing', async () => {
    const hash = await hashPassword(PASSWORD);

    await expect(
      verifyPassword('a'.repeat(PASSWORD_MAX_LENGTH + 1), hash)
    ).resolves.toBe(false);
  });
});
