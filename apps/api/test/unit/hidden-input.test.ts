import { describe, expect, it } from 'vitest';
import { HiddenInput } from '../../src/cli/hidden-input.js';

/** Feeds chunks in order; returns the final result of the last chunk. */
const run = (...chunks: string[]) => {
  const input = new HiddenInput();
  return chunks.map((c) => input.feed(c)).at(-1)!;
};

describe('HiddenInput (password prompt key handling)', () => {
  it('accepts \r, \n and \r\n as Enter', () => {
    for (const enter of ['\r', '\n', '\r\n']) {
      expect(run(`secret-pass${enter}`)).toMatchObject({ kind: 'done', value: 'secret-pass' });
    }
  });

  it('ignores a stray newline left over from the previous prompt (MSYS2/UCRT64 bug)', () => {
    // First prompt ended on '\r'; the '\n' arrives as a separate chunk at the second prompt.
    expect(run('\n', 'secret-pass', '\r')).toMatchObject({ kind: 'done', value: 'secret-pass' });
    expect(run('\n')).toMatchObject({ kind: 'pending' }); // never submits an empty password
  });

  it('handles typing split across chunks, backspace (DEL and BS) and arrow keys', () => {
    expect(run('sec', 'ret-x\u007f', 'pass\b\bss', '\u001b[D\u001b[C', '\r')).toMatchObject({
      kind: 'done',
      value: 'secret-pass',
    });
  });

  it('echoes only masks, never the characters', () => {
    const r = new HiddenInput().feed('abc');
    expect(r).toEqual({ kind: 'pending', echo: '***' });
  });

  it('Ctrl+C cancels', () => {
    expect(run('abc\u0003')).toMatchObject({ kind: 'cancelled' });
  });
});
