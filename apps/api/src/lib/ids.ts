import { randomBytes } from 'node:crypto';

/**
 * RFC 9562 UUIDv7: 48-bit Unix-ms timestamp + 74 random bits.
 * Time-ordered (good B-tree locality in SQLite), opaque, server-generated.
 * Not strictly monotonic within the same millisecond — sort by created_at, not by id.
 */
export function uuidv7(nowMs: number = Date.now()): string {
  const b = randomBytes(16);
  b.writeUIntBE(nowMs, 0, 6);
  b[6] = (b[6]! & 0x0f) | 0x70; // version 7
  b[8] = (b[8]! & 0x3f) | 0x80; // variant 10
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
