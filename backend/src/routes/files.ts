import { Router } from 'express';
import { requireRole } from '../middleware/auth';
import { notImplemented } from '../middleware/notImplemented';
import { rateLimit } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { fileParamsSchema, uploadParamsSchema } from '../schemas/file';
import { patientParamsSchema } from '../schemas/patient';

export function createFilesRouter(now: () => number): Router {
  const router = Router();

  router.get(
    '/:id/files',
    validate({ params: patientParamsSchema }),
    notImplemented('Patient file listing')
  );

  router.post(
    '/:id/upload/:modality',
    requireRole('admin', 'clinician'),
    rateLimit({ windowMs: 60000, max: 5, now }),
    validate({ params: uploadParamsSchema }),
    notImplemented('File upload')
  );

  router.post(
    '/:id/files/:fileId/validate',
    requireRole('admin', 'clinician'),
    validate({ params: fileParamsSchema }),
    notImplemented('File validation')
  );

  return router;
}
