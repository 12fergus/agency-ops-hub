import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { User } from '../../src/db/schema.js';
import { addClientMember, createClient } from '../../src/modules/clients/service.js';
import { createLead } from '../../src/modules/leads/service.js';
import { call, loginAs, makeUser, testApp } from '../helpers/app.js';

/**
 * Two clients. A: owner=mgrOwner, collaborators=mgrCollab, empA. B: empB.
 * outsider has no memberships. Proves horizontal IDOR is blocked on every route.
 */
let app: FastifyInstance;
let u: Record<'admin' | 'mgrOwner' | 'mgrCollab' | 'empA' | 'empB' | 'outsider', User>;
let A: string;
let B: string;
let leadA: string;
let leadB: string;
const cookies: Record<string, string> = {};

beforeEach(async () => {
  app = await testApp();
  u = {
    admin: await makeUser(app, 'admin@agency.test', 'admin'),
    mgrOwner: await makeUser(app, 'owner@agency.test', 'manager'),
    mgrCollab: await makeUser(app, 'collab@agency.test', 'manager'),
    empA: await makeUser(app, 'empa@agency.test', 'employee'),
    empB: await makeUser(app, 'empb@agency.test', 'employee'),
    outsider: await makeUser(app, 'out@agency.test', 'employee'),
  };
  const db = app.dbHandle.db;
  A = createClient(db, { name: 'Client A' }, u.admin.id).client.id;
  B = createClient(db, { name: 'Client B' }, u.admin.id).client.id;
  addClientMember(db, { clientId: A, userId: u.mgrOwner.id, membershipRole: 'owner' }, null);
  addClientMember(db, { clientId: A, userId: u.mgrCollab.id }, null);
  addClientMember(db, { clientId: A, userId: u.empA.id }, null);
  addClientMember(db, { clientId: B, userId: u.empB.id }, null);
  leadA = createLead(db, { clientId: A, fullName: 'Lead A', source: 'manual' }, null).lead.id;
  leadB = createLead(db, { clientId: B, fullName: 'Lead B', source: 'manual' }, null).lead.id;
  for (const k of Object.keys(u) as (keyof typeof u)[]) cookies[k] = await loginAs(app, u[k].email);
});
afterEach(() => app.close());

const as = (who: keyof typeof u) => ({ cookie: cookies[who]! });
const status = async (
  who: keyof typeof u,
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  body?: unknown,
) =>
  (await call(app, method, url, { ...as(who), ...(body !== undefined ? { body } : {}) }))
    .statusCode;

describe('client listing is query-scoped', () => {
  it('members see only their clients; admins see all; outsiders see none', async () => {
    const names = async (who: keyof typeof u) =>
      (await call(app, 'GET', '/api/v1/clients', as(who)))
        .json()
        .data.map((c: { name: string }) => c.name);
    expect(await names('admin')).toEqual(['Client A', 'Client B']);
    expect(await names('empA')).toEqual(['Client A']);
    expect(await names('empB')).toEqual(['Client B']);
    expect(await names('outsider')).toEqual([]);
  });
});

describe('horizontal IDOR: a non-member cannot read or mutate another client', () => {
  it('reads of client B by a member of A are 404 (indistinguishable from non-existent)', async () => {
    for (const url of [
      `/api/v1/clients/${B}`,
      `/api/v1/clients/${B}/members`,
      `/api/v1/clients/${B}/leads`,
      `/api/v1/leads/${leadB}`,
    ]) {
      const res = await call(app, 'GET', url, as('empA'));
      expect(res.statusCode, url).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
      expect(res.body).not.toContain('Lead B');
    }
    // Same response as a truly unknown id.
    expect((await call(app, 'GET', '/api/v1/leads/does-not-exist', as('empA'))).json()).toEqual(
      (await call(app, 'GET', `/api/v1/leads/${leadB}`, as('empA'))).json(),
    );
  });

  it('writes to client B by a member of A are rejected and change nothing', async () => {
    expect(
      await status('empA', 'POST', `/api/v1/leads/${leadB}/activities`, {
        type: 'note',
        body: 'x',
      }),
    ).toBe(404);
    expect(
      await status('mgrOwner', 'POST', `/api/v1/clients/${B}/members`, { userId: u.empA.id }),
    ).toBe(404);
    expect(await status('mgrOwner', 'DELETE', `/api/v1/clients/${B}/members/${u.empB.id}`)).toBe(
      404,
    );
    const counts = app.dbHandle.sqlite
      .prepare(
        'SELECT (SELECT count(*) FROM lead_activities) AS a, (SELECT count(*) FROM client_members WHERE client_id = ?) AS m',
      )
      .get(B);
    expect(counts).toEqual({ a: 0, m: 1 });
  });

  it('members of A can read and write A', async () => {
    expect(await status('empA', 'GET', `/api/v1/leads/${leadA}`)).toBe(200);
    expect(await status('empA', 'GET', `/api/v1/clients/${A}/leads`)).toBe(200);
    expect(
      await status('empA', 'POST', `/api/v1/leads/${leadA}/activities`, {
        type: 'call',
        body: 'שיחה',
      }),
    ).toBe(201);
  });

  it('admins can access every client without membership', async () => {
    expect(await status('admin', 'GET', `/api/v1/leads/${leadB}`)).toBe(200);
    expect(await status('admin', 'GET', `/api/v1/clients/${B}/members`)).toBe(200);
  });
});

describe('membership management', () => {
  const add = (who: keyof typeof u, client: string, userId: string, membershipRole?: string) =>
    status(who, 'POST', `/api/v1/clients/${client}/members`, {
      userId,
      ...(membershipRole ? { membershipRole } : {}),
    });

  it('employees and non-owner managers cannot change membership (403)', async () => {
    expect(await add('empA', A, u.outsider.id)).toBe(403);
    expect(await add('mgrCollab', A, u.outsider.id)).toBe(403);
  });

  it('owner managers can add collaborators but cannot escalate', async () => {
    expect(await add('mgrOwner', A, u.outsider.id)).toBe(201);
    expect(await add('mgrOwner', A, u.empB.id, 'owner')).toBe(403); // can't grant ownership
    expect(await add('mgrOwner', A, u.admin.id)).toBe(403); // can't add admins
    expect(await add('mgrOwner', A, u.outsider.id)).toBe(409); // already a member
    // The newly added member now has access.
    expect(await status('outsider', 'GET', `/api/v1/clients/${A}`)).toBe(200);
  });

  it('owner managers can remove collaborators but not owners', async () => {
    expect(
      await status('mgrOwner', 'DELETE', `/api/v1/clients/${A}/members/${u.mgrOwner.id}`),
    ).toBe(403);
    expect(await status('mgrOwner', 'DELETE', `/api/v1/clients/${A}/members/${u.empA.id}`)).toBe(
      200,
    );
  });

  it('removing a membership revokes access on the very next request', async () => {
    expect(await status('empA', 'GET', `/api/v1/leads/${leadA}`)).toBe(200);
    await call(app, 'DELETE', `/api/v1/clients/${A}/members/${u.empA.id}`, as('admin'));
    expect(await status('empA', 'GET', `/api/v1/leads/${leadA}`)).toBe(404);
  });

  it('admins can grant ownership', async () => {
    expect(await add('admin', B, u.mgrCollab.id, 'owner')).toBe(201);
    expect(await add('mgrCollab', B, u.outsider.id)).toBe(201);
  });

  it('disabled users cannot be added', async () => {
    app.dbHandle.sqlite.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(u.outsider.id);
    expect(await add('admin', A, u.outsider.id)).toBe(404);
  });
});
