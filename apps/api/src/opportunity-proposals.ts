import { createHash } from "node:crypto";
import type {
  ExternalSource,
  ExternalSourceUpsertData,
  Item,
  ItemCreateData,
  Opportunity,
  OpportunityCreateData,
  OpportunityProposal,
  OpportunityProposalUpsertData,
  RyanStore
} from "@ryanos/core";
import { nowIso, type JsonObject, type UUID } from "@ryanos/shared";
import { z } from "zod";

export const OPPORTUNITY_REPORT_PROVIDER = "rfp_report";
export const OPPORTUNITY_PROPOSAL_MIN_RATING = 7;

const urlListSchema = z.preprocess((value) => {
  if (typeof value === "string") return [value];
  return value;
}, z.array(z.string().trim().min(1)).default([]));

const ratingSchema = z.preprocess((value) => {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return undefined;
  const match = value.match(/\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed > 10 && parsed <= 100 ? parsed / 10 : parsed;
}, z.number().min(0).max(10).optional());

const maybeStringSchema = z.string().trim().min(1).optional();

export const opportunityCandidateSchema = z.object({
  id: maybeStringSchema,
  stableId: maybeStringSchema,
  externalId: maybeStringSchema,
  title: z.string().trim().min(1).max(300),
  sourceUrl: maybeStringSchema,
  sourceUrls: urlListSchema,
  rating: ratingSchema,
  dueAt: maybeStringSchema,
  decisionBy: maybeStringSchema,
  fit: z.enum(["unknown", "low", "medium", "high"]).optional(),
  summary: z.string().trim().max(5000).optional(),
  rationale: z.string().trim().max(2000).optional(),
  recommendedAction: z.string().trim().max(1000).optional(),
  valueEstimate: z.string().trim().max(200).optional(),
  promoteToRyanOS: z.boolean().default(false),
  urgent: z.boolean().default(false),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export const opportunityReportSidecarSchema = z.object({
  automationId: z.string().trim().min(1).max(120),
  projectSlug: z.string().trim().min(1).max(120),
  runAt: maybeStringSchema,
  reportPath: maybeStringSchema,
  candidates: z.array(opportunityCandidateSchema).default([])
});

export type OpportunityReportSidecar = z.infer<typeof opportunityReportSidecarSchema>;
export type OpportunityCandidateInput = z.infer<typeof opportunityCandidateSchema>;

export const opportunityReportIngestBodySchema = z.union([
  z.object({
    userId: z.string().default("local-owner"),
    report: opportunityReportSidecarSchema
  }),
  opportunityReportSidecarSchema
]);

type NormalizedOpportunityCandidate = {
  stableRef: string;
  sourceUrls: string[];
  title: string;
  fit: OpportunityProposal["fit"];
  priority: OpportunityProposal["priority"];
  promote: boolean;
  metadata: JsonObject;
  summary?: string;
  rating?: number;
  dueAt?: string;
  decisionBy?: string;
  valueEstimate?: string;
  recommendedAction?: string;
  rationale?: string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asJsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value ?? {})) as JsonObject;
}

function compactText(value: string | undefined, limit: number): string | undefined {
  const compacted = value?.replace(/\s+/g, " ").trim();
  if (!compacted) return undefined;
  return compacted.length > limit ? `${compacted.slice(0, limit - 3)}...` : compacted;
}

function parseDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? new Date(`${trimmed}T12:00:00.000Z`)
    : new Date(trimmed);
  if (!Number.isFinite(date.getTime())) return undefined;
  return date.toISOString();
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    output.push(trimmed);
  }
  return output;
}

function sourceUrlsForCandidate(candidate: OpportunityCandidateInput): string[] {
  return uniqueStrings([
    ...(candidate.sourceUrl ? [candidate.sourceUrl] : []),
    ...candidate.sourceUrls
  ]);
}

function fitForCandidate(candidate: OpportunityCandidateInput): OpportunityProposal["fit"] {
  if (candidate.fit) return candidate.fit;
  if (candidate.rating === undefined) return "unknown";
  if (candidate.rating >= 8) return "high";
  if (candidate.rating >= 6) return "medium";
  return "low";
}

