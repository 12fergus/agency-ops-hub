/**
 * Client-side checks for instant Hebrew feedback only. The server validates everything again
 * (Zod at the API boundary) and is the source of truth.
 */
export const isValidEmail = (value: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) && value.trim().length <= 254;
