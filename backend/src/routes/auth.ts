import { Router, type Request, type RequestHandler } from 'express';
import type { AppConfig } from '../config';
import { DISCLAIMER } from '../constants';
import { ApiError } from '../errors';
import { createAuthenticate, requireRole, type PrincipalValidator } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { rateLimit } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import {
  changePasswordBodySchema,
  loginBodySchema,
  refreshTokenBodySchema,
  registerBodySchema,
  updateProfileBodySchema,
} from '../schemas/auth';
import type {
  AuthService,
  ChangePasswordInput,
  LoginInput,
  RegisterUserInput,
} from '../services/authService';

const AUTH_RATE_LIMIT_WINDOW_MS = 60000;
const AUTH_RATE_LIMIT_MAX = 10;

export interface AuthRouterOptions {
  service?: AuthService;
  config: AppConfig;
  validatePrincipal?: PrincipalValidator;
  now?: () => number;
}

function unavailable(): RequestHandler {
  return (_req, _res, next) => {
    next(
      new ApiError(
        501,
        'AUTH_NOT_CONFIGURED',
        'Authentication is not configured on this server.'
      )
    );
  };
}

function currentUserId(req: Request): string {
  if (!req.auth) {
    throw ApiError.unauthorized('A bearer access token is required.');
  }
  return req.auth.userId;
}

export function createAuthRouter(options: AuthRouterOptions): Router {
  const { service, config, validatePrincipal, now } = options;
  const router = Router();
  const authenticate = createAuthenticate(config, validatePrincipal);
  const authRateLimit = rateLimit({
    windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
    max: AUTH_RATE_LIMIT_MAX,
    now,
  });
  const fallback = unavailable();

  router.post(
    '/login',
    authRateLimit,
    validate({ body: loginBodySchema }),
    service
      ? asyncHandler(async (req, res) => {
          const result = await service.login(req.body as LoginInput);
          req.auth = result.principal;
          res.status(200).json({
            ...result.session,
            disclaimer: DISCLAIMER,
          });
        })
      : fallback
  );

  router.post(
    '/register',
    authenticate,
    requireRole('admin'),
    authRateLimit,
    validate({ body: registerBodySchema }),
    service
      ? asyncHandler(async (req, res) => {
          const user = await service.register(req.body as RegisterUserInput);
          res.status(201).json({ ...user, disclaimer: DISCLAIMER });
        })
      : fallback
  );

  router.post(
    '/refresh',
    authRateLimit,
    validate({ body: refreshTokenBodySchema }),
    service
      ? asyncHandler(async (req, res) => {
          const result = await service.refresh(req.body.refreshToken);
          req.auth = result.principal;
          res.status(200).json({
            ...result.session,
            disclaimer: DISCLAIMER,
          });
        })
      : fallback
  );

  router.post(
    '/logout',
    authRateLimit,
    validate({ body: refreshTokenBodySchema }),
    service
      ? asyncHandler(async (req, res) => {
          await service.logout(req.body.refreshToken);
          res.status(204).send();
        })
      : fallback
  );

  router.get(
    '/me',
    authenticate,
    service
      ? asyncHandler(async (req, res) => {
          const user = await service.me(currentUserId(req));
          res.status(200).json({ ...user, disclaimer: DISCLAIMER });
        })
      : fallback
  );

  router.put(
    '/me',
    authenticate,
    validate({ body: updateProfileBodySchema }),
    service
      ? asyncHandler(async (req, res) => {
          const user = await service.updateProfile(
            currentUserId(req),
            req.body.fullName
          );
          res.status(200).json({ ...user, disclaimer: DISCLAIMER });
        })
      : fallback
  );

  router.put(
    '/password',
    authenticate,
    authRateLimit,
    validate({ body: changePasswordBodySchema }),
    service
      ? asyncHandler(async (req, res) => {
          await service.changePassword(
            currentUserId(req),
            req.body as ChangePasswordInput
          );
          res.status(204).send();
        })
      : fallback
  );

  return router;
}
