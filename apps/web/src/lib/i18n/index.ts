import { he, type MessageKey } from './he';

export type { MessageKey };

export function t(key: MessageKey): string {
  return he[key];
}

/**
 * Translated sentence with placeholders, e.g. tf('clients.pageOf', { page: 2, pages: 5 }) for
 * 'עמוד {page} מתוך {pages}'. One message per sentence keeps word order right in every language.
 */
export function tf(key: MessageKey, vars: Record<string, string | number>): string {
  return he[key].replace(/\{(\w+)\}/g, (m, name: string) =>
    name in vars ? String(vars[name]) : m,
  );
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
