/**
 * DEMO data only: fictional Israeli businesses and leads. Never real people or real clients.
 * - Emails use the reserved `.test` TLD (RFC 2606) — undeliverable by design.
 * - Phone numbers are invented; they may coincide with real numbers, so NEVER call or
 *   WhatsApp them from a demo database.
 * - Users get an unusable password hash; nobody can log in as a demo user.
 * Goes through the same services as the app, so all invariants apply.
 */
import { count } from 'drizzle-orm';
import { createUser } from './repositories/users.js';
import { clients, users } from './schema.js';
import { withTransaction, type Executor } from './tx.js';
import {
  addClientContact,
  addClientMember,
  createCampaign,
  createClient,
} from '../modules/clients/service.js';
import { changeLeadStage, createLead, logActivity } from '../modules/leads/service.js';
import { createTask } from '../modules/tasks/service.js';

export interface SeedSummary {
  users: number;
  clients: number;
  leads: number;
  tasks: number;
}

export class SeedRefusedError extends Error {}

export interface SeedOptions {
  nodeEnv: string;
  /** Explicit opt-in (CLI flag `--confirm-demo`). Never defaulted. */
  confirmed: boolean;
}

/** Environment/consent guard, usable before any DB is opened. Throws SeedRefusedError. */
export function assertSeedAllowed(opts: SeedOptions): void {
  if (opts.nodeEnv === 'production') {
    throw new SeedRefusedError('NODE_ENV=production. Demo data never goes into production.');
  }
  if (!opts.confirmed) {
    throw new SeedRefusedError(
      'Pass --confirm-demo to insert FICTIONAL demo data into this database.',
    );
  }
}

