import { he, type MessageKey } from './he';

export type { MessageKey };

export function t(key: MessageKey): string {
  return he[key];
}

/** Display timezone/locale. Persisted timestamps stay UTC; only rendering converts. */
export const DISPLAY_LOCALE = 'he-IL';
export const DISPLAY_TIME_ZONE = 'Asia/Jerusalem';

export function formatDateTime(isoUtc: string): string {
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    timeZone: DISPLAY_TIME_ZONE,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(isoUtc));
}
