import type { PoolClient } from 'pg';
import {
  query as defaultQuery,
  sanitizeDatabaseError,
  withTransaction as defaultWithTransaction,
} from '../db';
import { ApiError } from '../errors';
import type { Role } from '../types';

export interface AuthUserRecord {
  id: string;
  email: string;
  passwordHash: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  lastLogin: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAuthUserInput {
  email: string;
  passwordHash: string;
  fullName: string;
  role: Role;
}

export interface CreateLoginSessionInput {
  userId: string;
  expectedPasswordHash: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface RotateRefreshTokenInput {
  currentTokenHash: string;
  newTokenHash: string;
}

export type CreateLoginSessionResult = 'created' | 'stale' | 'missing';
export type ChangePasswordResult = 'changed' | 'stale' | 'missing';

export interface AuthStore {
  findUserByEmail(email: string): Promise<AuthUserRecord | null>;
  findUserById(id: string): Promise<AuthUserRecord | null>;
  createUser(input: CreateAuthUserInput): Promise<AuthUserRecord>;
  updateProfile(userId: string, fullName: string): Promise<AuthUserRecord | null>;
  changePassword(
    userId: string,
    expectedPasswordHash: string,
    newPasswordHash: string
  ): Promise<ChangePasswordResult>;
  createLoginSession(input: CreateLoginSessionInput): Promise<CreateLoginSessionResult>;
  rotateRefreshToken(input: RotateRefreshTokenInput): Promise<AuthUserRecord | null>;
  revokeRefreshToken(tokenHash: string): Promise<void>;
}

export type AuthQueryFn = <T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
) => Promise<T[]>;

export interface AuthQueryResult<T> {
  rows: T[];
  rowCount: number | null;
}

export interface AuthClient {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ): Promise<AuthQueryResult<T>>;
}

export type AuthTransactionFn = <T>(
  fn: (client: AuthClient) => Promise<T>
) => Promise<T>;

export interface SqlAuthStoreOptions {
  queryFn?: AuthQueryFn;
  withTransactionFn?: AuthTransactionFn;
}

