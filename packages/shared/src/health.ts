import { z } from 'zod';

export const healthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  db: z.enum(['ok', 'error']),
  version: z.string(),
  time: z.iso.datetime(),
});

export type Health = z.infer<typeof healthSchema>;
