import { Router } from 'express';
import type { AppConfig } from '../config';
import { createAuthenticate, type PrincipalValidator } from '../middleware/auth';
import { createAuditMiddleware } from '../middleware/audit';
import { apiNotFoundHandler } from '../middleware/errorHandler';
import { rateLimit } from '../middleware/rateLimit';
import type { AuditRecorder } from '../services/auditService';
import type { AuthService } from '../services/authService';
import type { PatientStore } from '../services/patientService';
import { createAnalysisRouter } from './analysis';
import { createAuthRouter } from './auth';
import { createClinicalRouter } from './clinical';
import { createFilesRouter } from './files';
import { createPatientsRouter } from './patients';
import { createReportsRouter } from './reports';

export interface ApiRouterOptions {
  config: AppConfig;
  auditRecorder: AuditRecorder;
  now: () => number;
  patientStore?: PatientStore;
  authService?: AuthService;
  validatePrincipal?: PrincipalValidator;
}

export function createApiRouter(options: ApiRouterOptions): Router {
  const { config, auditRecorder, now, patientStore, authService } = options;
  const router = Router();
  const validatePrincipal =
    options.validatePrincipal ??
    (authService
      ? (principal: Parameters<PrincipalValidator>[0]) =>
          authService.validatePrincipal(principal)
      : undefined);

  router.use(createAuditMiddleware(auditRecorder));
  router.use(
    rateLimit({ windowMs: config.rateLimit.windowMs, max: config.rateLimit.max, now })
  );
  router.use(
    '/auth',
    createAuthRouter({ service: authService, config, validatePrincipal, now })
  );
  router.use(createAuthenticate(config, validatePrincipal));

  router.use('/patients', createPatientsRouter(patientStore));
  router.use('/patients', createFilesRouter(now));
  router.use('/patients', createClinicalRouter());
  router.use('/analysis', createAnalysisRouter(now));
  router.use(createReportsRouter(now));

  router.use(apiNotFoundHandler);

  return router;
}