interface AuthUserRow {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  last_login: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface RefreshTokenLockRow {
  id: string;
  user_id: string;
  family_id: string;
  expires_at: Date | string;
  revoked_at: Date | string | null;
  expired: boolean;
}

const USER_COLUMNS = [
  'id',
  'email',
  'password_hash',
  'full_name',
  'role',
  'is_active',
  'last_login',
  'created_at',
  'updated_at',
].join(', ');

const USER_COLUMNS_PREFIXED = USER_COLUMNS.split(', ')
  .map((column) => `u.${column}`)
  .join(', ');

const EMAIL_UNIQUE_CONSTRAINT = 'users_email_key';

function mapUser(row: AuthUserRow): AuthUserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    fullName: row.full_name,
    role: row.role,
    isActive: row.is_active,
    lastLogin: row.last_login ? new Date(row.last_login).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function isEmailUniqueViolation(err: unknown): boolean {
  const candidate = err as { code?: unknown; constraint?: unknown } | null;
  return (
    candidate?.code === '23505' && candidate?.constraint === EMAIL_UNIQUE_CONSTRAINT
  );
}

function storeFailure(err: unknown): Error {
  return new Error(`Auth store operation failed: ${sanitizeDatabaseError(err)}`);
}

export function createSqlAuthStore(options: SqlAuthStoreOptions = {}): AuthStore {
  const queryFn = options.queryFn ?? defaultQuery;
  const withTransactionFn: AuthTransactionFn =
    options.withTransactionFn ??
    (<T>(fn: (client: AuthClient) => Promise<T>) =>
      defaultWithTransaction((client: PoolClient) => fn(client)));

  return {
    async findUserByEmail(email) {
      try {
        const rows = await queryFn<AuthUserRow>(
          `SELECT ${USER_COLUMNS} FROM users WHERE email = $1`,
          [email]
        );
        const row = rows[0];
        return row ? mapUser(row) : null;
      } catch (err) {
        throw storeFailure(err);
      }
    },

    async findUserById(id) {
      try {
        const rows = await queryFn<AuthUserRow>(
          `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`,
          [id]
        );
        const row = rows[0];
        return row ? mapUser(row) : null;
      } catch (err) {
        throw storeFailure(err);
      }
    },

    async createUser(input) {
      let rows: AuthUserRow[];
      try {
        rows = await queryFn<AuthUserRow>(
          `INSERT INTO users (email, password_hash, full_name, role)
           VALUES ($1, $2, $3, $4)
           RETURNING ${USER_COLUMNS}`,
          [input.email, input.passwordHash, input.fullName, input.role]
        );
      } catch (err) {
        if (isEmailUniqueViolation(err)) {
          throw ApiError.conflict('A user with this email already exists.');
        }
        throw storeFailure(err);
      }
      const row = rows[0];
      if (!row) {
        throw new Error('User insert returned no row');
      }
      return mapUser(row);
    },

    async updateProfile(userId, fullName) {
      try {
        const rows = await queryFn<AuthUserRow>(
          `UPDATE users
           SET full_name = $2, updated_at = NOW()
           WHERE id = $1 AND is_active = true
           RETURNING ${USER_COLUMNS}`,
          [userId, fullName]
        );
        const row = rows[0];
        return row ? mapUser(row) : null;
      } catch (err) {
        throw storeFailure(err);
      }
    },

    async changePassword(userId, expectedPasswordHash, newPasswordHash) {
      try {
        return await withTransactionFn(async (client) => {
          const locked = await client.query<{ id: string; password_hash: string }>(
            `SELECT id, password_hash
             FROM users
             WHERE id = $1 AND is_active = true
             FOR UPDATE`,
            [userId]
          );
          const user = locked.rows[0];
          if (!user) {
            return 'missing';
          }
          if (user.password_hash !== expectedPasswordHash) {
            return 'stale';
          }

          const updated = await client.query(
            `UPDATE users
             SET password_hash = $3, updated_at = NOW()
             WHERE id = $1 AND password_hash = $2 AND is_active = true`,
            [userId, expectedPasswordHash, newPasswordHash]
          );
          if ((updated.rowCount ?? 0) === 0) {
            return 'stale';
          }

          await client.query(
            `UPDATE refresh_tokens
             SET revoked_at = NOW()
             WHERE user_id = $1 AND revoked_at IS NULL`,
            [userId]
          );
          return 'changed';
        });
      } catch (err) {
        throw storeFailure(err);
      }
    },

    async createLoginSession(input) {
      try {
        return await withTransactionFn(async (client) => {
          const locked = await client.query<{ id: string; password_hash: string }>(
            `SELECT id, password_hash
             FROM users
             WHERE id = $1 AND is_active = true
             FOR UPDATE`,
            [input.userId]
          );
          const user = locked.rows[0];
          if (!user) {
            return 'missing';
          }
          if (user.password_hash !== input.expectedPasswordHash) {
            return 'stale';
          }

          await client.query('UPDATE users SET last_login = NOW() WHERE id = $1', [
            input.userId,
          ]);
          await client.query(
            `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
             VALUES ($1, $2, $3, $4)`,
            [input.userId, input.familyId, input.tokenHash, input.expiresAt]
          );
          return 'created';
        });
      } catch (err) {
        throw storeFailure(err);
      }
    },

    async rotateRefreshToken(input) {
      try {
        return await withTransactionFn(async (client) => {
          const selected = await client.query<AuthUserRow>(
            `SELECT ${USER_COLUMNS_PREFIXED}
             FROM users u
             JOIN refresh_tokens rt ON rt.user_id = u.id
             WHERE rt.token_hash = $1
               AND u.is_active = true
             FOR UPDATE OF u`,
            [input.currentTokenHash]
          );
          const user = selected.rows[0];
          if (!user) {
            return null;
          }

          const locked = await client.query<RefreshTokenLockRow>(
            `SELECT id, user_id, family_id, expires_at, revoked_at,
                    expires_at <= NOW() AS expired
             FROM refresh_tokens
             WHERE token_hash = $1
             FOR UPDATE`,
            [input.currentTokenHash]
          );
          const token = locked.rows[0];
          if (!token) {
            return null;
          }

          if (token.revoked_at !== null) {
            await client.query(
              `UPDATE refresh_tokens
               SET revoked_at = NOW()
               WHERE family_id = $1 AND revoked_at IS NULL`,
              [token.family_id]
            );
            return null;
          }

          if (token.expired) {
            return null;
          }

          const inserted = await client.query<{ id: string }>(
            `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
             VALUES ($1, $2, $3, $4)
             RETURNING id`,
            [token.user_id, token.family_id, input.newTokenHash, token.expires_at]
          );
          const newToken = inserted.rows[0];
          if (!newToken) {
            throw new Error('Refresh token insert returned no row');
          }

          await client.query(
            `UPDATE refresh_tokens
             SET revoked_at = NOW(), replaced_by = $2
             WHERE id = $1`,
            [token.id, newToken.id]
          );

          return mapUser(user);
        });
      } catch (err) {
        throw storeFailure(err);
      }
    },

    async revokeRefreshToken(tokenHash) {
      try {
        await withTransactionFn(async (client) => {
          const selected = await client.query<{ user_id: string; family_id: string }>(
            `SELECT user_id, family_id
             FROM refresh_tokens
             WHERE token_hash = $1`,
            [tokenHash]
          );
          const token = selected.rows[0];
          if (!token) {
            return;
          }

          await client.query(
            `SELECT id
             FROM users
             WHERE id = $1
             FOR UPDATE`,
            [token.user_id]
          );
          await client.query(
            `UPDATE refresh_tokens
             SET revoked_at = NOW()
             WHERE family_id = $1 AND revoked_at IS NULL`,
            [token.family_id]
          );
        });
      } catch (err) {
        throw storeFailure(err);
      }
    },
  };
}
