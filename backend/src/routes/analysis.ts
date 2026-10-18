import { Router } from 'express';
import { requireRole } from '../middleware/auth';
import { notImplemented } from '../middleware/notImplemented';
import { rateLimit } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import {
  analysisJobParamsSchema,
  createJobBodySchema,
  listJobsQuerySchema,
  patientIdParamsSchema,
  resultParamsSchema,
} from '../schemas/analysis';

export function createAnalysisRouter(now: () => number): Router {
  const router = Router();

  router.post(
    '/jobs',
    requireRole('admin', 'clinician'),
    rateLimit({ windowMs: 60000, max: 20, now }),
    validate({ body: createJobBodySchema }),
    notImplemented('Analysis job creation')
  );

  router.get(
    '/jobs',
    validate({ query: listJobsQuerySchema }),
    notImplemented('Analysis job listing')
  );

  router.get(
    '/jobs/:jobId',
    validate({ params: analysisJobParamsSchema }),
    notImplemented('Analysis job status')
  );

  router.post(
    '/jobs/:jobId/cancel',
    requireRole('admin', 'clinician'),
    rateLimit({ windowMs: 60000, max: 20, now }),
    validate({ params: analysisJobParamsSchema }),
    notImplemented('Analysis job cancellation')
  );

  router.get(
    '/patients/:patientId/latest',
    validate({ params: patientIdParamsSchema }),
    notImplemented('Latest analysis results')
  );

  router.get(
    '/patients/:patientId/history',
    validate({ params: patientIdParamsSchema }),
    notImplemented('Analysis history')
  );

  router.get(
    '/results/:resultId',
    validate({ params: resultParamsSchema }),
    notImplemented('Analysis result')
  );

  router.get(
    '/results/:resultId/explanations',
    validate({ params: resultParamsSchema }),
    notImplemented('Result explanations')
  );

  return router;
}
