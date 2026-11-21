import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { User } from '../../src/db/schema.js';
import { addClientMember } from '../../src/modules/clients/service.js';
import { createLead } from '../../src/modules/leads/service.js';
import { call, loginAs, makeUser, testApp } from '../helpers/app.js';

let app: FastifyInstance;
let u: Record<'admin' | 'owner' | 'collab' | 'emp' | 'other', User>;
const cookie: Record<string, string> = {};
const as = (who: keyof typeof u) => ({ cookie: cookie[who]! });
let statuses: { id: string; name: string; isDefault: boolean }[];
const statusId = (name: string) => statuses.find((s) => s.name === name)!.id;

beforeEach(async () => {
  app = await testApp();
  u = {
    admin: await makeUser(app, 'admin@agency.test', 'admin'),
    owner: await makeUser(app, 'owner@agency.test', 'manager'),
    collab: await makeUser(app, 'collab@agency.test', 'manager'),
    emp: await makeUser(app, 'emp@agency.test', 'employee'),
    other: await makeUser(app, 'other@agency.test', 'employee'),
  };
  for (const k of Object.keys(u) as (keyof typeof u)[]) cookie[k] = await loginAs(app, u[k].email);
  statuses = (await call(app, 'GET', '/api/v1/client-statuses', as('emp'))).json().data;
});
afterEach(() => app.close());

/** Admin creates a client via the API; returns its id. */
async function newClient(body: Record<string, unknown>, who: keyof typeof u = 'admin') {
  const res = await call(app, 'POST', '/api/v1/clients', { ...as(who), body });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().data.id as string;
}
const list = async (who: keyof typeof u, qs = '') => {
  const res = await call(app, 'GET', `/api/v1/clients${qs}`, as(who));
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as {
    data: { id: string; name: string; clientStatus: { name: string; color: string } }[];
    meta: { total: number; page: number; pageSize: number };
  };
};

