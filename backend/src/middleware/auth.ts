import type { RequestHandler } from 'express';
import type { AppConfig } from '../config';
import { ApiError } from '../errors';
import { verifyAccessToken } from '../services/tokenService';
import type { AuthPrincipal, Role } from '../types';
import { asyncHandler } from './asyncHandler';

const BEARER_PATTERN = /^Bearer\s+(\S+)$/i;

export type PrincipalValidator = (
  principal: AuthPrincipal
) => Promise<AuthPrincipal | null>;

export function createAuthenticate(
  config: AppConfig,
  validatePrincipal?: PrincipalValidator
): RequestHandler {
  return asyncHandler(async (req, _res, next) => {
    const secret = config.auth.accessTokenSecret;
    if (!secret) {
      throw new ApiError(
        501,
        'AUTH_NOT_CONFIGURED',
        'Authentication is not configured on this server.'
      );
    }
    const header = (req.get('authorization') ?? '').trim();
    const match = BEARER_PATTERN.exec(header);
    if (!match) {
      throw ApiError.unauthorized('A Bearer access token is required.');
    }

    let tokenPrincipal: AuthPrincipal;
    try {
      tokenPrincipal = verifyAccessToken(match[1], secret);
    } catch {
      throw ApiError.unauthorized('The access token is invalid or expired.');
    }

    if (!validatePrincipal) {
      throw ApiError.authUnavailable();
    }

    let principal: AuthPrincipal | null;
    try {
      principal = await validatePrincipal(tokenPrincipal);
    } catch (err) {
      if (err instanceof ApiError) {
        throw err;
      }
      throw ApiError.authUnavailable();
    }

    if (!principal) {
      throw ApiError.unauthorized('The access token is invalid or expired.');
    }

    req.auth = principal;
    next();
  });
}

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    const principal = req.auth;
    if (!principal) {
      next(ApiError.unauthorized('A Bearer access token is required.'));
      return;
    }
    if (!roles.includes(principal.role)) {
      next(ApiError.forbidden());
      return;
    }
    next();
  };
}
