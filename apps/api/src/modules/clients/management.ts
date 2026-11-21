import { and, asc, desc, eq, ne } from 'drizzle-orm';
import type { AssignableUser, ClientDto, ContactDto } from '@agency-crm/shared';
import { recordAudit } from '../../db/repositories/audit.js';
import { clearPrimaryContact } from '../../db/repositories/clients.js';
import {
  clientContacts,
  clients,
  users,
  type Client,
  type ClientContact,
  clientCommunications,
} from '../../db/schema.js';
import { withTransaction, type Executor } from '../../db/tx.js';
import { invalidState, notFound } from '../../lib/errors.js';
import { nowIso } from '../../lib/normalize.js';
import { authorizeClientAccess, requireRole, type Actor } from '../auth/authorize.js';
import { requireStatus } from '../client-statuses/service.js';
import { addClientMember, createClient } from './service.js';
import { toClientDtos } from './queries.js';

type ClientFields = {
  name: string;
  businessName?: string | null | undefined;
  industry?: string | null | undefined;
  phone?: string | null | undefined;
  email?: string | null | undefined;
  notes?: string | null | undefined;
  statusId?: string | undefined;
};

/** A PATCH body: every field optional and explicitly allowed to be undefined. */
type Patch<T> = { [K in keyof T]?: T[K] | undefined };

const auditView = (c: Client) => ({
  name: c.name,
  businessName: c.businessName,
  statusId: c.statusId,
  industry: c.industry,
  archivedAt: c.archivedAt,
});

export function getClientDto(exec: Executor, actor: Actor, clientId: string): ClientDto {
  const { client } = authorizeClientAccess(exec, actor, clientId, 'client:read');
  return toClientDtos(exec, actor, [client])[0]!;
}

/**
 * Any role may create a client (ADR-019). The creator is assigned automatically so they can see
 * what they created: managers as OWNER, employees as collaborator. Admins see everything anyway
 * and are not added.
 */
export function createClientAsActor(exec: Executor, actor: Actor, input: ClientFields): ClientDto {
  return withTransaction(exec, (tx) => {
    const statusId = input.statusId ? requireStatus(tx, input.statusId).id : undefined;
    const { client } = createClient(
      tx,
      {
        name: input.name,
        businessName: input.businessName ?? null,
        industry: input.industry ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        notes: input.notes ?? null,
        ...(statusId ? { statusId } : {}),
      },
      actor.id,
    );
    if (actor.role !== 'admin') {
      addClientMember(
        tx,
        {
          clientId: client.id,
          userId: actor.id,
          membershipRole: actor.role === 'manager' ? 'owner' : 'collaborator',
        },
        actor.id,
      );
    }
    return toClientDtos(tx, actor, [client])[0]!;
  });
}

/** Any member of the client, or an admin (ADR-019). Archived clients must be unarchived first. */
export function updateClientAsActor(
  exec: Executor,
  actor: Actor,
  clientId: string,
  patch: Patch<ClientFields>,
): ClientDto {
  return withTransaction(exec, (tx) => {
    const { client } = authorizeClientAccess(tx, actor, clientId, 'client:edit');
    if (client.archivedAt) throw invalidState('Client is archived');
    if (patch.statusId !== undefined) requireStatus(tx, patch.statusId);
    const values = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    ) as Patch<ClientFields>;
    const updated = tx
      .update(clients)
      .set(values)
      .where(eq(clients.id, clientId))
      .returning()
      .get();
    recordAudit(tx, {
      actorUserId: actor.id,
      clientId,
      entityType: 'client',
      entityId: clientId,
      action: 'update',
      before: auditView(client),
      after: auditView(updated),
    });
    return toClientDtos(tx, actor, [updated])[0]!;
  });
}

/**
 * Archive instead of delete: the client, its members, contacts, leads and history stay in the
 * database untouched; the client just leaves the default lists and becomes read-only.
 */
export function setArchivedAsActor(
  exec: Executor,
  actor: Actor,
  clientId: string,
  archived: boolean,
): ClientDto {
  return withTransaction(exec, (tx) => {
    const { client } = authorizeClientAccess(tx, actor, clientId, 'client:archive');
    if (archived === (client.archivedAt !== null)) return toClientDtos(tx, actor, [client])[0]!;
    const updated = tx
      .update(clients)
      .set(
        archived
          ? { status: 'archived', archivedAt: nowIso() }
          : { status: 'active', archivedAt: null },
      )
      .where(eq(clients.id, clientId))
      .returning()
      .get();
    recordAudit(tx, {
      actorUserId: actor.id,
      clientId,
      entityType: 'client',
      entityId: clientId,
      action: archived ? 'archive' : 'unarchive',
      before: auditView(client),
      after: auditView(updated),
    });
    return toClientDtos(tx, actor, [updated])[0]!;
  });
}

