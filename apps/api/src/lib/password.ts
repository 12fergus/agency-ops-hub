import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordProblems,
  type PasswordRule,
} from '@agency-crm/shared';

export { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH };

/**
 * Argon2id via Node's built-in crypto (no native dependency).
 * Parameters: OWASP Password Storage Cheat Sheet minimum (m=19 MiB, t=2, p=1).
 * Stored in PHC string format so parameters can be raised later without breaking old hashes.
 */
const PARAMS = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 } as const;
const SALT_BYTES = 16;

function derive(
  password: string,
  salt: Buffer,
  p: { memory: number; passes: number; parallelism: number; tagLength: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    argon2(
      'argon2id',
      {
        message: Buffer.from(password.normalize('NFKC'), 'utf8'),
        nonce: salt,
        memory: p.memory,
        passes: p.passes,
        parallelism: p.parallelism,
        tagLength: p.tagLength,
      },
      (err, key) => (err ? reject(err) : resolve(key)),
    ),
  );
}

const b64 = (b: Buffer) => b.toString('base64').replace(/=+$/, '');

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, PARAMS);
  return `$argon2id$v=19$m=${PARAMS.memory},t=${PARAMS.passes},p=${PARAMS.parallelism}$${b64(salt)}$${b64(hash)}`;
}

const PHC_RE = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

/** True if the stored value is a real Argon2id hash (not a placeholder like '!unusable'). */
export const isPasswordHash = (encoded: string): boolean => PHC_RE.test(encoded);

/** Constant-time comparison. Malformed/placeholder hashes (e.g. '!unusable') never verify. */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const m = PHC_RE.exec(encoded);
  if (!m || password.length > PASSWORD_MAX_LENGTH) return false;
  const expected = Buffer.from(m[5]!, 'base64');
  const actual = await derive(password, Buffer.from(m[4]!, 'base64'), {
    memory: Number(m[1]),
    passes: Number(m[2]),
    parallelism: Number(m[3]),
    tagLength: expected.length,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Hash of a random password, used to spend equal time when the user doesn't exist. */
let dummyHash: Promise<string> | undefined;
export function dummyVerify(password: string): Promise<boolean> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  return dummyHash.then((h) => verifyPassword(password, h)).then(() => false);
}

/**
 * Enforces the shared policy (packages/shared/src/password-policy.ts — the same rules the web
 * form shows live). Returns the first broken rule's code, or null when acceptable.
 */
export function checkPasswordPolicy(password: string, email: string): PasswordRule | null {
  return passwordProblems(password, email)[0] ?? null;
}