describe('Gate 3 — admin manages clients', () => {
  it('create with all fields + status, edit, read back; phone/email kept; server owns ids', async () => {
    const id = await newClient({
      name: '  מרפאת בדיקה  ',
      businessName: 'בדיקה בע״מ',
      industry: 'רפואה',
      phone: '050-1234567',
      email: 'Office@Clinic.test',
      notes: 'הערה',
      statusId: statusId('מושהה'),
    });
    const get = (await call(app, 'GET', `/api/v1/clients/${id}`, as('admin'))).json().data;
    expect(get).toMatchObject({
      name: 'מרפאת בדיקה',
      email: 'office@clinic.test',
      phone: '050-1234567',
      status: 'active',
      clientStatus: { name: 'מושהה', color: 'amber' },
      photoUrl: null,
      owners: [],
      permissions: { canEdit: true, canArchive: true },
    });

    const patched = await call(app, 'PATCH', `/api/v1/clients/${id}`, {
      ...as('admin'),
      body: { statusId: statusId('פעיל'), notes: '', industry: 'שיניים' },
    });
    expect(patched.json().data).toMatchObject({
      clientStatus: { name: 'פעיל', color: 'green' },
      notes: null,
      industry: 'שיניים',
    });
  });

  it('a new client gets the default status', async () => {
    const id = await newClient({ name: 'ברירת מחדל' });
    const get = (await call(app, 'GET', `/api/v1/clients/${id}`, as('admin'))).json().data;
    expect(get.clientStatus.name).toBe('פעיל');
  });

  it('enforces input constraints with field-level errors', async () => {
    const bad = [
      { name: '' },
      { name: 'x'.repeat(121) },
      { name: 'ok', email: 'not-an-email' },
      { name: 'ok', phone: 'call me maybe' },
      { name: 'ok', notes: 'x'.repeat(5001) },
      { name: 'ok', statusId: 'no-such-status' },
    ];
    for (const body of bad) {
      const res = await call(app, 'POST', '/api/v1/clients', { ...as('admin'), body });
      expect(res.statusCode, JSON.stringify(body)).toBe(422);
      expect(res.json().error.details.length).toBeGreaterThan(0);
    }
    const empty = await call(app, 'PATCH', `/api/v1/clients/${await newClient({ name: 'A' })}`, {
      ...as('admin'),
      body: {},
    });
    expect(empty.statusCode).toBe(422);
    // Lifecycle can't be set through PATCH (unknown keys are ignored; only archive/unarchive).
    const id = await newClient({ name: 'B' });
    await call(app, 'PATCH', `/api/v1/clients/${id}`, {
      ...as('admin'),
      body: { name: 'B2', status: 'archived' },
    });
    expect((await call(app, 'GET', `/api/v1/clients/${id}`, as('admin'))).json().data.status).toBe(
      'active',
    );
  });

  it('archive preserves the client and its records; unarchive restores it', async () => {
    const id = await newClient({ name: 'לארכיון' });
    addClientMember(app.dbHandle.db, { clientId: id, userId: u.emp.id }, null);
    await call(app, 'POST', `/api/v1/clients/${id}/contacts`, {
      ...as('admin'),
      body: { name: 'איש קשר' },
    });
    createLead(app.dbHandle.db, { clientId: id, fullName: 'ליד', source: 'manual' }, null);

    const archived = await call(app, 'POST', `/api/v1/clients/${id}/archive`, as('admin'));
    expect(archived.json().data).toMatchObject({
      status: 'archived',
      permissions: { canEdit: false },
    });
    expect(archived.json().data.archivedAt).toMatch(/Z$/);

    expect((await list('admin')).data.map((c) => c.id)).not.toContain(id);
    expect((await list('admin', '?status=archived')).data.map((c) => c.id)).toContain(id);
    const counts = app.dbHandle.sqlite
      .prepare(
        'SELECT (SELECT count(*) FROM clients WHERE id=?) c, (SELECT count(*) FROM client_members WHERE client_id=?) m, (SELECT count(*) FROM client_contacts WHERE client_id=?) k, (SELECT count(*) FROM leads WHERE client_id=?) l',
      )
      .get(id, id, id, id);
    expect(counts).toEqual({ c: 1, m: 1, k: 1, l: 1 });

    expect(
      (await call(app, 'PATCH', `/api/v1/clients/${id}`, { ...as('admin'), body: { name: 'x' } }))
        .statusCode,
    ).toBe(409);
    expect((await call(app, 'GET', `/api/v1/clients/${id}`, as('emp'))).statusCode).toBe(200);
    expect((await call(app, 'DELETE', `/api/v1/clients/${id}`, as('admin'))).statusCode).toBe(404);

    const restored = await call(app, 'POST', `/api/v1/clients/${id}/unarchive`, as('admin'));
    expect(restored.json().data).toMatchObject({ status: 'active', archivedAt: null });
  });
});

