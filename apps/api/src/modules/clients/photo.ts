import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { PHOTO_MAX_BYTES, PHOTO_TYPES } from '@agency-crm/shared';
import { recordAudit } from '../../db/repositories/audit.js';
import { clients } from '../../db/schema.js';
import { withTransaction, type Executor } from '../../db/tx.js';
import { AppError, invalidState, notFound } from '../../lib/errors.js';
import { nowIso } from '../../lib/normalize.js';
import { authorizeClientAccess, type Actor } from '../auth/authorize.js';

type PhotoType = (typeof PHOTO_TYPES)[number];
const EXT: Record<PhotoType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/**
 * Identifies the image by its MAGIC BYTES — never by filename or the browser-sent MIME type.
 * Only raster formats: SVG (scriptable XML) and everything else is rejected.
 */
export function sniffImageType(buf: Buffer): PhotoType | null {
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/** <uploadsDir>/clients/<clientId>.<ext> — the path is built from server data only. */
const photoPath = (uploadsDir: string, clientId: string, type: PhotoType) =>
  path.join(uploadsDir, 'clients', `${clientId}.${EXT[type]}`);

const removeFiles = (uploadsDir: string, clientId: string) => {
  for (const type of PHOTO_TYPES) rmSync(photoPath(uploadsDir, clientId, type), { force: true });
};

/** Members/admins who may edit the client may change its photo; archived = read-only. */
export function savePhotoAsActor(
  exec: Executor,
  actor: Actor,
  clientId: string,
  data: Buffer,
  uploadsDir: string,
): { photoType: PhotoType; photoUpdatedAt: string } {
  const { client } = authorizeClientAccess(exec, actor, clientId, 'client:edit');
  if (client.archivedAt) throw invalidState('Client is archived');
  if (data.length === 0 || data.length > PHOTO_MAX_BYTES) {
    throw new AppError(422, 'PHOTO_TOO_LARGE', 'Photo must be at most 2 MB');
  }
  const type = sniffImageType(data);
  if (!type) throw new AppError(415, 'PHOTO_TYPE', 'Only PNG, JPEG or WebP images are allowed');

  // Order matters so a failure at any step never loses the CURRENT photo:
  //  1. write the new bytes to a temp file (removed again on any failure);
  //  2. commit the DB change (if it fails, the old photo is untouched);
  //  3. only then swap the file in and delete the other formats.
  mkdirSync(path.join(uploadsDir, 'clients'), { recursive: true });
  const final = photoPath(uploadsDir, clientId, type);
  const tmp = `${final}.uploading`;
  const at = nowIso();
  try {
    writeFileSync(tmp, data, { mode: 0o600 });
    withTransaction(exec, (tx) => {
      tx.update(clients)
        .set({ photoType: type, photoUpdatedAt: at })
        .where(eq(clients.id, clientId))
        .run();
      recordAudit(tx, {
        actorUserId: actor.id,
        clientId,
        entityType: 'client',
        entityId: clientId,
        action: 'photo.set',
        after: { photoType: type, bytes: data.length },
      });
    });
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
  // DB committed. A failure from here on is very unlikely (same-folder rename); if it happens
  // the photo shows initials until re-uploaded — no other data is affected.
  renameSync(tmp, final);
  for (const other of PHOTO_TYPES) {
    if (other !== type) rmSync(photoPath(uploadsDir, clientId, other), { force: true });
  }
  return { photoType: type, photoUpdatedAt: at };
}

export function deletePhotoAsActor(
  exec: Executor,
  actor: Actor,
  clientId: string,
  uploadsDir: string,
): void {
  const { client } = authorizeClientAccess(exec, actor, clientId, 'client:edit');
  if (client.archivedAt) throw invalidState('Client is archived');
  withTransaction(exec, (tx) => {
    tx.update(clients)
      .set({ photoType: null, photoUpdatedAt: null })
      .where(eq(clients.id, clientId))
      .run();
    recordAudit(tx, {
      actorUserId: actor.id,
      clientId,
      entityType: 'client',
      entityId: clientId,
      action: 'photo.delete',
    });
  });
  removeFiles(uploadsDir, clientId);
}

/** Anyone who may READ the client may view its photo (404 otherwise, like the client itself). */
export function readPhotoAsActor(
  exec: Executor,
  actor: Actor,
  clientId: string,
  uploadsDir: string,
): { type: PhotoType; data: Buffer } {
  const { client } = authorizeClientAccess(exec, actor, clientId, 'client:read');
  const type = client.photoType as PhotoType | null;
  if (!type || !PHOTO_TYPES.includes(type)) throw notFound('Photo');
  try {
    return { type, data: readFileSync(photoPath(uploadsDir, clientId, type)) };
  } catch {
    throw notFound('Photo');
  }
}
