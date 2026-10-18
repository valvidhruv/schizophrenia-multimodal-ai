import { z } from 'zod';
import { uuidSchema } from './common';

export const uploadParamsSchema = z.object({
  id: uuidSchema,
  modality: z.enum(['eeg', 'smri', 'fmri']),
});

export const fileParamsSchema = z.object({
  id: uuidSchema,
  fileId: uuidSchema,
});
