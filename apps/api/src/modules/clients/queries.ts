import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { API_PREFIX } from '@agency-crm/shared';
import type {
  ClientDto,
  ClientListMeta,
  ClientPermissions,
  ClientSortField,
  ClientStaffMember,
} from '@agency-crm/shared';
import { clientMembers, clientStatuses, clients, users, type Client } from '../../db/schema.js';
import type { Executor } from '../../db/tx.js';
import type { Actor } from '../auth/authorize.js';

/** Allowlisted sort columns — `sort` from the request can only pick from this map. */
const SORT_COLUMNS = {
  name: clients.name,
  businessName: clients.businessName,
  // Admin-defined status, in the order the admin arranged them (position).
  status: sql`(SELECT position FROM client_statuses WHERE client_statuses.id = ${clients.statusId})`,
  updatedAt: clients.updatedAt,
  createdAt: clients.createdAt,
} as const satisfies Record<ClientSortField, unknown>;

/** Escapes LIKE wildcards so user input is matched literally. */
const likePattern = (q: string) => `%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export interface ClientListParams {
  page: number;
  pageSize: number;
  q?: string | undefined;
  status: 'current' | 'archived' | 'all';
  statusId?: string | undefined;
  ownerId?: string | undefined;
  sort: ClientSortField;
  dir: 'asc' | 'desc';
}

/**
 * Lists the clients the actor may see. Scoping is part of the SQL (non-admins only ever get
 * rows they are members of), never a post-filter, so pagination and totals are correct and
 * nothing outside the actor's scope is ever loaded.
 */
export function listClientsForActor(
  exec: Executor,
  actor: Actor,
  p: ClientListParams,
): { rows: ClientDto[]; meta: ClientListMeta } {
  const where: SQL[] = [];

  if (actor.role !== 'admin') {
    where.push(
      inArray(
        clients.id,
        exec
          .select({ id: clientMembers.clientId })
          .from(clientMembers)
          .where(eq(clientMembers.userId, actor.id)),
      ),
    );
  }

  if (p.status === 'current') where.push(isNull(clients.archivedAt));
  else if (p.status === 'archived') where.push(isNotNull(clients.archivedAt));
  if (p.statusId) where.push(eq(clients.statusId, p.statusId));

  if (p.q) {
    const pattern = likePattern(p.q);
    const conditions: SQL[] = [
      sql`lower(${clients.name}) LIKE ${pattern} ESCAPE '\\'`,
      sql`lower(coalesce(${clients.businessName}, '')) LIKE ${pattern} ESCAPE '\\'`,
      sql`lower(coalesce(${clients.email}, '')) LIKE ${pattern} ESCAPE '\\'`,
      sql`coalesce(${clients.phone}, '') LIKE ${pattern} ESCAPE '\\'`,
      sql`lower(coalesce(${clients.industry}, '')) LIKE ${pattern} ESCAPE '\\'`,
    ];
    // Phone search ignores formatting: "0501234567" finds "050-123-4567" / "(050) 123 4567".
    const digits = p.q.replace(/[\s().+-]/g, '');
    if (/^\d{3,}$/.test(digits)) {
      conditions.push(
        sql`replace(replace(replace(replace(replace(replace(coalesce(${clients.phone}, ''), '-', ''), ' ', ''), '(', ''), ')', ''), '.', ''), '+', '') LIKE ${`%${digits}%`}`,
      );
    }
    where.push(or(...conditions)!);
  }

  if (p.ownerId) {
    where.push(
      inArray(
        clients.id,
        exec
          .select({ id: clientMembers.clientId })
          .from(clientMembers)
          .where(
            and(eq(clientMembers.userId, p.ownerId), eq(clientMembers.membershipRole, 'owner')),
          ),
      ),
    );
  }

  const condition = where.length ? and(...where) : undefined;
  const total = exec.select({ n: count() }).from(clients).where(condition).get()?.n ?? 0;

  const column = SORT_COLUMNS[p.sort];
  const order = p.dir === 'desc' ? desc(column) : asc(column);
  const rows = exec
    .select()
    .from(clients)
    .where(condition)
    // Secondary key keeps paging stable when the sort column has duplicates/NULLs.
    .orderBy(order, asc(clients.id))
    .limit(p.pageSize)
    .offset((p.page - 1) * p.pageSize)
    .all();

  return {
    rows: toClientDtos(exec, actor, rows),
    meta: { page: p.page, pageSize: p.pageSize, total },
  };
}

/** Adds owners, member counts and the actor's permissions to client rows (2 queries total). */
export function toClientDtos(exec: Executor, actor: Actor, rows: Client[]): ClientDto[] {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const memberRows = exec
    .select({
      clientId: clientMembers.clientId,
      userId: clientMembers.userId,
      membershipRole: clientMembers.membershipRole,
      displayName: users.displayName,
    })
    .from(clientMembers)
    .innerJoin(users, eq(users.id, clientMembers.userId))
    .where(inArray(clientMembers.clientId, ids))
    .all();

  const statusIds = [...new Set(rows.map((r) => r.statusId).filter((x): x is string => !!x))];
  const statuses = new Map(
    (statusIds.length
      ? exec
          .select({ id: clientStatuses.id, name: clientStatuses.name, color: clientStatuses.color })
          .from(clientStatuses)
          .where(inArray(clientStatuses.id, statusIds))
          .all()
      : []
    ).map((st) => [st.id, st] as const),
  );

  return rows.map((c) => {
    const members = memberRows.filter((m) => m.clientId === c.id);
    const mine = members.find((m) => m.userId === actor.id);
    return {
      id: c.id,
      name: c.name,
      businessName: c.businessName,
      status: c.archivedAt ? 'archived' : 'active',
      industry: c.industry,
      phone: c.phone,
      email: c.email,
      notes: c.notes,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      archivedAt: c.archivedAt,
      clientStatus: (c.statusId && statuses.get(c.statusId)) || null,
      // Session-protected same-origin URL; the version query busts the browser cache on change.
      photoUrl: c.photoType
        ? `${API_PREFIX}/clients/${c.id}/photo?v=${encodeURIComponent(c.photoUpdatedAt ?? '')}`
        : null,
      owners: members
        .filter((m) => m.membershipRole === 'owner')
        .map((m) => ({ userId: m.userId, displayName: m.displayName })),
      memberCount: members.length,
      permissions: permissionsFor(actor, c, mine?.membershipRole ?? null),
    };
  });
}

/** Mirrors authorizeClientAccess so the UI only offers what the server will accept. */
export function permissionsFor(
  actor: Actor,
  client: Client,
  membershipRole: 'owner' | 'collaborator' | null,
): ClientPermissions {
  const isAdmin = actor.role === 'admin';
  const isMember = membershipRole !== null;
  const isOwnerManager = actor.role === 'manager' && membershipRole === 'owner';
  const open = client.archivedAt === null;
  return {
    // Any member edits details/status/contacts (ADR-019); staff: admins + owner-managers.
    canEdit: (isAdmin || isMember) && open,
    canManageStaff: (isAdmin || isOwnerManager) && open,
    canManageContacts: (isAdmin || isMember) && open,
    canArchive: isAdmin,
  };
}

export function listStaff(exec: Executor, clientId: string): ClientStaffMember[] {
  return exec
    .select({
      userId: users.id,
      displayName: users.displayName,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
      membershipRole: clientMembers.membershipRole,
    })
    .from(clientMembers)
    .innerJoin(users, eq(users.id, clientMembers.userId))
    .where(eq(clientMembers.clientId, clientId))
    .orderBy(desc(clientMembers.membershipRole), asc(users.displayName))
    .all();
}
