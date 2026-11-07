import { z } from 'zod';
import { paginationSchema, uuidSchema } from './common';

export const DIAGNOSIS_VALUES = [
  'schizophrenia',
  'healthy_control',
  'bipolar',
  'schizoaffective',
  'other',
  'unknown',
] as const;

export const patientParamsSchema = z.object({
  id: uuidSchema,
});

export const createPatientBodySchema = z.object({
  subjectId: z.string().min(1, 'subjectId is required').max(100),
  diagnosis: z.enum(DIAGNOSIS_VALUES).optional(),
  age: z.number().int().min(0).max(120).optional(),
  sex: z.enum(['male', 'female', 'other', 'unknown']).optional(),
  handedness: z.enum(['right', 'left', 'ambidextrous', 'unknown']).optional(),
});

export const updatePatientBodySchema = createPatientBodySchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
    path: ['(root)'],
  });

export const listPatientsQuerySchema = paginationSchema
  .extend({
    diagnosis: z.enum(DIAGNOSIS_VALUES).optional(),
    search: z.string().max(100).optional(),
  })
  .superRefine((value, ctx) => {
    const offset = (value.page - 1) * value.limit;
    if (!Number.isSafeInteger(offset)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['page'],
        message: 'page is too large',
      });
    }
  });
