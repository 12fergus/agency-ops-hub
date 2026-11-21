import { recordAudit } from '../../db/repositories/audit.js';
import {
  findCampaignById,
  findDefaultPipeline,
  findPipelineById,
  findStageById,
  listStages,
} from '../../db/repositories/clients.js';
import {
  findDuplicateCandidates,
  findImportBatchById,
  findLeadById,
  insertActivity,
  insertLead,
  updateLead,
  type DuplicateCandidate,
} from '../../db/repositories/leads.js';
import { userCanAccessClient } from '../../db/repositories/users.js';
import type { ActivityType, Lead, LeadActivity, LeadSource } from '../../db/schema.js';
import { withTransaction, type Executor } from '../../db/tx.js';
import {
  crossClient,
  forbidden,
  invalidAssignee,
  invalidState,
  notFound,
} from '../../lib/errors.js';
import { normalizeEmail, normalizePhone, nowIso, parseTimestamp } from '../../lib/normalize.js';
import { requireActiveClient } from '../clients/service.js';

/**
 * Audit view of a lead: references and state only. Name/phone/email/description are PII and
 * stay out of the append-only audit table (erasure requests must not need to rewrite history).
 */
export function auditLeadView(lead: Lead) {
  return {
    id: lead.id,
    clientId: lead.clientId,
    pipelineId: lead.pipelineId,
    stageId: lead.stageId,
    campaignId: lead.campaignId,
    importBatchId: lead.importBatchId,
    assignedUserId: lead.assignedUserId,
    source: lead.source,
    consentStatus: lead.consentStatus,
    archivedAt: lead.archivedAt,
  };
}

/** Lead exists, is not archived, and its client is active. */
function requireWritableLead(tx: Executor, leadId: string): Lead {
  const lead = findLeadById(tx, leadId);
  if (!lead) throw notFound('Lead');
  if (lead.archivedAt) throw invalidState('Lead is archived');
  requireActiveClient(tx, lead.clientId);
  return lead;
}

export interface CreateLeadInput {
  clientId: string;
  fullName: string;
  source: LeadSource;
  phone?: string | null;
  email?: string | null;
  pipelineId?: string | null;
  stageId?: string | null;
  campaignId?: string | null;
  assignedUserId?: string | null;
  sourceExternalId?: string | null;
  importBatchId?: string | null;
  consentStatus?: Lead['consentStatus'];
  description?: string | null;
}

export interface CreatedLead {
  lead: Lead;
  /** Potential duplicates in the same client — shown as a warning, never blocking. */
  duplicates: DuplicateCandidate[];
}

/**
 * Service boundary for lead creation. Every referenced ID is re-checked against `clientId`
 * (pipeline, stage, campaign, assignee access). The DB has composite FKs as a second line.
 */
