import { PHOTO_MAX_BYTES, PHOTO_TYPES } from '@agency-crm/shared';

/** Longest side of a stored client photo. Plenty for a 96px avatar on a hi-DPI screen. */
const MAX_SIDE = 1024;

export type PreparedImage = { ok: true; file: Blob } | { ok: false; reason: 'type' | 'size' };

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Makes any photo the browser can open (e.g. a 5 MB phone JPEG) fit the server's limits:
 * downscales to MAX_SIDE and re-encodes as WebP (keeps logo transparency; falls back to PNG in
 * browsers without WebP encoding). Small files already in an accepted format are sent untouched.
 * The server still verifies the bytes (magic-byte sniffing) — this is only for convenience.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith('image/') && file.type !== '') return { ok: false, reason: 'type' };

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { ok: false, reason: 'type' }; // not decodable here (e.g. HEIC in Chrome, SVG, garbage)
  }
  try {
    const fits = Math.max(bitmap.width, bitmap.height) <= MAX_SIDE;
    if (
      fits &&
      file.size <= PHOTO_MAX_BYTES &&
      (PHOTO_TYPES as readonly string[]).includes(file.type)
    ) {
      return { ok: true, file };
    }
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.85, 0.7, 0.5]) {
      const blob = await toBlob(canvas, 'image/webp', quality);
      if (
        blob &&
        blob.size <= PHOTO_MAX_BYTES &&
        (PHOTO_TYPES as readonly string[]).includes(blob.type)
      ) {
        return { ok: true, file: blob };
      }
    }
    return { ok: false, reason: 'size' };
  } finally {
    bitmap.close();
  }
}