function priorityForCandidate(candidate: OpportunityCandidateInput): OpportunityProposal["priority"] {
  if (candidate.urgent) return "urgent";
  if (candidate.rating !== undefined && candidate.rating >= 8) return "high";
  if (candidate.rating !== undefined && candidate.rating < 5) return "low";
  return "normal";
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

export function opportunityProposalIdempotencyKey(input: {
  automationId: string;
  candidate: OpportunityCandidateInput;
}): string {
  const sourceUrls = sourceUrlsForCandidate(input.candidate);
  const stableRef =
    input.candidate.stableId ??
    input.candidate.externalId ??
    input.candidate.id ??
    sourceUrls[0] ??
    input.candidate.title;
  return `opportunity-proposal:${input.automationId}:${stableHash(stableRef.trim().toLowerCase())}`;
}

function normalizeCandidate(input: {
  report: OpportunityReportSidecar;
  candidate: OpportunityCandidateInput;
}): NormalizedOpportunityCandidate {
  const sourceUrls = sourceUrlsForCandidate(input.candidate);
  const idempotencyKey = opportunityProposalIdempotencyKey({
    automationId: input.report.automationId,
    candidate: input.candidate
  });
  const metadata = asJsonObject({
    ...input.candidate.metadata,
    automationId: input.report.automationId,
    projectSlug: input.report.projectSlug,
    reportPath: input.report.reportPath,
    runAt: parseDate(input.report.runAt) ?? input.report.runAt,
    sourceUrls,
    stableRef: idempotencyKey,
    promoteToRyanOS: input.candidate.promoteToRyanOS,
    urgent: input.candidate.urgent
  });
  const normalized: NormalizedOpportunityCandidate = {
    stableRef: idempotencyKey,
    sourceUrls,
    title: input.candidate.title,
    fit: fitForCandidate(input.candidate),
    priority: priorityForCandidate(input.candidate),
    promote:
      input.candidate.promoteToRyanOS ||
      input.candidate.urgent ||
      (input.candidate.rating !== undefined && input.candidate.rating >= OPPORTUNITY_PROPOSAL_MIN_RATING),
    metadata
  };
  const summary = compactText(input.candidate.summary, 5000);
  if (summary !== undefined) normalized.summary = summary;
  if (input.candidate.rating !== undefined) normalized.rating = input.candidate.rating;
  const dueAt = parseDate(input.candidate.dueAt);
  if (dueAt !== undefined) normalized.dueAt = dueAt;
  const decisionBy = parseDate(input.candidate.decisionBy);
  if (decisionBy !== undefined) normalized.decisionBy = decisionBy;
  if (input.candidate.valueEstimate !== undefined) normalized.valueEstimate = input.candidate.valueEstimate;
  const recommendedAction = compactText(input.candidate.recommendedAction, 1000);
  if (recommendedAction !== undefined) normalized.recommendedAction = recommendedAction;
  const rationale = compactText(input.candidate.rationale, 2000);
  if (rationale !== undefined) normalized.rationale = rationale;
  return normalized;
}

function sourceExternalId(report: OpportunityReportSidecar, candidate: NormalizedOpportunityCandidate): string {
  return `${report.automationId}:${candidate.stableRef}`;
}

function primarySourceUrl(candidate: NormalizedOpportunityCandidate): string | undefined {
  return candidate.sourceUrls[0];
}

function sourceUrlMetadata(source: ExternalSource | undefined): string[] {
  const metadata = asRecord(source?.metadata);
  const urls = metadata?.sourceUrls;
  return Array.isArray(urls) ? urls.filter((url): url is string => typeof url === "string") : [];
}

function itemBodyForProposal(
  proposal: OpportunityProposal,
  source: ExternalSource | undefined
): string | undefined {
  const lines = [
    proposal.summary,
    proposal.rationale ? `Why it matters: ${proposal.rationale}` : undefined,
    source?.url ? `Primary source: ${source.url}` : undefined,
    sourceUrlMetadata(source).length > 1 ? `Other sources: ${sourceUrlMetadata(source).slice(1).join(", ")}` : undefined
  ].filter((line): line is string => typeof line === "string" && line.trim().length > 0);
  return lines.length > 0 ? lines.join("\n\n") : undefined;
}

async function getOpportunityProposalForUser(input: {
  store: RyanStore;
  userId: UUID;
  proposalId: UUID;
}): Promise<OpportunityProposal | undefined> {
  const proposal = await input.store.getOpportunityProposal(input.proposalId);
  if (!proposal) return undefined;
  if (proposal.userId === input.userId) return proposal;
  const visibleProposals = await input.store.listOpportunityProposals({
    userId: input.userId,
    limit: 200
  });
  return visibleProposals.find((candidate) => candidate.id === input.proposalId);
}

export function parseOpportunityReportIngestBody(body: unknown): {
  userId: UUID;
  report: OpportunityReportSidecar;
} {
  const parsed = opportunityReportIngestBodySchema.parse(body ?? {});
  if ("report" in parsed) {
    return {
      userId: parsed.userId,
      report: parsed.report
    };
  }
  return {
    userId: "local-owner",
    report: parsed
  };
}

export async function ingestOpportunityReport(input: {
  store: RyanStore;
  userId: UUID;
  report: OpportunityReportSidecar;
}): Promise<{
  automationId: string;
  projectSlug: string;
  candidatesSeen: number;
  proposalsCreatedOrUpdated: number;
  proposalsSkippedByThreshold: number;
  proposalIds: UUID[];
}> {
  const report = opportunityReportSidecarSchema.parse(input.report);
  const runAt = parseDate(report.runAt) ?? nowIso();
  const proposalIds: UUID[] = [];
  let proposalsCreatedOrUpdated = 0;
  let proposalsSkippedByThreshold = 0;

  for (const candidateInput of report.candidates) {
    const candidate = normalizeCandidate({ report, candidate: candidateInput });
    if (!candidate.promote) {
      proposalsSkippedByThreshold += 1;
      continue;
    }
    const sourceInput: ExternalSourceUpsertData = {
      userId: input.userId,
      provider: OPPORTUNITY_REPORT_PROVIDER,
      externalId: sourceExternalId(report, candidate),
      title: candidate.title,
      retentionClass: "summary",
      occurredAt: runAt,
      metadata: asJsonObject({
        ...candidate.metadata,
        reportPath: report.reportPath,
        sourceUrls: candidate.sourceUrls
      })
    };
    const url = primarySourceUrl(candidate);
    if (url !== undefined) sourceInput.url = url;
    if (candidate.summary !== undefined) sourceInput.summary = candidate.summary;
    const source = await input.store.upsertExternalSource(sourceInput);
    const proposalInput: OpportunityProposalUpsertData = {
      userId: input.userId,
      sourceId: source.id,
      idempotencyKey: candidate.stableRef,
      projectSlug: report.projectSlug,
      title: candidate.title,
      fit: candidate.fit,
      priority: candidate.priority,
      metadata: candidate.metadata
    };
    if (candidate.summary !== undefined) proposalInput.summary = candidate.summary;
    if (candidate.rating !== undefined) proposalInput.rating = candidate.rating;
    if (candidate.dueAt !== undefined) proposalInput.dueAt = candidate.dueAt;
    if (candidate.decisionBy !== undefined) proposalInput.decisionBy = candidate.decisionBy;
    if (candidate.valueEstimate !== undefined) proposalInput.valueEstimate = candidate.valueEstimate;
    if (candidate.recommendedAction !== undefined) proposalInput.recommendedAction = candidate.recommendedAction;
    if (candidate.rationale !== undefined) proposalInput.rationale = candidate.rationale;
    const proposal = await input.store.upsertOpportunityProposal(proposalInput);
    proposalIds.push(proposal.id);
    proposalsCreatedOrUpdated += 1;
  }

  return {
    automationId: report.automationId,
    projectSlug: report.projectSlug,
    candidatesSeen: report.candidates.length,
    proposalsCreatedOrUpdated,
    proposalsSkippedByThreshold,
    proposalIds
  };
}

export type OpportunityProposalView = OpportunityProposal & {
  source?: ExternalSource;
  sourceUrls: string[];
  reportPath?: string;
  opportunity?: Opportunity;
  item?: Item;
};

export async function opportunityProposalView(
  store: RyanStore,
  proposal: OpportunityProposal
): Promise<OpportunityProposalView> {
  const source = await store.getExternalSource(proposal.sourceId);
  const metadata = asRecord(proposal.metadata) ?? {};
  const view: OpportunityProposalView = {
    ...proposal,
    sourceUrls: sourceUrlMetadata(source)
  };
  if (source !== undefined) view.source = source;
  if (typeof metadata.reportPath === "string") view.reportPath = metadata.reportPath;
  if (proposal.acceptedOpportunityId !== undefined) {
    const opportunity = await store.getOpportunity(proposal.acceptedOpportunityId);
    if (opportunity !== undefined) view.opportunity = opportunity;
  }
  if (proposal.acceptedItemId !== undefined) {
    const item = await store.getItem(proposal.acceptedItemId);
    if (item !== undefined) view.item = item;
  }
  return view;
}

export async function acceptOpportunityProposal(input: {
  store: RyanStore;
  userId: UUID;
  proposalId: UUID;
}): Promise<{ proposal: OpportunityProposal; opportunity: Opportunity; item: Item }> {
  const proposal = await getOpportunityProposalForUser(input);
  if (!proposal) {
    throw new Error(`Opportunity proposal not found: ${input.proposalId}`);
  }
  if (proposal.status === "accepted" && proposal.acceptedOpportunityId && proposal.acceptedItemId) {
    const [opportunity, item] = await Promise.all([
      input.store.getOpportunity(proposal.acceptedOpportunityId),
      input.store.getItem(proposal.acceptedItemId)
    ]);
    if (opportunity && item) return { proposal, opportunity, item };
  }
  if (proposal.status === "rejected") {
    throw new Error("Rejected opportunity proposals cannot be accepted.");
  }
  const source = await input.store.getExternalSource(proposal.sourceId);
  const opportunityInput: OpportunityCreateData = {
    userId: input.userId,
    title: proposal.title,
    status: "tracking",
    fit: proposal.fit,
    metadata: asJsonObject({
      source: "opportunity_proposal",
      opportunityProposalId: proposal.id,
      externalSourceId: proposal.sourceId,
      projectSlug: proposal.projectSlug,
      rating: proposal.rating,
      sourceUrls: sourceUrlMetadata(source)
    })
  };
  if (proposal.summary !== undefined) opportunityInput.summary = proposal.summary;
  if (proposal.dueAt !== undefined) opportunityInput.dueAt = proposal.dueAt;
  if (proposal.decisionBy !== undefined) opportunityInput.decisionBy = proposal.decisionBy;
  if (proposal.valueEstimate !== undefined) opportunityInput.valueEstimate = proposal.valueEstimate;
  const opportunity = await input.store.createOpportunity(opportunityInput);

  await input.store.addSourceLink({
    userId: input.userId,
    sourceId: proposal.sourceId,
    targetType: "opportunity",
    targetId: opportunity.id,
    relation: "accepted_opportunity_proposal"
  });

  const itemInput: ItemCreateData = {
    userId: input.userId,
    kind: "opportunity_action",
    title: proposal.recommendedAction ?? `Review ${proposal.title}`,
    priority: proposal.priority,
    metadata: asJsonObject({
      source: "opportunity_proposal",
      opportunityProposalId: proposal.id,
      opportunityId: opportunity.id,
      externalSourceId: proposal.sourceId,
      projectSlug: proposal.projectSlug,
      rating: proposal.rating
    })
  };
  const body = itemBodyForProposal(proposal, source);
  if (body !== undefined) itemInput.body = body;
  if (proposal.dueAt !== undefined) itemInput.dueAt = proposal.dueAt;
  const item = await input.store.createItem(itemInput);
  await input.store.addItemEvent({
    userId: input.userId,
    itemId: item.id,
    eventType: "created",
    occurredAt: nowIso(),
    idempotencyKey: `opportunity-proposal:${proposal.id}:accept`,
    payload: asJsonObject({
      source: "opportunity_proposal",
      proposalId: proposal.id,
      sourceId: proposal.sourceId,
      opportunityId: opportunity.id
    })
  });
  await input.store.addSourceLink({
    userId: input.userId,
    sourceId: proposal.sourceId,
    targetType: "item",
    targetId: item.id,
    relation: "accepted_opportunity_proposal"
  });
  const updatedOpportunity = await input.store.updateOpportunity(opportunity.id, {
    nextActionItemId: item.id
  });
  const updated = await input.store.updateOpportunityProposal(proposal.id, {
    status: "accepted",
    acceptedAt: nowIso(),
    acceptedOpportunityId: updatedOpportunity.id,
    acceptedItemId: item.id
  });
  await input.store.addAuditLog({
    userId: input.userId,
    actorType: "user",
    action: "opportunity.proposal.accept",
    targetType: "opportunity_proposal",
    targetId: proposal.id,
    request: asJsonObject({ proposalId: proposal.id }),
    result: asJsonObject({ opportunityId: updatedOpportunity.id, itemId: item.id }),
    status: "success",
    metadata: {}
  });
  return { proposal: updated, opportunity: updatedOpportunity, item };
}

export async function rejectOpportunityProposal(input: {
  store: RyanStore;
  userId: UUID;
  proposalId: UUID;
}): Promise<OpportunityProposal> {
  const proposal = await getOpportunityProposalForUser(input);
  if (!proposal) {
    throw new Error(`Opportunity proposal not found: ${input.proposalId}`);
  }
  if (proposal.status === "accepted") {
    throw new Error("Accepted opportunity proposals cannot be rejected.");
  }
  const updated = await input.store.updateOpportunityProposal(proposal.id, {
    status: "rejected",
    rejectedAt: nowIso()
  });
  await input.store.addAuditLog({
    userId: input.userId,
    actorType: "user",
    action: "opportunity.proposal.reject",
    targetType: "opportunity_proposal",
    targetId: proposal.id,
    request: asJsonObject({ proposalId: proposal.id }),
    result: asJsonObject({}),
    status: "success",
    metadata: {}
  });
  return updated;
}
