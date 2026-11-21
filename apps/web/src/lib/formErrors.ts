import { t } from './i18n';

/** Structural type for a shared Zod schema (the web app doesn't depend on zod directly). */
interface SafeParser {
  safeParse(values: unknown):
    | { success: true }
    | {
        success: false;
        error: { issues: { path: PropertyKey[]; code: string; message: string }[] };
      };
}

/**
 * Validates form values with the SAME shared Zod schema the API uses and returns one Hebrew
 * message per field. Server errors (422 details) are mapped the same way via `serverFieldErrors`.
 */
export function fieldErrors(schema: SafeParser, values: unknown): Record<string, string> {
  const result = schema.safeParse(values);
  if (result.success) return {};
  return issuesToErrors(
    result.error.issues.map((i) => ({
      path: i.path.map(String).join('.'),
      code: i.code,
      message: i.message,
    })),
  );
}

interface IssueLike {
  path: string;
  code: string;
  message?: string | undefined;
}

function messageFor(issue: IssueLike): string {
  if (issue.message === 'PHONE_INVALID') return t('form.phoneInvalid');
  if (issue.path.endsWith('email') && issue.code !== 'too_big') return t('form.emailInvalid');
  if (issue.code === 'too_small') return t('form.required');
  if (issue.code === 'too_big') return t('form.tooLong');
  return t('form.invalid');
}

function issuesToErrors(issues: IssueLike[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path.split('.')[0] ?? '';
    if (field && !out[field]) out[field] = messageFor(issue);
  }
  return out;
}

/** Field errors from an API 422 response (`details: [{path, code}]`). */
export function serverFieldErrors(details: unknown): Record<string, string> {
  if (!Array.isArray(details)) return {};
  return issuesToErrors(
    details.filter(
      (d): d is IssueLike => typeof d === 'object' && d !== null && 'path' in d && 'code' in d,
    ),
  );
}
