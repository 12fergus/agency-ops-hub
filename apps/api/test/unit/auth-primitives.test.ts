import { describe, expect, it } from 'vitest';
import { readSessionCookie, serializeSessionCookie } from '../../src/lib/cookies.js';
import { checkPasswordPolicy, hashPassword, verifyPassword } from '../../src/lib/password.js';
import { RateLimiter } from '../../src/lib/rate-limit.js';

const PW = `Unit-${Math.random().toString(36).slice(2)}-pw!`;

describe('password hashing (Argon2id, built-in)', () => {
  it('round-trips, salts every hash, and rejects wrong/placeholder hashes', async () => {
    const a = await hashPassword(PW);
    const b = await hashPassword(PW);
    expect(a).not.toBe(b);
    expect(await verifyPassword(PW, a)).toBe(true);
    expect(await verifyPassword(`${PW}x`, a)).toBe(false);
    expect(await verifyPassword(PW, '!unusable')).toBe(false);
    expect(await verifyPassword(PW, '')).toBe(false);
  });

  it('server enforces the shared policy and reports the first broken rule', () => {
    expect(checkPasswordPolicy('Ab1!', 'a@b.test')).toBe('PASSWORD_TOO_SHORT');
    expect(checkPasswordPolicy('abcdefg12', 'a@b.test')).toBe('PASSWORD_NEEDS_SYMBOL');
    expect(checkPasswordPolicy(' Abc12!xy', 'a@b.test')).toBe('PASSWORD_WHITESPACE_EDGES');
    expect(checkPasswordPolicy('Dana-2026!', 'dana@b.test')).toBe('PASSWORD_CONTAINS_EMAIL');
    expect(checkPasswordPolicy('Abc12!xy', 'someone@b.test')).toBeNull(); // 8 chars is enough
    expect(checkPasswordPolicy(PW, 'someone@b.test')).toBeNull();
  });
});

describe('session cookie', () => {
  const token = 'A'.repeat(43);
  it('reads only a well-formed crm_session value', () => {
    expect(readSessionCookie(`other=1; crm_session=${token}; x=y`)).toBe(token);
    expect(readSessionCookie('crm_session=short')).toBeNull();
    expect(readSessionCookie(`crm_session=${token}"; evil`)).toBeNull();
    expect(readSessionCookie(undefined)).toBeNull();
  });
  it('serializes with HttpOnly, SameSite=Lax and optional Secure', () => {
    expect(serializeSessionCookie(token, { secure: true, maxAgeSeconds: 60 })).toBe(
      `crm_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=60; Secure`,
    );
  });
});

describe('RateLimiter', () => {
  it('blocks after max hits within the window and recovers after it', () => {
    let t = 0;
    const rl = new RateLimiter(2, 1000, () => t);
    rl.hit('k');
    expect(rl.retryAfter('k')).toBe(0);
    rl.hit('k');
    expect(rl.retryAfter('k')).toBe(1);
    t = 1000;
    expect(rl.retryAfter('k')).toBe(0);
  });

  it('hard-caps memory: floods of new keys evict expired, then oldest entries', () => {
    let t = 0;
    const rl = new RateLimiter(1, 1000, () => t, 100);
    for (let i = 0; i < 1000; i++) rl.hit(`k${i}`);
    expect(rl.size).toBeLessThanOrEqual(100);
    expect(rl.retryAfter('k999')).toBe(1); // most recent survive
    t = 5000;
    rl.hit('fresh');
    expect(rl.size).toBeLessThanOrEqual(100);
  });
});
