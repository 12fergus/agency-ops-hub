import { describe, expect, it } from 'vitest';
import { sanitizeSnapshot } from '../../src/db/repositories/audit.js';
import { UUID_V7_RE, uuidv7 } from '../../src/lib/ids.js';
import { normalizeEmail, normalizePhone, toUtcIso } from '../../src/lib/normalize.js';
import { isNetworkPath } from '../../src/lib/config.js';

describe('normalizePhone', () => {
  it.each([
    ['050-123-4567', '+972501234567'],
    ['0501234567', '+972501234567'],
    ['+972-50-123-4567', '+972501234567'],
    ['+972 (0)50 1234567', '+972501234567'],
    ['00972501234567', '+972501234567'],
    ['972501234567', '+972501234567'],
    ['03-1234567', '+97231234567'],
    ['+1 212 555 0100', '+12125550100'],
  ])('%s → %s', (raw, expected) => expect(normalizePhone(raw)).toBe(expected));

  it.each([
    '',
    '   ',
    'abc',
    '501234567',
    '12345',
    '+972 12',
    '+0501234567',
    '0123456789',
    '050-1234567 ext 12',
    '٠٥٠١٢٣٤٥٦٧',
    '05٠1234567',
  ])('does not guess: %j → null', (raw) => expect(normalizePhone(raw)).toBeNull());
});

describe('normalizeEmail', () => {
  it('trims and lowercases; empty → null', () => {
    expect(normalizeEmail('  Foo@Bar.TEST ')).toBe('foo@bar.test');
    expect(normalizeEmail('  ')).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });
});

describe('uuidv7', () => {
  it('is RFC 9562 v7 and time-ordered across milliseconds', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a).toMatch(UUID_V7_RE);
    expect(a < b).toBe(true);
  });
});

describe('sanitizeSnapshot', () => {
  it('drops secret-like keys at any depth', () => {
    expect(
      sanitizeSnapshot({
        id: 1,
        passwordHash: 'x',
        nested: { tokenHash: 'y', ok: true },
        list: [{ apiKey: 'z', n: 1 }],
      }),
    ).toEqual({ id: 1, nested: { ok: true }, list: [{ n: 1 }] });
  });
});

describe('toUtcIso', () => {
  it('converts zoned input to canonical UTC and rejects zoneless/invalid input', () => {
    expect(toUtcIso('2026-11-20T12:00:00+02:00')).toBe('2026-11-20T10:00:00.000Z');
    expect(toUtcIso('2026-11-20T10:00:00Z')).toBe('2026-11-20T10:00:00.000Z');
    expect(toUtcIso(new Date(0))).toBe('1970-01-01T00:00:00.000Z');
    expect(() => toUtcIso('2026-11-20T10:00:00')).toThrow(/timezone/);
    expect(() => toUtcIso('not a dateZ')).toThrow(/Invalid/);
  });
});

describe('isNetworkPath', () => {
  it.each([
    [String.raw`\\nas\crm\crm.sqlite`, true],
    ['//nas/crm/crm.sqlite', true],
    [String.raw`\\?\UNC\nas\crm.sqlite`, true],
    [String.raw`\\?\C:\crm\crm.sqlite`, false],
    [String.raw`C:\crm\crm.sqlite`, false],
    ['data/crm.sqlite', false],
  ])('%s → %s', (p, expected) => expect(isNetworkPath(p)).toBe(expected));
});
