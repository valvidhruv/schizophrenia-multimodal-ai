import { z } from 'zod';
import { DATE_PATTERN, paginationSchema, uuidSchema } from './common';

const panssItem = z.number().int().min(1).max(7);

export const panssBodySchema = z.object({
  assessmentDate: z.string().regex(DATE_PATTERN, 'must be formatted YYYY-MM-DD'),
  p1: panssItem,
  p2: panssItem,
  p3: panssItem,
  p4: panssItem,
  p5: panssItem,
  p6: panssItem,
  p7: panssItem,
  n1: panssItem,
  n2: panssItem,
  n3: panssItem,
  n4: panssItem,
  n5: panssItem,
  n6: panssItem,
  n7: panssItem,
  g1: panssItem,
  g2: panssItem,
  g3: panssItem,
  g4: panssItem,
  g5: panssItem,
  g6: panssItem,
  g7: panssItem,
  g8: panssItem,
  g9: panssItem,
  g10: panssItem,
  g11: panssItem,
  g12: panssItem,
  g13: panssItem,
  g14: panssItem,
  g15: panssItem,
  g16: panssItem,
  notes: z.string().max(2000).optional(),
  raterId: uuidSchema.optional(),
});

export const panssHistoryQuerySchema = paginationSchema;