// ---------- contacts ----------

const toContactDto = (c: ClientContact): ContactDto => ({
  id: c.id,
  clientId: c.clientId,
  name: c.name,
  title: c.title,
  phone: c.phone,
  email: c.email,
  isPrimary: c.isPrimary,
});

export function listContactsAsActor(exec: Executor, actor: Actor, clientId: string): ContactDto[] {
  authorizeClientAccess(exec, actor, clientId, 'client:read');
  return exec
    .select()
    .from(clientContacts)
    .where(eq(clientContacts.clientId, clientId))
    .orderBy(desc(clientContacts.isPrimary), asc(clientContacts.name))
    .all()
    .map(toContactDto);
}

/** Member (or admin) of a NON-archived client — the guard for every client-scoped write. */
export function requireEditableClient(tx: Executor, actor: Actor, clientId: string): Client {
  const { client } = authorizeClientAccess(tx, actor, clientId, 'client:edit');
  if (client.archivedAt) throw invalidState('Client is archived');
  return client;
}

/** A contact id is only valid together with ITS client id (no cross-client contact access). */
function findContactInClient(tx: Executor, clientId: string, contactId: string): ClientContact {
  const contact = tx
    .select()
    .from(clientContacts)
    .where(and(eq(clientContacts.id, contactId), eq(clientContacts.clientId, clientId)))
    .get();
  if (!contact) throw notFound('Contact');
  return contact;
}

type ContactFields = {
  name: string;
  title?: string | null | undefined;
  phone?: string | null | undefined;
  email?: string | null | undefined;
  isPrimary?: boolean | undefined;
};

export function createContactAsActor(
  exec: Executor,
  actor: Actor,
  clientId: string,
  input: ContactFields,
): ContactDto {
  return withTransaction(exec, (tx) => {
    requireEditableClient(tx, actor, clientId);
    if (input.isPrimary) clearPrimaryContact(tx, clientId);
    const contact = tx
      .insert(clientContacts)
      .values({
        clientId,
        name: input.name,
        title: input.title ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        isPrimary: input.isPrimary ?? false,
      })
      .returning()
      .get();
    recordAudit(tx, {
      actorUserId: actor.id,
      clientId,
      entityType: 'client_contact',
      entityId: contact.id,
      action: 'create',
      after: { isPrimary: contact.isPrimary },
    });
    return toContactDto(contact);
  });
}

export function updateContactAsActor(
  exec: Executor,
  actor: Actor,
  clientId: string,
  contactId: string,
  patch: Patch<ContactFields>,
): ContactDto {
  return withTransaction(exec, (tx) => {
    requireEditableClient(tx, actor, clientId);
    findContactInClient(tx, clientId, contactId);
    if (patch.isPrimary) clearPrimaryContact(tx, clientId);
    const values = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const updated = tx
      .update(clientContacts)
      .set(values)
      .where(eq(clientContacts.id, contactId))
      .returning()
      .get();
    recordAudit(tx, {
      actorUserId: actor.id,
      clientId,
      entityType: 'client_contact',
      entityId: contactId,
      action: 'update',
    });
    return toContactDto(updated);
  });
}

/** Contacts are reference data without history attached, so they may be removed. */
export function deleteContactAsActor(
  exec: Executor,
  actor: Actor,
  clientId: string,
  contactId: string,
): void {
  withTransaction(exec, (tx) => {
    requireEditableClient(tx, actor, clientId);
    findContactInClient(tx, clientId, contactId);
    // Communication records keep their history; they just no longer name this contact.
    tx.update(clientCommunications)
      .set({ contactId: null })
      .where(eq(clientCommunications.contactId, contactId))
      .run();
    tx.delete(clientContacts).where(eq(clientContacts.id, contactId)).run();
    recordAudit(tx, {
      actorUserId: actor.id,
      clientId,
      entityType: 'client_contact',
      entityId: contactId,
      action: 'delete',
    });
  });
}

// ---------- staff picker ----------

/** Active, approved managers/employees — candidates for client staff. Admins and managers only. */
export function listAssignableUsers(exec: Executor, actor: Actor): AssignableUser[] {
  requireRole(actor, 'admin', 'manager');
  return exec
    .select({ id: users.id, displayName: users.displayName, email: users.email, role: users.role })
    .from(users)
    .where(and(eq(users.isActive, true), ne(users.role, 'admin')))
    .orderBy(asc(users.displayName))
    .all() as AssignableUser[];
}
