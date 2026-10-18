import { z } from 'zod';
import { paginationSchema, uuidSchema } from './common';

export const analysisJobParamsSchema = z.object({
  jobId: uuidSchema,
});

export const resultParamsSchema = z.object({
  resultId: uuidSchema,
});

export const patientIdParamsSchema = z.object({
  patientId: uuidSchema,
});

export const createJobBodySchema = z.object({
  patientId: uuidSchema,
  jobType: z.enum(['eeg', 'smri', 'fmri', 'fusion', 'full_pipeline']),
  inputFileIds: z.array(uuidSchema).min(1).optional(),
  parameters: z.record(z.unknown()).optional(),
});

export const listJobsQuerySchema = paginationSchema.extend({
  patientId: uuidSchema.optional(),
  status: z.enum([
    'pending',
    'queued',
    'running',
    'completed',
    'failed',
    'cancelled',
  ]).optional(),
});
