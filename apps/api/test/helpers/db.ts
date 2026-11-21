import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase, type DbHandle } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrator.js';
import { createUser } from '../../src/db/repositories/users.js';
import {
  addClientMember,
  createCampaign,
  createClient,
} from '../../src/modules/clients/service.js';

/** Fresh, fully migrated in-memory DB. Never touches data/ or a real database. */
export function freshDb(): DbHandle {
  const handle = openDatabase(':memory:');
  runMigrations(handle);
  return handle;
}

/** Temp directory for file-backed tests; returns a cleanup function. */
export function tempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'crm-test-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Two clients (A, B), each with a default pipeline + campaign; employee is a member of A only. */
export function twoClients(handle: DbHandle) {
  const db = handle.db;
  const admin = createUser(db, {
    email: 'admin@fixture.test',
    displayName: 'Admin',
    role: 'admin',
  });
  const employee = createUser(db, {
    email: 'emp@fixture.test',
    displayName: 'Employee',
    role: 'employee',
  });
  const outsider = createUser(db, {
    email: 'out@fixture.test',
    displayName: 'Outsider',
    role: 'employee',
  });
  const a = createClient(db, { name: 'Client A' }, admin.id);
  const b = createClient(db, { name: 'Client B' }, admin.id);
  addClientMember(db, { clientId: a.client.id, userId: employee.id }, admin.id);
  const campaignA = createCampaign(
    db,
    { clientId: a.client.id, name: 'A meta', channel: 'meta' },
    admin.id,
  );
  const campaignB = createCampaign(
    db,
    { clientId: b.client.id, name: 'B google', channel: 'google' },
    admin.id,
  );
  return { admin, employee, outsider, a, b, campaignA, campaignB };
}
