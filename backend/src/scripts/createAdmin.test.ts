import { parseArgs } from './createAdmin';

describe('create-admin argument parsing', () => {
  test('accepts email, full name, and password-stdin', () => {
    expect(
      parseArgs([
        '--email',
        'admin@example.test',
        '--full-name',
        'Platform Admin',
        '--password-stdin',
      ])
    ).toEqual({
      email: 'admin@example.test',
      fullName: 'Platform Admin',
      passwordStdin: true,
    });
  });

  test('requires email and full name', () => {
    expect(() => parseArgs(['--email', 'admin@example.test'])).toThrow(
      '--full-name'
    );
    expect(() => parseArgs(['--full-name', 'Platform Admin'])).toThrow('--email');
  });

  test('requires password-stdin', () => {
    expect(() =>
      parseArgs(['--email', 'admin@example.test', '--full-name', 'Platform Admin'])
    ).toThrow('--password-stdin is required');
  });

  test('rejects passwords passed as command-line arguments', () => {
    expect(() =>
      parseArgs([
        '--email',
        'admin@example.test',
        '--full-name',
        'Platform Admin',
        '--password-stdin',
        '--password',
        'secret-value',
      ])
    ).toThrow('Passwords are not accepted as command-line arguments');
  });

  test('rejects duplicate options', () => {
    expect(() =>
      parseArgs([
        '--email',
        'first@example.test',
        '--email',
        'second@example.test',
        '--full-name',
        'Platform Admin',
        '--password-stdin',
      ])
    ).toThrow('--email was provided more than once');
  });

  test('rejects missing option values and unknown arguments', () => {
    expect(() => parseArgs(['--email', '--full-name', 'Platform Admin'])).toThrow(
      '--email requires a value'
    );
    expect(() =>
      parseArgs([
        '--email',
        'admin@example.test',
        '--full-name',
        'Platform Admin',
        '--password-stdin',
        '--verbose',
      ])
    ).toThrow('Unknown argument: --verbose');
  });
});
