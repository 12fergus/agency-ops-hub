import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { addClientMember } from '../../src/modules/clients/service.js';
import { call, loginAs, makeUser, testApp } from '../helpers/app.js';

let app: FastifyInstance;
const cookie: Record<string, string> = {};
let ids: Record<string, string>;
let clientA: string;
let clientB: string;

const as = (who: string) => ({ cookie: cookie[who]! });
const api = (method: 'GET' | 'POST' | 'PATCH', url: string, who: string, body?: unknown) =>
  call(app, method, `/api/v1${url}`, body === undefined ? as(who) : { ...as(who), body });

beforeEach(async () => {
  app = await testApp();
  ids = {
    admin: (await makeUser(app, 'admin@agency.test', 'admin')).id,
    mgr: (await makeUser(app, 'mgr@agency.test', 'manager')).id,
    emp: (await makeUser(app, 'emp@agency.test', 'employee')).id,
    designer: (await makeUser(app, 'designer@agency.test', 'employee')).id,
    other: (await makeUser(app, 'other@agency.test', 'employee')).id,
  };
  for (const k of Object.keys(ids)) cookie[k] = await loginAs(app, `${k}@agency.test`);
  clientA = (await api('POST', '/clients', 'admin', { name: 'לקוח א' })).json().data.id;
  clientB = (await api('POST', '/clients', 'admin', { name: 'לקוח ב' })).json().data.id;
  const db = app.dbHandle.db;
  addClientMember(db, { clientId: clientA, userId: ids.mgr!, membershipRole: 'owner' }, null);
  addClientMember(db, { clientId: clientA, userId: ids.emp! }, null);
  addClientMember(db, { clientId: clientA, userId: ids.designer! }, null);
  addClientMember(db, { clientId: clientB, userId: ids.other! }, null);
});
afterEach(async () => {
  await app.close();
});

const CALL = {
  type: 'call',
  occurredAt: '2026-11-23T10:00:00+02:00',
  summary: 'שוחחנו על קמפיין המטא לנובמבר. הלקוח ביקש 3 קריאייטיבים חדשים.',
};

