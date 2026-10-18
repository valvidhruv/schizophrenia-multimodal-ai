import { Router } from 'express';
import { requireRole } from '../middleware/auth';
import { notImplemented } from '../middleware/notImplemented';
import { validate } from '../middleware/validate';
import {
  createPatientBodySchema,
  listPatientsQuerySchema,
  patientParamsSchema,
  updatePatientBodySchema,
} from '../schemas/patient';

export function createPatientsRouter(): Router {
  const router = Router();

  router.get(
    '/',
    validate({ query: listPatientsQuerySchema }),
    notImplemented('Patient listing')
  );

  router.post(
    '/',
    requireRole('admin', 'clinician'),
    validate({ body: createPatientBodySchema }),
    notImplemented('Patient creation')
  );

  router.get(
    '/:id',
    validate({ params: patientParamsSchema }),
    notImplemented('Patient detail')
  );

  router.put(
    '/:id',
    requireRole('admin', 'clinician'),
    validate({ params: patientParamsSchema, body: updatePatientBodySchema }),
    notImplemented('Patient update')
  );

  router.delete(
    '/:id',
    requireRole('admin'),
    validate({ params: patientParamsSchema }),
    notImplemented('Patient deletion')
  );

  return router;
}
