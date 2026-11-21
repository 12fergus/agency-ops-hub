/**
 * Key handling for hidden password entry, separated from the terminal so it can be unit-tested.
 * Handles the quirks of Windows terminals (MSYS2/UCRT64, Git Bash, PowerShell, cmd):
 *  - Enter may arrive as '\r', '\n' or '\r\n', possibly split across chunks → empty Enter presses
 *    are ignored, so a stray '\n' can never submit an empty password;
 *  - Backspace as DEL (0x7f) or BS (0x08);
 *  - arrow/Home/End escape sequences (ESC … letter or ~) are swallowed.
 */
export type KeyResult =
  | { kind: 'pending'; echo: string }
  | { kind: 'done'; value: string; echo: string }
  | { kind: 'cancelled'; echo: string };

export class HiddenInput {
  private value = '';
  private inEscape = false;

  /** Feeds one chunk of terminal input. `echo` is what to print (masks, never the characters). */
  feed(chunk: string): KeyResult {
    let echo = '';
    for (const ch of chunk) {
      if (this.inEscape) {
        if (/[A-Za-z~]/.test(ch)) this.inEscape = false;
        continue;
      }
      if (ch === '\u001b') {
        this.inEscape = true;
        continue;
      }
      if (ch === '\u0003') return { kind: 'cancelled', echo }; // Ctrl+C
      if (ch === '\r' || ch === '\n') {
        if (this.value === '') continue; // stray newline from a previous '\r\n'
        return { kind: 'done', value: this.value, echo };
      }
      if (ch === '\u007f' || ch === '\b') {
        if (this.value.length > 0) {
          this.value = this.value.slice(0, -1);
          echo += '\b \b';
        }
        continue;
      }
      if (ch >= ' ') {
        this.value += ch;
        echo += '*';
      }
    }
    return { kind: 'pending', echo };
  }
}
