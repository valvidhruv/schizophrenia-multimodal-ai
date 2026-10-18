import { Router } from 'express';
import { requireRole } from '../middleware/auth';
import { notImplemented } from '../middleware/notImplemented';
import { validate } from '../middleware/validate';
import { panssBodySchema, panssHistoryQuerySchema } from '../schemas/clinical';
import { patientParamsSchema } from '../schemas/patient';

export function createClinicalRouter(): Router {
  const router = Router();

  router.post(
    '/:id/panss',
    requireRole('admin', 'clinician'),
    validate({ params: patientParamsSchema, body: panssBodySchema }),
    notImplemented('PANSS assessment storage')
  );

  router.get(
    '/:id/panss/history',
    validate({ params: patientParamsSchema, query: panssHistoryQuerySchema }),
    notImplemented('PANSS history')
  );

  router.get(
    '/:id/panss/latest',
    validate({ params: patientParamsSchema }),
    notImplemented('Latest PANSS assessment')
  );

  return router;
}