export function seedDemo(exec: Executor, opts: SeedOptions): SeedSummary {
  assertSeedAllowed(opts);
  return withTransaction(exec, (tx) => {
    // Checked inside the transaction: only a completely empty database is seeded.
    const existingUsers = tx.select({ n: count() }).from(users).get()?.n ?? 0;
    const existingClients = tx.select({ n: count() }).from(clients).get()?.n ?? 0;
    if (existingUsers > 0 || existingClients > 0) {
      throw new SeedRefusedError(
        `Database is not empty (${existingUsers} user(s), ${existingClients} client(s)); ` +
          'demo seed only runs on an empty database.',
      );
    }

    const admin = createUser(tx, {
      email: 'admin@demo-agency.test',
      displayName: 'מנהלת מערכת (דמו)',
      role: 'admin',
    });
    const manager = createUser(tx, {
      email: 'manager@demo-agency.test',
      displayName: 'יוסי מנהל לקוחות (דמו)',
      role: 'manager',
    });
    const dana = createUser(tx, {
      email: 'dana@demo-agency.test',
      displayName: 'דנה נציגה (דמו)',
      role: 'employee',
    });
    const amir = createUser(tx, {
      email: 'amir@demo-agency.test',
      displayName: 'אמיר נציג (דמו)',
      role: 'employee',
    });
    const actor = admin.id;

    const dental = createClient(
      tx,
      {
        name: 'מרפאת שיניים חיוך (דמו)',
        businessName: 'חיוך דנטל בע״מ (דמו)',
        industry: 'רפואת שיניים',
        phone: '03-0000001',
        email: 'office@smile-demo.test',
      },
      actor,
    );
    const law = createClient(
      tx,
      {
        name: 'משרד עו״ד לוי-כהן (דמו)',
        industry: 'משפטים',
        phone: '02-0000002',
        email: 'info@levi-cohen-demo.test',
      },
      actor,
    );
    const realty = createClient(
      tx,
      {
        name: 'נדל״ן הצפון (דמו)',
        industry: 'נדל״ן',
        phone: '04-0000003',
        email: 'sales@north-realty-demo.test',
      },
      actor,
    );

    addClientMember(
      tx,
      { clientId: dental.client.id, userId: manager.id, membershipRole: 'owner' },
      actor,
    );
    addClientMember(tx, { clientId: dental.client.id, userId: dana.id }, actor);
    addClientMember(
      tx,
      { clientId: law.client.id, userId: manager.id, membershipRole: 'owner' },
      actor,
    );
    addClientMember(tx, { clientId: law.client.id, userId: amir.id }, actor);
    addClientMember(tx, { clientId: realty.client.id, userId: amir.id }, actor);

    addClientContact(
      tx,
      {
        clientId: dental.client.id,
        name: 'ד״ר רונית (דמו)',
        title: 'בעלת המרפאה',
        phone: '050-0000101',
        email: 'ronit@smile-demo.test',
        isPrimary: true,
      },
      actor,
    );
    addClientContact(
      tx,
      { clientId: law.client.id, name: 'עו״ד משה (דמו)', title: 'שותף מנהל', isPrimary: true },
      actor,
    );

    const dentalMeta = createCampaign(
      tx,
      { clientId: dental.client.id, name: 'הלבנת שיניים – פייסבוק', channel: 'meta' },
      actor,
    );
    const dentalGoogle = createCampaign(
      tx,
      { clientId: dental.client.id, name: 'שתלים – חיפוש', channel: 'google' },
      actor,
    );
    const lawGoogle = createCampaign(
      tx,
      { clientId: law.client.id, name: 'דיני משפחה – חיפוש', channel: 'google' },
      actor,
    );
    const realtyMeta = createCampaign(
      tx,
      { clientId: realty.client.id, name: 'פרויקט חדש בחיפה – לידים', channel: 'meta' },
      actor,
    );

    type LeadSeed = {
      clientId: string;
      fullName: string;
      phone?: string;
      email?: string;
      source: Parameters<typeof createLead>[1]['source'];
      campaignId?: string;
      assignedUserId?: string;
      stageIndex?: number;
      description?: string;
    };
    const stageIds = {
      [dental.client.id]: dental.stages.map((s) => s.id),
      [law.client.id]: law.stages.map((s) => s.id),
      [realty.client.id]: realty.stages.map((s) => s.id),
    };

    const leadSeeds: LeadSeed[] = [
      {
        clientId: dental.client.id,
        fullName: 'נועה ישראלי (דמו)',
        phone: '050-0001001',
        source: 'meta',
        campaignId: dentalMeta.id,
        assignedUserId: dana.id,
      },
      {
        clientId: dental.client.id,
        fullName: 'אבי לוי (דמו)',
        phone: '052-0001002',
        email: 'avi@example-demo.test',
        source: 'google',
        campaignId: dentalGoogle.id,
        assignedUserId: dana.id,
        stageIndex: 1,
      },
      // Same person enquiring again with a differently formatted number → duplicate warning.
      {
        clientId: dental.client.id,
        fullName: 'נועה ישראלי (דמו)',
        phone: '+972 50 000 1001',
        source: 'web_form',
        description: 'פנייה חוזרת',
      },
      {
        clientId: dental.client.id,
        fullName: 'מיכל ברק (דמו)',
        phone: '054-0001003',
        source: 'whatsapp',
        assignedUserId: dana.id,
        stageIndex: 3,
      },
      {
        clientId: law.client.id,
        fullName: 'דוד מזרחי (דמו)',
        phone: '053-0002001',
        source: 'google',
        campaignId: lawGoogle.id,
        assignedUserId: amir.id,
        stageIndex: 2,
      },
      {
        clientId: law.client.id,
        fullName: 'שירה אברהם (דמו)',
        email: 'shira@example-demo.test',
        source: 'web_form',
        assignedUserId: amir.id,
      },
      {
        clientId: law.client.id,
        fullName: 'יוסף חדד (דמו)',
        phone: '058-0002002',
        source: 'phone',
        stageIndex: 4,
        description: 'מחפש ייעוץ בתחום אחר',
      },
      {
        clientId: realty.client.id,
        fullName: 'רותם גולן (דמו)',
        phone: '050-0003001',
        source: 'meta',
        campaignId: realtyMeta.id,
        assignedUserId: amir.id,
      },
      {
        clientId: realty.client.id,
        fullName: 'עומר פרץ (דמו)',
        phone: '052-0003002',
        source: 'meta',
        campaignId: realtyMeta.id,
        assignedUserId: amir.id,
        stageIndex: 1,
      },
      {
        clientId: realty.client.id,
        fullName: 'ליאת שמש (דמו)',
        phone: '054-0003003',
        email: 'liat@example-demo.test',
        source: 'referral',
      },
    ];

    const created = leadSeeds.map((s) => {
      const { lead } = createLead(
        tx,
        {
          clientId: s.clientId,
          fullName: s.fullName,
          phone: s.phone ?? null,
          email: s.email ?? null,
          source: s.source,
          campaignId: s.campaignId ?? null,
          assignedUserId: s.assignedUserId ?? null,
          description: s.description ?? null,
        },
        actor,
      );
      const target = s.stageIndex ? stageIds[s.clientId]?.[s.stageIndex] : undefined;
      return target ? changeLeadStage(tx, { leadId: lead.id, stageId: target }, actor) : lead;
    });

    const [noa, avi, , , david, , , rotem] = created;
    logActivity(
      tx,
      { leadId: avi!.id, type: 'call', body: 'שיחה ראשונה, מעוניין בפגישת ייעוץ' },
      dana.id,
    );
    logActivity(tx, { leadId: david!.id, type: 'whatsapp', body: 'נשלחו פרטי פגישה' }, amir.id);

    const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
    const taskSeeds = [
      {
        clientId: dental.client.id,
        leadId: noa!.id,
        assignedUserId: dana.id,
        title: 'לחזור לנועה לגבי הצעת מחיר',
        dueAt: inDays(1),
      },
      {
        clientId: dental.client.id,
        leadId: avi!.id,
        assignedUserId: dana.id,
        title: 'לאשר מועד פגישה',
        dueAt: inDays(-1),
      },
      {
        clientId: law.client.id,
        leadId: david!.id,
        assignedUserId: amir.id,
        title: 'לשלוח הסכם שכר טרחה',
        dueAt: inDays(2),
      },
      {
        clientId: realty.client.id,
        leadId: rotem!.id,
        assignedUserId: amir.id,
        title: 'לתאם סיור בדירה לדוגמה',
        dueAt: inDays(3),
      },
    ];
    taskSeeds.forEach((t) => createTask(tx, t, actor));

    return { users: 4, clients: 3, leads: created.length, tasks: taskSeeds.length };
  });
}
