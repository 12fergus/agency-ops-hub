import { describe, expect, it } from 'vitest';
import { passwordProblems } from '../src/password-policy.js';

describe('password policy (shared by API and web)', () => {
  it.each([
    ['Abc12!xy', 'a@b.test'],
    ['סיסמה-2026', 'a@b.test'], // Hebrew letters count as letters
    ['pass word 9!', 'a@b.test'], // inner spaces are fine
  ])('accepts %j', (pw, email) => expect(passwordProblems(pw, email)).toEqual([]));

  it.each([
    ['Ab1!', ['PASSWORD_TOO_SHORT']],
    ['12345678!', ['PASSWORD_NEEDS_LETTER']],
    ['abcdefgh!', ['PASSWORD_NEEDS_DIGIT']],
    ['abcdefg12', ['PASSWORD_NEEDS_SYMBOL']],
    [' Abc12!xy', ['PASSWORD_WHITESPACE_EDGES']],
    [
      '',
      [
        'PASSWORD_TOO_SHORT',
        'PASSWORD_NEEDS_LETTER',
        'PASSWORD_NEEDS_DIGIT',
        'PASSWORD_NEEDS_SYMBOL',
      ],
    ],
  ])('%j → %j', (pw, expected) => expect(passwordProblems(pw, 'z@b.test')).toEqual(expected));

  it('rejects the email name part (3+ chars), case-insensitive', () => {
    expect(passwordProblems('Dana-2026!', 'dana@agency.test')).toEqual(['PASSWORD_CONTAINS_EMAIL']);
    expect(passwordProblems('Ab12!xyz', 'ab@agency.test')).toEqual([]); // 2-char name ignored
  });

  it('caps length at 256', () => {
    expect(passwordProblems(`Aa1!${'x'.repeat(253)}`)).toEqual(['PASSWORD_TOO_LONG']);
  });
});
