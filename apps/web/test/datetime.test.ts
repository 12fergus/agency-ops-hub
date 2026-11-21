import { describe, expect, it } from 'vitest';
import { fromLocalInput, toLocalInput } from '@/lib/datetime';

describe('Israel-time datetime-local conversion', () => {
  it('winter (UTC+2) and summer (UTC+3)', () => {
    expect(fromLocalInput('2026-11-23T10:00')).toBe('2026-11-23T08:00:00.000Z');
    expect(fromLocalInput('2026-07-01T10:00')).toBe('2026-07-01T07:00:00.000Z');
    expect(toLocalInput('2026-11-23T08:00:00.000Z')).toBe('2026-11-23T10:00');
    expect(toLocalInput('2026-07-01T07:00:00.000Z')).toBe('2026-07-01T10:00');
  });

  it('round-trips across a day boundary and rejects garbage', () => {
    expect(fromLocalInput('2026-01-01T01:30')).toBe('2025-12-31T23:30:00.000Z');
    expect(toLocalInput(fromLocalInput('2026-03-15T23:59')!)).toBe('2026-03-15T23:59');
    expect(fromLocalInput('')).toBeNull();
    expect(fromLocalInput('23/11/2026 10:00')).toBeNull();
  });
});
