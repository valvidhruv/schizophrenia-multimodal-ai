import { Router } from 'express';
import type { AppConfig } from '../config';
import { createAuthenticate } from '../middleware/auth';
import { createAuditMiddleware } from '../middleware/audit';
import { apiNotFoundHandler } from '../middleware/errorHandler';
import { rateLimit } from '../middleware/rateLimit';
import type { AuditRecorder } from '../services/auditService';
import type { PatientStore } from '../services/patientService';
import { createAnalysisRouter } from './analysis';
import { createClinicalRouter } from './clinical';
import { createFilesRouter } from './files';
import { createPatientsRouter } from './patients';
import { createReportsRouter } from './reports';

export interface ApiRouterOptions {
  config: AppConfig;
  auditRecorder: AuditRecorder;
  now: () => number;
  patientStore?: PatientStore;
}

export function createApiRouter(options: ApiRouterOptions): Router {
  const { config, auditRecorder, now, patientStore } = options;
  const router = Router();

  router.use(createAuditMiddleware(auditRecorder));
  router.use(
    rateLimit({ windowMs: config.rateLimit.windowMs, max: config.rateLimit.max, now })
  );
  router.use(createAuthenticate(config));

  router.use('/patients', createPatientsRouter(patientStore));
  router.use('/patients', createFilesRouter(now));
  router.use('/patients', createClinicalRouter());
  router.use('/analysis', createAnalysisRouter(now));
  router.use(createReportsRouter(now));

  router.use(apiNotFoundHandler);

  return router;
}
