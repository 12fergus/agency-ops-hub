import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DbHandle } from '../../src/db/client.js';
import { UNUSABLE_PASSWORD_HASH } from '../../src/db/repositories/users.js';
import { SeedRefusedError, seedDemo } from '../../src/db/seed-demo.js';
import { createUser } from '../../src/db/repositories/users.js';
import { freshDb } from '../helpers/db.js';

let h: DbHandle;
beforeEach(() => {
  h = freshDb();
});
afterEach(() => h.close());

const OK = { nodeEnv: 'test', confirmed: true };
const q = (sql: string) => h.sqlite.prepare(sql).pluck().all() as unknown[];

describe('demo seed', () => {
  it('creates fictional, clearly-marked data that satisfies every constraint', () => {
    const summary = seedDemo(h.db, OK);
    expect(summary).toEqual({ users: 4, clients: 3, leads: 10, tasks: 4 });

    // Every user/client/lead is labelled as demo; every email is on the reserved .test TLD.
    expect(q("SELECT count(*) FROM users WHERE display_name NOT LIKE '%(דמו)%'")[0]).toBe(0);
    expect(q("SELECT count(*) FROM clients WHERE name NOT LIKE '%(דמו)%'")[0]).toBe(0);
    expect(q("SELECT count(*) FROM leads WHERE full_name NOT LIKE '%(דמו)%'")[0]).toBe(0);
    const emails = q(
      'SELECT email FROM users UNION ALL SELECT email FROM clients WHERE email IS NOT NULL UNION ALL SELECT email FROM leads WHERE email IS NOT NULL UNION ALL SELECT email FROM client_contacts WHERE email IS NOT NULL',
    ) as string[];
    expect(emails.length).toBeGreaterThan(0);
    for (const e of emails) expect(e).toMatch(/\.test$/);

    // Nobody can log in as a demo user.
    expect(q('SELECT DISTINCT password_hash FROM users')).toEqual([UNUSABLE_PASSWORD_HASH]);
    // The deliberate repeat enquiry shares a normalized phone.
    expect(q("SELECT count(*) FROM leads WHERE phone_normalized = '+972500001001'")[0]).toBe(2);
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('refuses to run on a non-empty database', () => {
    seedDemo(h.db, OK);
    expect(() => seedDemo(h.db, OK)).toThrow(SeedRefusedError);
    expect(q('SELECT count(*) FROM clients')[0]).toBe(3);
  });

  it('refuses production, missing confirmation, and a DB that already has users', () => {
    expect(() => seedDemo(h.db, { nodeEnv: 'production', confirmed: true })).toThrow(/production/);
    expect(() => seedDemo(h.db, { nodeEnv: 'development', confirmed: false })).toThrow(
      /--confirm-demo/,
    );
    createUser(h.db, { email: 'real@agency.test', displayName: 'Real', role: 'admin' });
    expect(() => seedDemo(h.db, OK)).toThrow(/not empty/);
    expect(q('SELECT count(*) FROM users')[0]).toBe(1);
  });
});
