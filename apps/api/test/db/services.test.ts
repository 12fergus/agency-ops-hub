import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DbHandle } from '../../src/db/client.js';
import { auditEvents, leadActivities, leadImportBatches, leads } from '../../src/db/schema.js';
import { withTransaction } from '../../src/db/tx.js';
import { AppError } from '../../src/lib/errors.js';
import { UUID_V7_RE } from '../../src/lib/ids.js';
import { addClientContact } from '../../src/modules/clients/service.js';
import {
  assignLead,
  changeLeadStage,
  createLead,
  logActivity,
} from '../../src/modules/leads/service.js';
import { createTask } from '../../src/modules/tasks/service.js';
import { freshDb, twoClients } from '../helpers/db.js';

let h: DbHandle;
let f: ReturnType<typeof twoClients>;
beforeEach(() => {
  h = freshDb();
  f = twoClients(h);
});
afterEach(() => h.close());

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
  return 'NO_ERROR';
};
const countLeads = () => h.db.select().from(leads).all().length;

describe('createLead (service boundary)', () => {
  it('creates a lead in the default pipeline/first stage with server-owned id and UTC timestamps', () => {
    const { lead, duplicates } = createLead(
      h.db,
      {
        clientId: f.a.client.id,
        fullName: ' Test Lead ',
        source: 'manual',
        phone: '050-123-4567',
        email: ' A@B.test ',
      },
      f.employee.id,
    );
    expect(lead.id).toMatch(UUID_V7_RE);
    expect(lead.fullName).toBe('Test Lead');
    expect(lead.pipelineId).toBe(f.a.pipeline.id);
    expect(lead.stageId).toBe(f.a.stages[0]!.id);
    expect(lead.phoneRaw).toBe('050-123-4567');
    expect(lead.phoneNormalized).toBe('+972501234567');
    expect(lead.email).toBe('a@b.test');
    expect(lead.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(duplicates).toEqual([]);
    const audit = h.db.select().from(auditEvents).where(eq(auditEvents.entityId, lead.id)).all();
    expect(audit).toHaveLength(1);
  });

  it('rejects cross-client pipeline, stage and campaign with CROSS_CLIENT_REFERENCE', () => {
    const base = { clientId: f.a.client.id, fullName: 'X', source: 'manual' as const };
    expect(code(() => createLead(h.db, { ...base, pipelineId: f.b.pipeline.id }, null))).toBe(
      'CROSS_CLIENT_REFERENCE',
    );
    expect(code(() => createLead(h.db, { ...base, stageId: f.b.stages[1]!.id }, null))).toBe(
      'CROSS_CLIENT_REFERENCE',
    );
    expect(code(() => createLead(h.db, { ...base, campaignId: f.campaignB.id }, null))).toBe(
      'CROSS_CLIENT_REFERENCE',
    );
    expect(countLeads()).toBe(0);
  });

  it('rejects assignees without access; admins and members are allowed', () => {
    const base = { clientId: f.a.client.id, fullName: 'X', source: 'manual' as const };
    expect(code(() => createLead(h.db, { ...base, assignedUserId: f.outsider.id }, null))).toBe(
      'INVALID_ASSIGNEE',
    );
    expect(code(() => createLead(h.db, { ...base, assignedUserId: f.employee.id }, null))).toBe(
      'NO_ERROR',
    );
    expect(code(() => createLead(h.db, { ...base, assignedUserId: f.admin.id }, null))).toBe(
      'NO_ERROR',
    );
    // Member of A is not automatically allowed on B.
    expect(
      code(() =>
        createLead(h.db, { ...base, clientId: f.b.client.id, assignedUserId: f.employee.id }, null),
      ),
    ).toBe('INVALID_ASSIGNEE');
  });

  it('warns about duplicates by normalized phone/email within the same client only', () => {
    const first = createLead(
      h.db,
      { clientId: f.a.client.id, fullName: 'One', source: 'manual', phone: '050-1234567' },
      null,
    );
    const sameClient = createLead(
      h.db,
      { clientId: f.a.client.id, fullName: 'Two', source: 'web_form', phone: '+972 50 123 4567' },
      null,
    );
    expect(sameClient.duplicates.map((d) => d.id)).toEqual([first.lead.id]);
    expect(sameClient.duplicates[0]!.matchedOn).toEqual(['phone']);

    const otherClient = createLead(
      h.db,
      { clientId: f.b.client.id, fullName: 'Three', source: 'manual', phone: '0501234567' },
      null,
    );
    expect(otherClient.duplicates).toEqual([]);
    expect(countLeads()).toBe(3); // warning only, never blocking
  });

  it('rejects archived clients', () => {
    h.sqlite
      .prepare(
        "UPDATE clients SET status='archived', archived_at='2026-01-01T00:00:00.000Z' WHERE id=?",
      )
      .run(f.a.client.id);
    expect(
      code(() =>
        createLead(h.db, { clientId: f.a.client.id, fullName: 'X', source: 'manual' }, null),
      ),
    ).toBe('INVALID_STATE');
  });
});

describe('tasks and stage changes', () => {
  it("createTask rejects another client's lead and an assignee without access", () => {
    const { lead } = createLead(
      h.db,
      { clientId: f.a.client.id, fullName: 'L', source: 'manual' },
      null,
    );
    expect(
      code(() =>
        createTask(
          h.db,
          { clientId: f.b.client.id, leadId: lead.id, assignedUserId: f.admin.id, title: 't' },
          null,
        ),
      ),
    ).toBe('CROSS_CLIENT_REFERENCE');
    expect(
      code(() =>
        createTask(
          h.db,
          { clientId: f.a.client.id, leadId: lead.id, assignedUserId: f.outsider.id, title: 't' },
          null,
        ),
      ),
    ).toBe('INVALID_ASSIGNEE');
    expect(
      code(() =>
        createTask(
          h.db,
          { clientId: f.a.client.id, leadId: lead.id, assignedUserId: f.employee.id, title: 't' },
          null,
        ),
      ),
    ).toBe('NO_ERROR');
  });

  it("changeLeadStage rejects a stage from another client's pipeline", () => {
    const { lead } = createLead(
      h.db,
      { clientId: f.a.client.id, fullName: 'L', source: 'manual' },
      null,
    );
    expect(
      code(() =>
        changeLeadStage(h.db, { leadId: lead.id, stageId: f.b.stages[2]!.id }, f.admin.id),
      ),
    ).toBe('CROSS_CLIENT_REFERENCE');
    const moved = changeLeadStage(
      h.db,
      { leadId: lead.id, stageId: f.a.stages[2]!.id },
      f.admin.id,
    );
    expect(moved.stageId).toBe(f.a.stages[2]!.id);
    expect(
      h.db.select().from(leadActivities).where(eq(leadActivities.leadId, lead.id)).all(),
    ).toHaveLength(1);
  });

  it('assignLead enforces access', () => {
    const { lead } = createLead(
      h.db,
      { clientId: f.a.client.id, fullName: 'L', source: 'manual' },
      null,
    );
    expect(
      code(() => assignLead(h.db, { leadId: lead.id, assignedUserId: f.outsider.id }, null)),
    ).toBe('INVALID_ASSIGNEE');
    expect(
      assignLead(h.db, { leadId: lead.id, assignedUserId: f.employee.id }, null).assignedUserId,
    ).toBe(f.employee.id);
  });
});

describe('review fixes', () => {
  it('audit snapshots for leads and tasks contain no PII', () => {
    const { lead } = createLead(
      h.db,
      {
        clientId: f.a.client.id,
        fullName: 'Secret Name',
        source: 'manual',
        phone: '050-1234567',
        email: 'pii@x.test',
        description: 'private note',
      },
      null,
    );
    createTask(
      h.db,
      {
        clientId: f.a.client.id,
        leadId: lead.id,
        assignedUserId: f.admin.id,
        title: 'Call Secret Name',
        description: 'private',
      },
      null,
    );
    const dump = JSON.stringify(
      h.sqlite.prepare('SELECT before_json, after_json FROM audit_events').all(),
    );
    for (const pii of ['Secret Name', '050-1234567', '+972501234567', 'pii@x.test', 'private']) {
      expect(dump, pii).not.toContain(pii);
    }
    expect(dump).toContain(lead.id);
  });

  it('rejects zoneless due dates and normalizes zoned ones to UTC', () => {
    const base = { clientId: f.a.client.id, assignedUserId: f.admin.id, title: 't' };
    expect(code(() => createTask(h.db, { ...base, dueAt: '2026-12-01 09:00' }, null))).toBe(
      'VALIDATION',
    );
    const task = createTask(h.db, { ...base, dueAt: '2026-12-01T09:00:00+02:00' }, null);
    expect(task.dueAt).toBe('2026-12-01T07:00:00.000Z');
  });

  it("rejects another client's import batch at the service boundary", () => {
    const batch = h.db
      .insert(leadImportBatches)
      .values({ clientId: f.b.client.id, actorUserId: f.admin.id, fileName: 'b.csv' })
      .returning()
      .get();
    expect(
      code(() =>
        createLead(
          h.db,
          { clientId: f.a.client.id, fullName: 'X', source: 'csv_import', importBatchId: batch.id },
          null,
        ),
      ),
    ).toBe('CROSS_CLIENT_REFERENCE');
  });

  it('archived leads cannot be assigned or get activities', () => {
    const { lead } = createLead(
      h.db,
      { clientId: f.a.client.id, fullName: 'L', source: 'manual' },
      null,
    );
    h.sqlite
      .prepare("UPDATE leads SET archived_at = '2026-01-01T00:00:00.000Z' WHERE id = ?")
      .run(lead.id);
    expect(
      code(() => assignLead(h.db, { leadId: lead.id, assignedUserId: f.employee.id }, null)),
    ).toBe('INVALID_STATE');
    expect(
      code(() => logActivity(h.db, { leadId: lead.id, type: 'note', body: 'x' }, f.admin.id)),
    ).toBe('INVALID_STATE');
  });
});

describe('transactions', () => {
  it('rolls back every write when the callback throws', () => {
    expect(() =>
      withTransaction(h.db, (tx) => {
        createLead(
          tx,
          { clientId: f.a.client.id, fullName: 'Rolled back', source: 'manual' },
          null,
        );
        expect(countLeads()).toBe(1); // visible inside the open transaction (same connection)
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(countLeads()).toBe(0);
    expect(
      h.db.select().from(auditEvents).where(eq(auditEvents.entityType, 'lead')).all(),
    ).toHaveLength(0);
  });

  it('a multi-step service is atomic: a failing step undoes the earlier ones', () => {
    const { lead } = createLead(
      h.db,
      { clientId: f.a.client.id, fullName: 'L', source: 'manual' },
      null,
    );
    // Non-existent actor → the activity insert (2nd step) fails its FK after the stage update (1st step).
    expect(() =>
      changeLeadStage(h.db, { leadId: lead.id, stageId: f.a.stages[1]!.id }, 'ghost-user'),
    ).toThrow(/FOREIGN KEY/);
    const after = h.db.select().from(leads).where(eq(leads.id, lead.id)).get();
    expect(after?.stageId).toBe(f.a.stages[0]!.id);
    expect(h.db.select().from(leadActivities).all()).toHaveLength(0);
  });

  it('nested services use savepoints: inner failure caught by caller keeps outer work', () => {
    withTransaction(h.db, (tx) => {
      addClientContact(tx, { clientId: f.a.client.id, name: 'Kept', isPrimary: true }, null);
      expect(() =>
        createLead(
          tx,
          { clientId: f.a.client.id, fullName: 'X', source: 'manual', campaignId: f.campaignB.id },
          null,
        ),
      ).toThrow(AppError);
    });
    expect(h.sqlite.prepare('SELECT name FROM client_contacts').pluck().all()).toEqual(['Kept']);
    expect(countLeads()).toBe(0);
  });

  it('refuses async callbacks', () => {
    expect(() => withTransaction(h.db, async () => undefined)).toThrow(/synchronous/);
  });
});