describe('communication log', () => {
  it('a member logs a call; it lists newest first with author; UTC stored', async () => {
    const res = await api('POST', `/clients/${clientA}/communications`, 'emp', CALL);
    expect(res.statusCode).toBe(201);
    const c = res.json().data;
    expect(c).toMatchObject({
      type: 'call',
      occurredAt: '2026-11-23T08:00:00.000Z',
      author: { id: ids.emp },
      contact: null,
      tasks: [],
      canEdit: true,
    });
    await api('POST', `/clients/${clientA}/communications`, 'mgr', {
      ...CALL,
      type: 'whatsapp',
      occurredAt: '2026-11-24T09:00:00Z',
    });
    const list = (await api('GET', `/clients/${clientA}/communications`, 'designer')).json();
    expect(list.meta.total).toBe(2);
    expect(list.data.map((x: { type: string }) => x.type)).toEqual(['whatsapp', 'call']);
    // Only the author (or an admin) may edit.
    expect(list.data.map((x: { canEdit: boolean }) => x.canEdit)).toEqual([false, false]);
  });

  it('non-members get 404 on list/create/read/patch; validation errors are 422', async () => {
    const id = (await api('POST', `/clients/${clientA}/communications`, 'emp', CALL)).json().data
      .id;
    expect((await api('GET', `/clients/${clientA}/communications`, 'other')).statusCode).toBe(404);
    expect(
      (await api('POST', `/clients/${clientA}/communications`, 'other', CALL)).statusCode,
    ).toBe(404);
    expect((await api('GET', `/communications/${id}`, 'other')).statusCode).toBe(404);
    expect(
      (await api('PATCH', `/communications/${id}`, 'other', { summary: 'x' })).statusCode,
    ).toBe(404);

    for (const bad of [
      { ...CALL, type: 'fax' },
      { ...CALL, summary: '' },
      { ...CALL, summary: 'א'.repeat(5001) },
      { ...CALL, occurredAt: '2026-11-23 10:00' }, // no timezone → ambiguous
    ]) {
      expect((await api('POST', `/clients/${clientA}/communications`, 'emp', bad)).statusCode).toBe(
        422,
      );
    }
  });

  it('author/admin edit; another member 403; a contact of ANOTHER client is a field error', async () => {
    const id = (await api('POST', `/clients/${clientA}/communications`, 'emp', CALL)).json().data
      .id;
    expect(
      (await api('PATCH', `/communications/${id}`, 'designer', { summary: 'x' })).statusCode,
    ).toBe(403);
    expect(
      (await api('PATCH', `/communications/${id}`, 'emp', { summary: 'עודכן' })).json().data
        .summary,
    ).toBe('עודכן');
    expect(
      (await api('PATCH', `/communications/${id}`, 'admin', { type: 'meeting' })).json().data.type,
    ).toBe('meeting');

    const contactB = (
      await api('POST', `/clients/${clientB}/contacts`, 'admin', { name: 'איש קשר ב' })
    ).json().data.id;
    const cross = await api('PATCH', `/communications/${id}`, 'emp', { contactId: contactB });
    expect(cross.statusCode).toBe(422);
    expect(cross.json().error.details).toEqual([{ path: 'contactId', code: 'invalid_value' }]);

    const contactA = (
      await api('POST', `/clients/${clientA}/contacts`, 'admin', { name: 'דנה' })
    ).json().data.id;
    const ok = await api('PATCH', `/communications/${id}`, 'emp', { contactId: contactA });
    expect(ok.json().data.contact).toEqual({ id: contactA, name: 'דנה' });

    // Deleting the contact keeps the record (history), it just no longer names the contact.
    expect(
      (await call(app, 'DELETE', `/api/v1/clients/${clientA}/contacts/${contactA}`, as('admin')))
        .statusCode,
    ).toBe(200);
    expect((await api('GET', `/communications/${id}`, 'emp')).json().data.contact).toBeNull();
  });

  it('archived client: log is readable, but no new records or edits (409)', async () => {
    const id = (await api('POST', `/clients/${clientA}/communications`, 'emp', CALL)).json().data
      .id;
    await api('POST', `/clients/${clientA}/archive`, 'admin', {});
    expect((await api('GET', `/clients/${clientA}/communications`, 'emp')).statusCode).toBe(200);
    expect((await api('GET', `/communications/${id}`, 'emp')).json().data.canEdit).toBe(false);
    expect((await api('POST', `/clients/${clientA}/communications`, 'emp', CALL)).statusCode).toBe(
      409,
    );
    expect((await api('PATCH', `/communications/${id}`, 'emp', { summary: 'x' })).statusCode).toBe(
      409,
    );
  });
});