export function createLead(
  exec: Executor,
  input: CreateLeadInput,
  actorUserId: string | null,
): CreatedLead {
  return withTransaction(exec, (tx) => {
    requireActiveClient(tx, input.clientId);

    const pipeline = input.pipelineId
      ? findPipelineById(tx, input.pipelineId)
      : findDefaultPipeline(tx, input.clientId);
    if (!pipeline) throw notFound('Pipeline');
    if (pipeline.clientId !== input.clientId) throw crossClient('Pipeline');

    let stageId = input.stageId ?? null;
    if (stageId) {
      const stage = findStageById(tx, stageId);
      if (!stage) throw notFound('Stage');
      if (stage.pipelineId !== pipeline.id) throw crossClient('Stage');
    } else {
      const first = listStages(tx, pipeline.id)[0];
      if (!first) throw invalidState('Pipeline has no stages');
      stageId = first.id;
    }

    if (input.campaignId) {
      const campaign = findCampaignById(tx, input.campaignId);
      if (!campaign) throw notFound('Campaign');
      if (campaign.clientId !== input.clientId) throw crossClient('Campaign');
    }

    if (input.importBatchId) {
      const batch = findImportBatchById(tx, input.importBatchId);
      if (!batch) throw notFound('Import batch');
      if (batch.clientId !== input.clientId) throw crossClient('Import batch');
    }

    if (input.assignedUserId && !userCanAccessClient(tx, input.assignedUserId, input.clientId)) {
      throw invalidAssignee();
    }

    const phoneRaw = input.phone?.trim() || null;
    const phoneNormalized = normalizePhone(phoneRaw);
    const email = normalizeEmail(input.email);
    const duplicates = findDuplicateCandidates(tx, input.clientId, { phoneNormalized, email });

    const consentStatus = input.consentStatus ?? 'unknown';
    const lead = insertLead(tx, {
      clientId: input.clientId,
      pipelineId: pipeline.id,
      stageId,
      campaignId: input.campaignId ?? null,
      importBatchId: input.importBatchId ?? null,
      assignedUserId: input.assignedUserId ?? null,
      fullName: input.fullName.trim(),
      phoneRaw,
      phoneNormalized,
      email,
      source: input.source,
      sourceExternalId: input.sourceExternalId ?? null,
      consentStatus,
      consentAt: consentStatus === 'unknown' ? null : nowIso(),
      description: input.description ?? null,
    });

    recordAudit(tx, {
      actorUserId,
      clientId: lead.clientId,
      entityType: 'lead',
      entityId: lead.id,
      action: 'create',
      after: auditLeadView(lead),
    });
    return { lead, duplicates };
  });
}

/** Moves a lead to another stage of ITS pipeline; logs a stage_change activity + audit atomically. */
export function changeLeadStage(
  exec: Executor,
  input: { leadId: string; stageId: string },
  actorUserId: string,
): Lead {
  return withTransaction(exec, (tx) => {
    const lead = requireWritableLead(tx, input.leadId);
    const stage = findStageById(tx, input.stageId);
    if (!stage) throw notFound('Stage');
    if (stage.pipelineId !== lead.pipelineId) throw crossClient('Stage');
    if (stage.id === lead.stageId) return lead;

    const updated = updateLead(tx, lead.clientId, lead.id, { stageId: stage.id });
    insertActivity(tx, {
      leadId: lead.id,
      actorUserId,
      type: 'stage_change',
      metadataJson: JSON.stringify({ fromStageId: lead.stageId, toStageId: stage.id }),
    });
    recordAudit(tx, {
      actorUserId,
      clientId: lead.clientId,
      entityType: 'lead',
      entityId: lead.id,
      action: 'stage_change',
      before: { stageId: lead.stageId },
      after: { stageId: stage.id },
    });
    return updated;
  });
}

export function assignLead(
  exec: Executor,
  input: { leadId: string; assignedUserId: string | null },
  actorUserId: string | null,
): Lead {
  return withTransaction(exec, (tx) => {
    const lead = requireWritableLead(tx, input.leadId);
    if (input.assignedUserId && !userCanAccessClient(tx, input.assignedUserId, lead.clientId)) {
      throw invalidAssignee();
    }
    const updated = updateLead(tx, lead.clientId, lead.id, {
      assignedUserId: input.assignedUserId,
    });
    recordAudit(tx, {
      actorUserId,
      clientId: lead.clientId,
      entityType: 'lead',
      entityId: lead.id,
      action: 'assign',
      before: { assignedUserId: lead.assignedUserId },
      after: { assignedUserId: input.assignedUserId },
    });
    return updated;
  });
}

export function logActivity(
  exec: Executor,
  input: {
    leadId: string;
    type: Exclude<ActivityType, 'stage_change'>;
    body?: string | null;
    occurredAt?: string;
  },
  actorUserId: string,
): LeadActivity {
  return withTransaction(exec, (tx) => {
    const lead = requireWritableLead(tx, input.leadId);
    if (!userCanAccessClient(tx, actorUserId, lead.clientId)) throw forbidden();
    return insertActivity(tx, {
      leadId: lead.id,
      actorUserId,
      type: input.type,
      body: input.body ?? null,
      ...(input.occurredAt ? { occurredAt: parseTimestamp(input.occurredAt) } : {}),
    });
  });
}
