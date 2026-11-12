import dotenv from 'dotenv';
import { closeDatabase, initDatabase } from '../db';
import { loadConfig } from '../config';
import { registerBodySchema } from '../schemas/auth';
import { createSqlAuthStore } from '../services/authStore';
import { AuthService } from '../services/authService';

interface CreateAdminArgs {
  email: string;
  fullName: string;
  passwordStdin: boolean;
}

const USAGE =
  'Usage: npm run create-admin -- --email <email> --full-name <name> --password-stdin';

function readOptionValue(argv: string[], index: number, name: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

export function parseArgs(argv: string[]): CreateAdminArgs {
  let email: string | undefined;
  let fullName: string | undefined;
  let passwordStdin = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--email') {
      if (email !== undefined) {
        throw new Error('--email was provided more than once');
      }
      email = readOptionValue(argv, index, '--email');
      index += 1;
      continue;
    }
    if (arg === '--full-name') {
      if (fullName !== undefined) {
        throw new Error('--full-name was provided more than once');
      }
      fullName = readOptionValue(argv, index, '--full-name');
      index += 1;
      continue;
    }
    if (arg === '--password-stdin') {
      passwordStdin = true;
      continue;
    }
    if (arg === '--password' || arg.startsWith('--password=')) {
      throw new Error('Passwords are not accepted as command-line arguments');
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!email || !fullName) {
    throw new Error(`${USAGE}`);
  }
  if (!passwordStdin) {
    throw new Error(`--password-stdin is required. ${USAGE}`);
  }

  return { email, fullName, passwordStdin };
}

async function readPasswordFromStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error(
      'Pipe the password through stdin; interactive password entry is not supported'
    );
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks)
    .toString('utf8')
    .replace(/\r?\n$/, '');
}

async function main(): Promise<void> {
  dotenv.config();
  const args = parseArgs(process.argv.slice(2));
  const password = await readPasswordFromStdin();
  const parsed = registerBodySchema.safeParse({
    email: args.email,
    fullName: args.fullName,
    role: 'admin',
    password,
  });
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
        .join('; ')
    );
  }

  const config = loadConfig(process.env);
  const { configured } = initDatabase({
    ...process.env,
    DATABASE_URL: config.databaseUrl ?? '',
  });
  if (!configured) {
    throw new Error('DATABASE_URL is required to create an administrator');
  }

  try {
    const service = new AuthService({
      store: createSqlAuthStore(),
      accessTokenSecret: config.auth.accessTokenSecret,
      accessTokenTtlSeconds: config.auth.accessTokenTtlSeconds,
      refreshTokenTtlSeconds: config.auth.refreshTokenTtlSeconds,
    });
    const user = await service.register(parsed.data);
    console.log(`Created administrator ${user.email} (${user.id})`);
  } finally {
    await closeDatabase();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(
      err instanceof Error ? err.message : 'Administrator creation failed'
    );
    process.exitCode = 1;
  });
}