describe('follow-up tasks ("צור משימת המשך")', () => {
  it('the example flow: call → follow-up task for the designer, linked both ways', async () => {
    const comm = (await api('POST', `/clients/${clientA}/communications`, 'emp', CALL)).json().data;
    const res = await api('POST', '/tasks', 'emp', {
      clientId: clientA,
      communicationId: comm.id,
      title: 'הכנת 3 קריאייטיבים חדשים',
      assignedUserId: ids.designer,
      dueAt: '2026-11-27T17:00:00+02:00',
    });
    expect(res.statusCode).toBe(201);
    const task = res.json().data;
    expect(task).toMatchObject({
      status: 'open',
      dueAt: '2026-11-27T15:00:00.000Z',
      assignee: { id: ids.designer },
      createdBy: { id: ids.emp },
      client: { id: clientA, name: 'לקוח א', archived: false },
      communication: { id: comm.id, type: 'call', occurredAt: '2026-11-23T08:00:00.000Z' },
    });
    // The record lists the task it produced.
    const again = (await api('GET', `/communications/${comm.id}`, 'designer')).json().data;
    expect(again.tasks).toEqual([
      {
        id: task.id,
        title: 'הכנת 3 קריאייטיבים חדשים',
        status: 'open',
        dueAt: '2026-11-27T15:00:00.000Z',
        overdue: false,
        assignee: { id: ids.designer, displayName: expect.any(String) },
      },
    ]);
    // It shows up in the designer's "my tasks".
    const mine = (await api('GET', '/tasks', 'designer')).json();
    expect(mine.data.map((t: { id: string }) => t.id)).toEqual([task.id]);
    expect((await api('GET', '/tasks', 'emp')).json().meta.total).toBe(0); // not assigned to emp
  });

  it('assignee must have access to the client; record must be of the same client', async () => {
    const commB = (await api('POST', `/clients/${clientB}/communications`, 'other', CALL)).json()
      .data.id;
    const base = { clientId: clientA, title: 'משימה', assignedUserId: ids.designer };

    const noAccess = await api('POST', '/tasks', 'emp', { ...base, assignedUserId: ids.other });
    expect(noAccess.statusCode).toBe(422);
    expect(noAccess.json().error.code).toBe('INVALID_ASSIGNEE');

    const cross = await api('POST', '/tasks', 'emp', { ...base, communicationId: commB });
    expect(cross.statusCode).toBe(422);
    expect(cross.json().error.details).toEqual([
      { path: 'communicationId', code: 'invalid_value' },
    ]);

    // A non-member can't create tasks on the client at all (404, no probing).
    expect((await api('POST', '/tasks', 'other', base)).statusCode).toBe(404);
    // Admins may assign to anyone with access, including themselves.
    expect(
      (await api('POST', '/tasks', 'admin', { ...base, assignedUserId: ids.admin })).statusCode,
    ).toBe(201);
    expect((await api('POST', '/tasks', 'emp', { ...base, title: ' ' })).statusCode).toBe(422);
  });

  it('status workflow: open → in_progress → done (completedAt) → reopened; any member edits', async () => {
    const id = (
      await api('POST', '/tasks', 'mgr', {
        clientId: clientA,
        title: 'דוח חודשי',
        assignedUserId: ids.emp,
      })
    ).json().data.id;
    const patch = (who: string, body: unknown) => api('PATCH', `/tasks/${id}`, who, body);

    expect((await patch('emp', { status: 'in_progress' })).json().data.status).toBe('in_progress');
    const done = (await patch('designer', { status: 'done' })).json().data;
    expect(done.status).toBe('done');
    expect(done.completedAt).toMatch(/Z$/);
    const reopened = (await patch('emp', { status: 'open' })).json().data;
    expect(reopened.completedAt).toBeNull();

    // Reassign: only to someone with access.
    expect((await patch('emp', { assignedUserId: ids.other })).statusCode).toBe(422);
    expect((await patch('emp', { assignedUserId: ids.designer })).json().data.assignee.id).toBe(
      ids.designer,
    );
    expect((await patch('emp', {})).statusCode).toBe(422); // empty patch
    expect((await patch('other', { status: 'done' })).statusCode).toBe(404);
    expect((await api('GET', `/tasks/${id}`, 'other')).statusCode).toBe(404);
  });

  it('list: scope, status filter, overdue, client filter, search, deadline order; scoped for non-admins', async () => {
    const mk = async (title: string, dueAt: string | null, who = 'emp', clientId = clientA) =>
      (
        await api('POST', '/tasks', 'admin', {
          clientId,
          title,
          assignedUserId: ids[who],
          dueAt,
        })
      ).json().data.id as string;
    const late = await mk('באיחור', '2020-01-01T09:00:00Z');
    const soon = await mk('בקרוב', '2099-01-01T09:00:00Z');
    const none = await mk('בלי תאריך', null);
    const doneLate = await mk('הושלמה מזמן', '2020-01-02T09:00:00Z');
    await api('PATCH', `/tasks/${doneLate}`, 'emp', { status: 'done' });
    const forOther = await mk('של לקוח ב', '2020-01-01T09:00:00Z', 'other', clientB);

    const list = async (who: string, qs = '') =>
      (await api('GET', `/tasks${qs}`, who)).json() as {
        data: { id: string; overdue: boolean }[];
        meta: { total: number };
      };

    // Default: mine + active, by deadline, no-deadline last.
    expect((await list('emp')).data.map((t) => t.id)).toEqual([late, soon, none]);
    expect((await list('emp')).data.map((t) => t.overdue)).toEqual([true, false, false]);
    expect((await list('emp', '?overdue=true')).data.map((t) => t.id)).toEqual([late]);
    expect((await list('emp', '?status=done')).data.map((t) => t.id)).toEqual([doneLate]);
    expect((await list('emp', '?q=' + encodeURIComponent('קרוב'))).data.map((t) => t.id)).toEqual([
      soon,
    ]);
    // scope=all shows every task of MY clients — never client B's.
    expect((await list('designer', '?scope=all')).meta.total).toBe(3);
    expect((await list('designer', `?scope=all&clientId=${clientB}`)).meta.total).toBe(0);
    // Admin sees everything.
    expect((await list('admin', '?scope=all&status=all')).meta.total).toBe(5);
    expect((await list('other')).data.map((t) => t.id)).toEqual([forOther]);
    expect((await api('GET', '/tasks?sort=evil', 'emp')).statusCode).toBe(422);
    expect((await api('GET', '/tasks?pageSize=1000', 'emp')).statusCode).toBe(422);
  });

  it('archived client: tasks readable (not editable), leave the active queue, no new tasks', async () => {
    const id = (
      await api('POST', '/tasks', 'emp', { clientId: clientA, title: 'x', assignedUserId: ids.emp })
    ).json().data.id;
    await api('POST', `/clients/${clientA}/archive`, 'admin', {});
    const t = (await api('GET', `/tasks/${id}`, 'emp')).json().data;
    expect(t).toMatchObject({ canEdit: false, client: { archived: true } });
    expect((await api('PATCH', `/tasks/${id}`, 'emp', { status: 'done' })).statusCode).toBe(409);
    expect(
      (
        await api('POST', '/tasks', 'emp', {
          clientId: clientA,
          title: 'y',
          assignedUserId: ids.emp,
        })
      ).statusCode,
    ).toBe(409);
    expect((await api('GET', '/tasks', 'emp')).json().meta.total).toBe(0);
    expect((await api('GET', '/tasks?status=all', 'emp')).json().meta.total).toBe(1);
  });

  it('a member removed from the client no longer sees its tasks, even ones assigned to them', async () => {
    await api('POST', '/tasks', 'admin', {
      clientId: clientA,
      title: 'x',
      assignedUserId: ids.designer,
    });
    expect((await api('GET', '/tasks', 'designer')).json().meta.total).toBe(1);
    await call(app, 'DELETE', `/api/v1/clients/${clientA}/members/${ids.designer}`, as('admin'));
    expect((await api('GET', '/tasks', 'designer')).json().meta.total).toBe(0);
  });
});

