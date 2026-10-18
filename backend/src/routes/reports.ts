import { Router } from 'express';
import { requireRole } from '../middleware/auth';
import { notImplemented } from '../middleware/notImplemented';
import { rateLimit } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { patientIdParamsSchema } from '../schemas/analysis';
import { createReportBodySchema, reportParamsSchema } from '../schemas/report';

export function createReportsRouter(now: () => number): Router {
  const router = Router();

  router.post(
    '/reports',
    requireRole('admin', 'clinician'),
    rateLimit({ windowMs: 60000, max: 10, now }),
    validate({ body: createReportBodySchema }),
    notImplemented('Report generation')
  );

  router.get(
    '/reports/:reportId',
    validate({ params: reportParamsSchema }),
    notImplemented('Report status')
  );

  router.get(
    '/reports/:reportId/download',
    validate({ params: reportParamsSchema }),
    notImplemented('Report download')
  );

  router.get(
    '/patients/:patientId/reports',
    validate({ params: patientIdParamsSchema }),
    notImplemented('Patient report listing')
  );

  return router;
}