describe('Gate 3 — employees see only assigned clients; role enforcement', () => {
  it('list and detail are scoped; non-members get 404', async () => {
    const mine = await newClient({ name: 'שלי' });
    const notMine = await newClient({ name: 'לא שלי' });
    addClientMember(app.dbHandle.db, { clientId: mine, userId: u.emp.id }, null);

    const empList = await list('emp');
    expect(empList.data.map((c) => c.name)).toEqual(['שלי']);
    expect(empList.meta.total).toBe(1);
    expect((await call(app, 'GET', `/api/v1/clients/${notMine}`, as('emp'))).statusCode).toBe(404);
    expect(
      (await call(app, 'GET', `/api/v1/clients/${notMine}/contacts`, as('emp'))).statusCode,
    ).toBe(404);
    expect(
      (await call(app, 'GET', `/api/v1/clients/${notMine}/members`, as('emp'))).statusCode,
    ).toBe(404);
    expect((await list('emp', `?q=${encodeURIComponent('לא')}`)).data).toEqual([]);
    expect((await list('other')).data).toEqual([]);
  });

  it('who may do what (ADR-019: members edit; staff = admin/owner; archive = admin)', async () => {
    const id = await newClient({ name: 'הרשאות' });
    const db = app.dbHandle.db;
    addClientMember(db, { clientId: id, userId: u.owner.id, membershipRole: 'owner' }, null);
    addClientMember(db, { clientId: id, userId: u.collab.id }, null);
    addClientMember(db, { clientId: id, userId: u.emp.id }, null);

    const status = async (
      who: keyof typeof u,
      method: 'POST' | 'PATCH',
      url: string,
      body?: unknown,
    ) =>
      (await call(app, method, url, { ...as(who), ...(body !== undefined ? { body } : {}) }))
        .statusCode;

    // Edit details/status + contacts: any member (employee, collaborator, owner) and admin.
    for (const who of ['owner', 'collab', 'emp'] as const) {
      expect(
        await status(who, 'PATCH', `/api/v1/clients/${id}`, { notes: `${who} edit` }),
        who,
      ).toBe(200);
      expect(
        await status(who, 'PATCH', `/api/v1/clients/${id}`, { statusId: statusId('לא פעיל') }),
        who,
      ).toBe(200);
      expect(
        await status(who, 'POST', `/api/v1/clients/${id}/contacts`, { name: `c-${who}` }),
        who,
      ).toBe(201);
    }
    // Staff: only admin and the OWNER manager.
    expect(
      await status('owner', 'POST', `/api/v1/clients/${id}/members`, { userId: u.other.id }),
    ).toBe(201);
    expect(
      await status('collab', 'POST', `/api/v1/clients/${id}/members`, { userId: u.admin.id }),
    ).toBe(403);
    expect(
      await status('emp', 'POST', `/api/v1/clients/${id}/members`, { userId: u.admin.id }),
    ).toBe(403);
    // Archive: admin only.
    for (const who of ['owner', 'emp'] as const) {
      expect(await status(who, 'POST', `/api/v1/clients/${id}/archive`), who).toBe(403);
    }
    // A user who isn't assigned: 404 for everything.
    const lone = await makeUser(app, 'lone@agency.test', 'employee');
    cookie.lone = await loginAs(app, lone.email);
    expect(
      (
        await call(app, 'PATCH', `/api/v1/clients/${id}`, {
          cookie: cookie.lone,
          body: { notes: 'x' },
        })
      ).statusCode,
    ).toBe(404);

    const perms = async (who: keyof typeof u) =>
      (await call(app, 'GET', `/api/v1/clients/${id}`, as(who))).json().data.permissions;
    expect(await perms('admin')).toEqual({
      canEdit: true,
      canManageStaff: true,
      canManageContacts: true,
      canArchive: true,
    });
    expect(await perms('owner')).toEqual({
      canEdit: true,
      canManageStaff: true,
      canManageContacts: true,
      canArchive: false,
    });
    expect(await perms('emp')).toEqual({
      canEdit: true,
      canManageStaff: false,
      canManageContacts: true,
      canArchive: false,
    });
  });

  it('workers can create clients and are assigned automatically (manager = owner)', async () => {
    const byEmp = await newClient({ name: 'של העובד', statusId: statusId('לא פעיל') }, 'emp');
    const byMgr = await newClient({ name: 'של המנהל' }, 'owner');

    expect((await list('emp')).data.map((c) => c.name)).toEqual(['של העובד']);
    const staff = (await call(app, 'GET', `/api/v1/clients/${byEmp}/members`, as('emp'))).json()
      .data;
    expect(staff).toEqual([
      expect.objectContaining({ userId: u.emp.id, membershipRole: 'collaborator' }),
    ]);
    const mgrStaff = (
      await call(app, 'GET', `/api/v1/clients/${byMgr}/members`, as('owner'))
    ).json().data;
    expect(mgrStaff).toEqual([
      expect.objectContaining({ userId: u.owner.id, membershipRole: 'owner' }),
    ]);
    // Others still don't see it.
    expect((await call(app, 'GET', `/api/v1/clients/${byEmp}`, as('other'))).statusCode).toBe(404);
  });

  it('staff picker: admins and managers only, active non-admins only', async () => {
    expect((await call(app, 'GET', '/api/v1/users/assignable', as('emp'))).statusCode).toBe(403);
    const res = await call(app, 'GET', '/api/v1/users/assignable', as('owner'));
    const emails = (res.json().data as { email: string }[]).map((x) => x.email);
    expect(emails).toContain('emp@agency.test');
    expect(emails).not.toContain('admin@agency.test');
  });
});