describe('review fixes (Phase 4)', () => {
  it('a task whose assignee was deactivated can still be edited without reassigning', async () => {
    const id = (
      await api('POST', '/tasks', 'emp', {
        clientId: clientA,
        title: 'x',
        assignedUserId: ids.designer,
      })
    ).json().data.id;
    app.dbHandle.sqlite.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(ids.designer);
    // The edit form resends the unchanged assignee together with the real change.
    const res = await api('PATCH', `/tasks/${id}`, 'emp', {
      assignedUserId: ids.designer,
      status: 'in_progress',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('in_progress');
    // A real CHANGE to an inactive user is still rejected.
    const other = (
      await api('POST', '/tasks', 'emp', { clientId: clientA, title: 'y', assignedUserId: ids.emp })
    ).json().data.id;
    expect(
      (await api('PATCH', `/tasks/${other}`, 'emp', { assignedUserId: ids.designer })).statusCode,
    ).toBe(422);
  });

  it('overdue: flagged on tasks and on follow-ups in the record; never for archived clients', async () => {
    const comm = (await api('POST', `/clients/${clientA}/communications`, 'emp', CALL)).json().data;
    const id = (
      await api('POST', '/tasks', 'emp', {
        clientId: clientA,
        communicationId: comm.id,
        title: 'late',
        assignedUserId: ids.emp,
        dueAt: '2020-01-01T00:00:00Z',
      })
    ).json().data.id;
    expect((await api('GET', `/tasks/${id}`, 'emp')).json().data.overdue).toBe(true);
    expect(
      (await api('GET', `/communications/${comm.id}`, 'emp')).json().data.tasks[0].overdue,
    ).toBe(true);
    await api('POST', `/clients/${clientA}/archive`, 'admin', {});
    expect((await api('GET', `/tasks/${id}`, 'emp')).json().data.overdue).toBe(false);
    expect(
      (await api('GET', `/communications/${comm.id}`, 'emp')).json().data.tasks[0].overdue,
    ).toBe(false);
  });
});

describe("archived client's own task list", () => {
  it('still lists its active tasks when filtered to that client', async () => {
    await api('POST', '/tasks', 'emp', { clientId: clientA, title: 'x', assignedUserId: ids.emp });
    await api('POST', `/clients/${clientA}/archive`, 'admin', {});
    expect((await api('GET', '/tasks?scope=all', 'emp')).json().meta.total).toBe(0);
    expect(
      (await api('GET', `/tasks?scope=all&clientId=${clientA}`, 'emp')).json().meta.total,
    ).toBe(1);
  });
});
