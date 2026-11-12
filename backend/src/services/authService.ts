import crypto from 'crypto';
import { ApiError } from '../errors';
import type { AuthPrincipal, Role } from '../types';
import type { AuthStore, AuthUserRecord } from './authStore';
import { hashPassword, verifyPassword } from './passwordService';
import { signAccessToken } from './tokenService';

export interface TokenUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
}

export interface PublicUser extends TokenUser {
  isActive: boolean;
  lastLogin: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  user: TokenUser;
}

export interface AuthResult {
  session: AuthSession;
  principal: AuthPrincipal;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterUserInput {
  email: string;
  fullName: string;
  role: Role;
  password: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface AuthServiceOptions {
  store: AuthStore;
  accessTokenSecret: string | null;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  now?: () => number;
  generateRefreshToken?: () => string;
  generateFamilyId?: () => string;
}

const DUMMY_PASSWORD = 'invalid-password-placeholder';
let dummyHashPromise: Promise<string> | null = null;

function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword(DUMMY_PASSWORD);
  }
  return dummyHashPromise;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function toTokenUser(user: AuthUserRecord): TokenUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
  };
}

function toPublicUser(user: AuthUserRecord): PublicUser {
  return {
    ...toTokenUser(user),
    isActive: user.isActive,
    lastLogin: user.lastLogin,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export class AuthService {
  private readonly store: AuthStore;
  private readonly accessTokenSecret: string | null;
  private readonly accessTokenTtlSeconds: number;
  private readonly refreshTokenTtlSeconds: number;
  private readonly now: () => number;
  private readonly generateRefreshToken: () => string;
  private readonly generateFamilyId: () => string;

  constructor(options: AuthServiceOptions) {
    this.store = options.store;
    this.accessTokenSecret = options.accessTokenSecret;
    this.accessTokenTtlSeconds = options.accessTokenTtlSeconds;
    this.refreshTokenTtlSeconds = options.refreshTokenTtlSeconds;
    this.now = options.now ?? Date.now;
    this.generateRefreshToken =
      options.generateRefreshToken ??
      (() => crypto.randomBytes(32).toString('base64url'));
    this.generateFamilyId = options.generateFamilyId ?? (() => crypto.randomUUID());
  }

  async login(input: LoginInput): Promise<AuthResult> {
    this.requireAccessSecret();
    const user = await this.store.findUserByEmail(normalizeEmail(input.email));
    const passwordHash = user?.passwordHash ?? (await getDummyHash());
    const passwordMatches = await verifyPassword(input.password, passwordHash);
    if (!user || !passwordMatches || !user.isActive) {
      throw ApiError.unauthorized('Invalid email or password.');
    }

    return this.createSession(user, passwordHash);
  }

  async register(input: RegisterUserInput): Promise<PublicUser> {
    const passwordHash = await hashPassword(input.password);
    const user = await this.store.createUser({
      email: normalizeEmail(input.email),
      passwordHash,
      fullName: input.fullName,
      role: input.role,
    });
    return toPublicUser(user);
  }

  async refresh(refreshToken: string): Promise<AuthResult> {
    this.requireAccessSecret();
    const replacement = this.generateRefreshToken();
    const user = await this.store.rotateRefreshToken({
      currentTokenHash: hashRefreshToken(refreshToken),
      newTokenHash: hashRefreshToken(replacement),
    });
    if (!user) {
      throw ApiError.unauthorized('The refresh token is invalid or expired.');
    }
    return this.buildSession(user, replacement);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.store.revokeRefreshToken(hashRefreshToken(refreshToken));
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.store.findUserById(userId);
    if (!user || !user.isActive) {
      throw ApiError.unauthorized('Your session is no longer valid.');
    }
    return toPublicUser(user);
  }

  async updateProfile(userId: string, fullName: string): Promise<PublicUser> {
    const user = await this.store.updateProfile(userId, fullName);
    if (!user) {
      throw ApiError.unauthorized('Your session is no longer valid.');
    }
    return toPublicUser(user);
  }

  async changePassword(userId: string, input: ChangePasswordInput): Promise<void> {
    const user = await this.store.findUserById(userId);
    if (!user || !user.isActive) {
      throw ApiError.unauthorized('Your session is no longer valid.');
    }
    if (input.currentPassword === input.newPassword) {
      throw ApiError.invalidInput([
        {
          field: 'newPassword',
          message: 'New password must be different from the current password.',
        },
      ]);
    }
    const currentMatches = await verifyPassword(
      input.currentPassword,
      user.passwordHash
    );
    if (!currentMatches) {
      throw ApiError.unauthorized('Current password is incorrect.');
    }
    const passwordHash = await hashPassword(input.newPassword);
    const changed = await this.store.changePassword(
      user.id,
      user.passwordHash,
      passwordHash
    );
    if (changed === 'stale') {
      throw ApiError.unauthorized('Current password is incorrect.');
    }
    if (changed === 'missing') {
      throw ApiError.unauthorized('Your session is no longer valid.');
    }
  }

  async validatePrincipal(principal: AuthPrincipal): Promise<AuthPrincipal | null> {
    const user = await this.store.findUserById(principal.userId);
    if (!user || !user.isActive || user.role !== principal.role) {
      return null;
    }
    return principal;
  }

  private requireAccessSecret(): string {
    if (!this.accessTokenSecret) {
      throw new ApiError(
        501,
        'AUTH_NOT_CONFIGURED',
        'Authentication is not configured on this server.'
      );
    }
    return this.accessTokenSecret;
  }

  private async createSession(
    user: AuthUserRecord,
    expectedPasswordHash: string
  ): Promise<AuthResult> {
    const refreshToken = this.generateRefreshToken();
    const created = await this.store.createLoginSession({
      userId: user.id,
      expectedPasswordHash,
      familyId: this.generateFamilyId(),
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: new Date(this.now() + this.refreshTokenTtlSeconds * 1000),
    });
    if (created !== 'created') {
      throw ApiError.unauthorized('Invalid email or password.');
    }
    return this.buildSession(user, refreshToken);
  }

  private buildSession(user: AuthUserRecord, refreshToken: string): AuthResult {
    const secret = this.requireAccessSecret();
    const issuedAt = Math.floor(this.now() / 1000);
    const expiresAt = issuedAt + this.accessTokenTtlSeconds;
    const accessToken = signAccessToken(
      { userId: user.id, role: user.role },
      secret,
      this.accessTokenTtlSeconds,
      issuedAt
    );
    return {
      session: {
        accessToken,
        refreshToken,
        user: toTokenUser(user),
      },
      principal: {
        userId: user.id,
        role: user.role,
        iat: issuedAt,
        exp: expiresAt,
      },
    };
  }
}
