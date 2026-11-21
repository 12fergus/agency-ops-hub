import type { z } from 'zod';
import { AppError } from './errors.js';

/**
 * Validates untrusted input at the HTTP boundary. Error details list field paths and issue
 * codes only — never the submitted values (could be passwords or PII).
 */
export function parseInput<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  throw new AppError(
    422,
    'VALIDATION',
    'Invalid input',
    result.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code })),
  );
}