describe('list: pagination, search, filters, safe sorting', () => {
  it('paginates with meta, caps page size, searches name/email/phone literally', async () => {
    for (const n of ['אלפא', 'בטא', 'גמא', '100% שיווק', 'דלתא']) await newClient({ name: n });
    await newClient({ name: 'Zed', email: 'hello@zed.test', phone: '03-5551234' });

    const p1 = await list('admin', '?pageSize=2&page=1');
    const p2 = await list('admin', '?pageSize=2&page=2');
    expect(p1.meta).toEqual({ page: 1, pageSize: 2, total: 6 });
    expect(p1.data).toHaveLength(2);
    expect(p1.data.map((c) => c.id)).not.toEqual(p2.data.map((c) => c.id));
    expect((await call(app, 'GET', '/api/v1/clients?pageSize=101', as('admin'))).statusCode).toBe(
      422,
    );

    expect((await list('admin', '?q=zed.test')).data.map((c) => c.name)).toEqual(['Zed']);
    expect((await list('admin', '?q=555')).data.map((c) => c.name)).toEqual(['Zed']);
    expect((await list('admin', '?q=035551234')).data.map((c) => c.name)).toEqual(['Zed']);
    expect(
      (await list('admin', `?q=${encodeURIComponent('03 555 1234')}`)).data.map((c) => c.name),
    ).toEqual(['Zed']);
    expect((await list('admin', `?q=${encodeURIComponent('%')}`)).data.map((c) => c.name)).toEqual([
      '100% שיווק',
    ]);
  });

  it('custom status filter, lifecycle filter and owner filter', async () => {
    const a = await newClient({ name: 'פעיל' });
    const b = await newClient({ name: 'מושהה', statusId: statusId('מושהה') });
    addClientMember(
      app.dbHandle.db,
      { clientId: b, userId: u.owner.id, membershipRole: 'owner' },
      null,
    );
    addClientMember(app.dbHandle.db, { clientId: a, userId: u.owner.id }, null);

    expect((await list('admin', `?statusId=${statusId('מושהה')}`)).data.map((c) => c.name)).toEqual(
      ['מושהה'],
    );
    expect((await list('admin', '?status=all')).meta.total).toBe(2);
    expect((await list('admin', `?ownerId=${u.owner.id}`)).data.map((c) => c.name)).toEqual([
      'מושהה',
    ]);
    expect((await call(app, 'GET', '/api/v1/clients?status=paused', as('admin'))).statusCode).toBe(
      422,
    );
  });

  it('sorts only by allowlisted fields; status sorts by the admin-defined order', async () => {
    await newClient({ name: 'ב', statusId: statusId('מושהה') }); // position 2
    await newClient({ name: 'א', statusId: statusId('פעיל') }); // position 0
    expect((await list('admin', '?sort=name&dir=asc')).data.map((c) => c.name)).toEqual(['א', 'ב']);
    expect((await list('admin', '?sort=name&dir=desc')).data.map((c) => c.name)).toEqual([
      'ב',
      'א',
    ]);
    expect((await list('admin', '?sort=status&dir=asc')).data.map((c) => c.name)).toEqual([
      'א',
      'ב',
    ]);
    expect((await list('admin', '?sort=status&dir=desc')).data.map((c) => c.name)).toEqual([
      'ב',
      'א',
    ]);
    for (const bad of ['password_hash', 'name;DROP TABLE clients', 'notes']) {
      const res = await call(
        app,
        'GET',
        `/api/v1/clients?sort=${encodeURIComponent(bad)}`,
        as('admin'),
      );
      expect(res.statusCode, bad).toBe(422);
    }
  });
});

