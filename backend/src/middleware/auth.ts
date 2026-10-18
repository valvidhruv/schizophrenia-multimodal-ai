import type { RequestHandler } from 'express';
import type { AppConfig } from '../config';
import { ApiError } from '../errors';
import { verifyAccessToken } from '../services/tokenService';
import type { Role } from '../types';

const BEARER_PATTERN = /^Bearer\s+(\S+)$/i;

export function createAuthenticate(config: AppConfig): RequestHandler {
  return (req, _res, next) => {
    const secret = config.auth.accessTokenSecret;
    if (!secret) {
      next(
        new ApiError(
          501,
          'AUTH_NOT_CONFIGURED',
          'Authentication is not configured on this server.'
        )
      );
      return;
    }
    const header = (req.get('authorization') ?? '').trim();
    const match = BEARER_PATTERN.exec(header);
    if (!match) {
      next(ApiError.unauthorized('A Bearer access token is required.'));
      return;
    }
    try {
      req.auth = verifyAccessToken(match[1], secret);
    } catch {
      next(ApiError.unauthorized('The access token is invalid or expired.'));
      return;
    }
    next();
  };
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
