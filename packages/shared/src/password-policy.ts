/**
 * Password policy — ONE definition used by the API (enforcement) and the web app (live checklist).
 * Policy applies when a password is SET; existing passwords keep working for login.
 * Letters include Hebrew/Arabic/any script (\p{L}); a "symbol" is anything that is not a
 * letter, digit or whitespace (e.g. ! @ # $ % - _ .).
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 256; // bounds hashing cost for huge inputs

export const PASSWORD_RULES = [
  'PASSWORD_TOO_SHORT',
  'PASSWORD_NEEDS_LETTER',
  'PASSWORD_NEEDS_DIGIT',
  'PASSWORD_NEEDS_SYMBOL',
  'PASSWORD_WHITESPACE_EDGES',
  'PASSWORD_CONTAINS_EMAIL',
  'PASSWORD_TOO_LONG',
] as const;
export type PasswordRule = (typeof PASSWORD_RULES)[number];

/** Every rule the password currently breaks (empty array = acceptable), in display order. */
export function passwordProblems(password: string, email = ''): PasswordRule[] {
  const problems: PasswordRule[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) problems.push('PASSWORD_TOO_SHORT');
  if (!/\p{L}/u.test(password)) problems.push('PASSWORD_NEEDS_LETTER');
  if (!/\p{Nd}/u.test(password)) problems.push('PASSWORD_NEEDS_DIGIT');
  if (!/[^\p{L}\p{N}\s]/u.test(password)) problems.push('PASSWORD_NEEDS_SYMBOL');
  if (password.length > 0 && password.trim() !== password) {
    problems.push('PASSWORD_WHITESPACE_EDGES');
  }
  const local = email.split('@')[0]?.trim().toLowerCase() ?? '';
  if (local.length >= 3 && password.toLowerCase().includes(local)) {
    problems.push('PASSWORD_CONTAINS_EMAIL');
  }
  if (password.length > PASSWORD_MAX_LENGTH) problems.push('PASSWORD_TOO_LONG');
  return problems;
}