describe('archived clients are read-only on EVERY write path', () => {
  it('details, contacts and staff changes are all refused (409) and change nothing', async () => {
    const id = await newClient({ name: 'קפוא' });
    const db = app.dbHandle.db;
    addClientMember(db, { clientId: id, userId: u.owner.id, membershipRole: 'owner' }, null);
    addClientMember(db, { clientId: id, userId: u.emp.id }, null);
    const contact = (
      await call(app, 'POST', `/api/v1/clients/${id}/contacts`, {
        ...as('admin'),
        body: { name: 'קשר' },
      })
    ).json().data;
    await call(app, 'POST', `/api/v1/clients/${id}/archive`, as('admin'));

    const attempts: [string, 'POST' | 'PATCH' | 'DELETE', string, unknown?][] = [
      ['details', 'PATCH', `/api/v1/clients/${id}`, { notes: 'x' }],
      ['add contact', 'POST', `/api/v1/clients/${id}/contacts`, { name: 'y' }],
      ['edit contact', 'PATCH', `/api/v1/clients/${id}/contacts/${contact.id}`, { name: 'y' }],
      ['delete contact', 'DELETE', `/api/v1/clients/${id}/contacts/${contact.id}`],
      ['add staff', 'POST', `/api/v1/clients/${id}/members`, { userId: u.other.id }],
      ['remove staff', 'DELETE', `/api/v1/clients/${id}/members/${u.emp.id}`],
      ['remove photo', 'DELETE', `/api/v1/clients/${id}/photo`],
    ];
    for (const who of ['admin', 'owner', 'emp'] as const) {
      for (const [what, method, url, body] of attempts) {
        const res = await call(app, method, url, {
          ...as(who),
          ...(body !== undefined ? { body } : {}),
        });
        // Employees may not manage staff at all → 403 there; everything else is 409 (archived).
        const expected = who === 'emp' && what.includes('staff') ? 403 : 409;
        expect(res.statusCode, `${who}: ${what}`).toBe(expected);
      }
    }
    const counts = app.dbHandle.sqlite
      .prepare(
        'SELECT (SELECT count(*) FROM client_members WHERE client_id=?) m, (SELECT count(*) FROM client_contacts WHERE client_id=?) k',
      )
      .get(id, id);
    expect(counts).toEqual({ m: 2, k: 1 });
  });
});

describe('PATCH leaves omitted fields unchanged (regression: defaults leaking into PATCH)', () => {
  it('the status stays; a primary contact stays primary', async () => {
    const id = await newClient({ name: 'מושהה', statusId: statusId('מושהה') });
    const res = await call(app, 'PATCH', `/api/v1/clients/${id}`, {
      ...as('admin'),
      body: { notes: 'רק הערה' },
    });
    expect(res.json().data).toMatchObject({ clientStatus: { name: 'מושהה' }, notes: 'רק הערה' });

    const contact = (
      await call(app, 'POST', `/api/v1/clients/${id}/contacts`, {
        ...as('admin'),
        body: { name: 'ראשי', isPrimary: true },
      })
    ).json().data;
    const edited = await call(app, 'PATCH', `/api/v1/clients/${id}/contacts/${contact.id}`, {
      ...as('admin'),
      body: { title: 'בעלים' },
    });
    expect(edited.json().data).toMatchObject({ isPrimary: true, title: 'בעלים' });
  });
});

describe('contacts', () => {
  it('CRUD within the client, one primary, no cross-client contact access', async () => {
    const id = await newClient({ name: 'אנשי קשר' });
    const other = await newClient({ name: 'אחר' });
    const c1 = (
      await call(app, 'POST', `/api/v1/clients/${id}/contacts`, {
        ...as('admin'),
        body: { name: 'ראשון', isPrimary: true, phone: '050-0000001' },
      })
    ).json().data;
    const c2 = (
      await call(app, 'POST', `/api/v1/clients/${id}/contacts`, {
        ...as('admin'),
        body: { name: 'שני', isPrimary: true },
      })
    ).json().data;
    const contacts = (await call(app, 'GET', `/api/v1/clients/${id}/contacts`, as('admin'))).json()
      .data;
    expect(
      contacts.filter((c: { isPrimary: boolean }) => c.isPrimary).map((c: { id: string }) => c.id),
    ).toEqual([c2.id]);

    expect(
      (
        await call(app, 'PATCH', `/api/v1/clients/${other}/contacts/${c1.id}`, {
          ...as('admin'),
          body: { name: 'x' },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await call(app, 'DELETE', `/api/v1/clients/${other}/contacts/${c1.id}`, as('admin')))
        .statusCode,
    ).toBe(404);

    const edited = await call(app, 'PATCH', `/api/v1/clients/${id}/contacts/${c1.id}`, {
      ...as('admin'),
      body: { title: 'מנכ״ל' },
    });
    expect(edited.json().data.title).toBe('מנכ״ל');
    expect(
      (await call(app, 'DELETE', `/api/v1/clients/${id}/contacts/${c1.id}`, as('admin')))
        .statusCode,
    ).toBe(200);
    expect(
      (await call(app, 'GET', `/api/v1/clients/${id}/contacts`, as('admin'))).json().data,
    ).toHaveLength(1);
  });
});
