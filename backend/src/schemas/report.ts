import { z } from 'zod';
import { uuidSchema } from './common';

export const reportParamsSchema = z.object({
  reportId: uuidSchema,
});

export const createReportBodySchema = z.object({
  patientId: uuidSchema,
  reportType: z.enum(['analysis_summary', 'comprehensive', 'follow_up', 'custom']),
  includedResultIds: z.array(uuidSchema).optional(),
  templateVersion: z.string().max(20).optional(),
});
