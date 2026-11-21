import { DISPLAY_TIME_ZONE } from './i18n';

/**
 * <input type="datetime-local"> ⇄ UTC ISO, always in Israel time (Asia/Jerusalem), whatever the
 * computer's own time zone is. The browser input has no time zone; the API requires one.
 */

const PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: DISPLAY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function wallClock(ms: number) {
  const p = Object.fromEntries(PARTS.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return {
    y: Number(p.year),
    mo: Number(p.month),
    d: Number(p.day),
    h: Number(p.hour),
    mi: Number(p.minute),
    s: Number(p.second),
  };
}

/** Offset (ms) of Israel time from UTC at the given instant (+2h winter, +3h summer). */
function offsetAt(ms: number): number {
  const w = wallClock(ms);
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(ms / 1000) * 1000;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** UTC ISO → "YYYY-MM-DDTHH:mm" (Israel wall time) for a datetime-local input. */
export function toLocalInput(isoUtc: string): string {
  const w = wallClock(new Date(isoUtc).getTime());
  return `${w.y}-${pad(w.mo)}-${pad(w.d)}T${pad(w.h)}:${pad(w.mi)}`;
}

/** "YYYY-MM-DDTHH:mm" (Israel wall time) → UTC ISO. Empty/invalid → null. */
export function fromLocalInput(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const asUtc = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
  if (Number.isNaN(asUtc)) return null;
  // First guess with the offset at that moment, then correct once around DST switches.
  let ms = asUtc - offsetAt(asUtc);
  ms = asUtc - offsetAt(ms);
  return new Date(ms).toISOString();
}

/** Now, as a datetime-local value in Israel time. */
export const nowLocalInput = (): string => toLocalInput(new Date().toISOString());
