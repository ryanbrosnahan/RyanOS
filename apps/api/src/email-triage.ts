import type {
  AiProvider,
  IncomingMessage,
  PublicToolDefinition
} from "@ryanos/ai";
import type {
  EmailActionProposal,
  EmailActionProposalUpsertData,
  ExternalSource,
  ExternalSourceUpsertData,
  Item,
  ItemCreateData,
  ProviderAccount,
  ProviderAccountUpsertData,
  RyanStore
} from "@ryanos/core";
import type { JsonObject, UUID } from "@ryanos/shared";
import { nowIso } from "@ryanos/shared";
import { z } from "zod";
import type { GogEmailMessage, GogGmailClient, GogSearchMessage } from "./gog-gmail.js";

export const EMAIL_PROVIDER = "gmail";
export const DEFAULT_EMAIL_SCAN_QUERY = "in:inbox is:unread newer_than:7d";
export const DEFAULT_EMAIL_SCAN_MAX_PER_ACCOUNT = 25;

export type GmailClientLike = Pick<
  GogGmailClient,
  "doctor" | "listAccounts" | "searchMessages" | "getMessage"
>;

const emailActionTypeSchema = z.enum([
  "reply",
  "task",
  "follow_up",
  "schedule",
  "delegate",
  "other"
]);

const emailProposalInputSchema = z.object({
  actionType: emailActionTypeSchema.default("task"),
  title: z.string().trim().min(1).max(240),
  body: z.string().trim().max(4000).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  dueAt: z.string().trim().min(1).optional(),
  draftReplyText: z.string().trim().max(8000).optional(),
  rationale: z.string().trim().max(1200).optional(),
  confidence: z.preprocess(
    (value) => {
      const numberValue =
        typeof value === "string" && value.trim().length > 0 ? Number(value) : value;
      if (typeof numberValue !== "number" || Number.isNaN(numberValue)) return undefined;
      return numberValue <= 1 ? Math.round(numberValue * 100) : Math.round(numberValue);
    },
    z.number().int().min(0).max(100).optional()
  )
});

export const emailProposeActionTool: PublicToolDefinition = {
  name: "email.propose_action",
  description:
    "Propose a RyanOS to-do when a Gmail message requires Ryan's reply, follow-up, scheduling, delegation, or another concrete action. Do not use this tool when no action is warranted.",
  metadata: {
    sideEffect: "read",
    confirmation: "required",
    retrySafety: "idempotent",
    descriptionForModel:
      "Only stores a proposal for Ryan to accept or reject. It does not create a task, send email, create Gmail drafts, label messages, or mark messages read."
  },
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["actionType", "title", "rationale", "confidence"],
    properties: {
      actionType: {
        type: "string",
        enum: ["reply", "task", "follow_up", "schedule", "delegate", "other"]
      },
      title: { type: "string", maxLength: 240 },
      body: { type: "string", maxLength: 4000 },
      priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
      dueAt: {
        type: "string",
        description: "Optional ISO 8601 datetime if the email implies a specific due date."
      },
      draftReplyText: {
        type: "string",
        description:
          "Optional proposed reply text for RyanOS only. This is not written to Gmail and is never sent."
      },
      rationale: { type: "string", maxLength: 1200 },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 100,
        description: "0-100 confidence score."
      }
    }
  }
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asJsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value ?? {})) as JsonObject;
}

function metadataRecord(account: ProviderAccount): Record<string, unknown> {
  return asRecord(account.metadata) ?? {};
}

export function emailTriageSettings(account: ProviderAccount): {
  enabled: boolean;
  lastScanAt?: string;
  lastSyncAt?: string;
  lastScanResult?: JsonObject;
} {
  const settings = asRecord(metadataRecord(account).emailTriage) ?? {};
  const output = {
    enabled: settings.enabled !== false
  } as {
    enabled: boolean;
    lastScanAt?: string;
    lastSyncAt?: string;
    lastScanResult?: JsonObject;
  };
  if (typeof settings.lastScanAt === "string") output.lastScanAt = settings.lastScanAt;
  if (typeof settings.lastSyncAt === "string") output.lastSyncAt = settings.lastSyncAt;
  if (asRecord(settings.lastScanResult)) output.lastScanResult = asJsonObject(settings.lastScanResult);
  return output;
}

export function accountEmail(account: ProviderAccount): string | undefined {
  return account.email ?? account.externalAccountId;
}

function enabledForScan(account: ProviderAccount): boolean {
  return account.status !== "disabled" && emailTriageSettings(account).enabled;
}

function mergeEmailTriageMetadata(
  account: ProviderAccount,
  patch: Record<string, unknown>
): JsonObject {
  const metadata = metadataRecord(account);
  return asJsonObject({
    ...metadata,
    emailTriage: {
      ...(asRecord(metadata.emailTriage) ?? {}),
      ...patch
    }
  });
}

function isoFromGmailDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const numeric = Number(trimmed);
  const date = Number.isFinite(numeric) && /^\d+$/.test(trimmed)
    ? new Date(numeric)
    : new Date(trimmed);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function compactText(value: string | undefined, limit: number): string | undefined {
  const compacted = value?.replace(/\s+/g, " ").trim();
  if (!compacted) return undefined;
  return compacted.length > limit ? `${compacted.slice(0, limit - 3)}...` : compacted;
}

function bodyExcerpt(message: GogEmailMessage): string {
  return compactText(message.bodyText ?? message.snippet ?? message.bodyHtml, 6000) ?? "";
}

function sourceTitle(message: GogEmailMessage | GogSearchMessage): string {
  return message.subject?.trim() || `(Gmail message ${message.id})`;
}

function gmailMessageUrl(message: GogEmailMessage | GogSearchMessage): string {
  return `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(message.id)}`;
}

function idempotencySuffix(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "proposal";
}

function proposedDueAt(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function messageForAi(input: {
  account: ProviderAccount;
  message: GogEmailMessage;
  query: string;
}): IncomingMessage {
  const email = accountEmail(input.account) ?? input.account.id;
  return {
    id: `gmail:${input.account.id}:${input.message.id}`,
    provider: "system",
    chatId: `gmail:${email}`,
    userId: input.account.userId,
    text: [
      "RyanOS Gmail triage.",
      "Decide whether this unread inbox email warrants a reply, follow-up, scheduling action, delegation, or another concrete RyanOS to-do.",
      "If action is warranted, call email.propose_action exactly once with concise to-do fields.",
      "If no action is warranted, do not call any tool.",
      "Do not send email, create Gmail drafts, mark messages read, label messages, or create RyanOS items.",
      "",
      `Scan query: ${input.query}`,
      `Account: ${email}`,
      `From: ${input.message.from ?? "unknown"}`,
      `To: ${input.message.to ?? "unknown"}`,
      `Date: ${input.message.date ?? "unknown"}`,
      `Subject: ${input.message.subject ?? "(no subject)"}`,
      `Snippet: ${input.message.snippet ?? ""}`,
      "",
      "Sanitized content:",
      bodyExcerpt(input.message)
    ].join("\n"),
    timestamp: nowIso(),
    attachments: [],
    metadata: {
      kind: "gmail_triage",
      providerAccountId: input.account.id,
      accountEmail: email,
      gmailMessageId: input.message.id
    }
  };
}

export async function syncGmailAccounts(input: {
  store: RyanStore;
  client: GmailClientLike;
  userId: UUID;
}): Promise<ProviderAccount[]> {
  const accounts = await input.client.listAccounts();
  const existing = await input.store.listProviderAccounts({
    userId: input.userId,
    provider: EMAIL_PROVIDER,
    limit: 200
  });
  const existingByExternalId = new Map(
    existing.map((account) => [account.externalAccountId ?? account.email ?? account.id, account])
  );
  const synced: ProviderAccount[] = [];
  const syncedAt = nowIso();
  for (const account of accounts) {
    const prior = existingByExternalId.get(account.externalAccountId) ?? existingByExternalId.get(account.email);
    const priorSettings = prior ? emailTriageSettings(prior) : { enabled: true };
    const upsert: ProviderAccountUpsertData = {
      userId: input.userId,
      provider: EMAIL_PROVIDER,
      externalAccountId: account.externalAccountId,
      email: account.email,
      status: account.status === "disabled" ? "disabled" : "active",
      scopes: account.scopes,
      metadata: asJsonObject({
        ...(prior ? metadataRecord(prior) : {}),
        gog: {
          lastSyncAt: syncedAt,
          raw: account.raw
        },
        emailTriage: {
          ...(prior ? asRecord(metadataRecord(prior).emailTriage) ?? {} : {}),
          enabled: priorSettings.enabled,
          lastSyncAt: syncedAt
        }
      })
    };
    if (account.displayName !== undefined) upsert.displayName = account.displayName;
    synced.push(
      await input.store.upsertProviderAccount(upsert)
    );
  }
  return synced;
}

async function updateAccountScanResult(input: {
  store: RyanStore;
  account: ProviderAccount;
  result: JsonObject;
}): Promise<void> {
  await input.store.updateProviderAccount(input.account.id, {
    metadata: mergeEmailTriageMetadata(input.account, {
      lastScanAt: nowIso(),
      lastScanResult: input.result
    })
  });
}

async function upsertSourceForMessage(input: {
  store: RyanStore;
  account: ProviderAccount;
  message: GogEmailMessage;
}): Promise<ExternalSource> {
  const source: ExternalSourceUpsertData = {
    userId: input.account.userId,
    provider: EMAIL_PROVIDER,
    providerAccountId: input.account.id,
    externalId: input.message.id,
    url: gmailMessageUrl(input.message),
    title: sourceTitle(input.message),
    retentionClass: "summary",
    metadata: asJsonObject({
      gmail: {
        messageId: input.message.id,
        threadId: input.message.threadId,
        from: input.message.from,
        to: input.message.to,
        cc: input.message.cc,
        subject: input.message.subject,
        snippet: input.message.snippet,
        date: input.message.date
      },
      raw: input.message.raw
    })
  };
  const summary = compactText(input.message.snippet ?? input.message.bodyText, 1000);
  if (summary !== undefined) source.summary = summary;
  const occurredAt = isoFromGmailDate(input.message.date);
  if (occurredAt !== undefined) source.occurredAt = occurredAt;
  return input.store.upsertExternalSource(source);
}

async function triageMessage(input: {
  ai: AiProvider;
  store: RyanStore;
  account: ProviderAccount;
  source: ExternalSource;
  message: GogEmailMessage;
  query: string;
}): Promise<EmailActionProposal[]> {
  const aiMessage = messageForAi({
    account: input.account,
    message: input.message,
    query: input.query
  });
  const interpreted = await input.ai.interpret(aiMessage, [emailProposeActionTool]);
  const proposals: EmailActionProposal[] = [];
  const toolCalls = interpreted.toolCalls
    .filter((toolCall) => toolCall.name === emailProposeActionTool.name)
    .slice(0, 3);

  for (const [index, toolCall] of toolCalls.entries()) {
    const parsed = emailProposalInputSchema.safeParse(toolCall.input);
    if (!parsed.success) continue;
    const proposalInput = parsed.data;
    const proposal: EmailActionProposalUpsertData = {
      userId: input.account.userId,
      sourceId: input.source.id,
      providerAccountId: input.account.id,
      idempotencyKey: [
        "gmail",
        input.account.id,
        input.message.id,
        proposalInput.actionType,
        idempotencySuffix(proposalInput.title),
        index
      ].join(":"),
      actionType: proposalInput.actionType,
      title: proposalInput.title,
      priority: proposalInput.priority,
      metadata: asJsonObject({
        source: "gmail_triage",
        accountEmail: accountEmail(input.account),
        messageId: input.message.id,
        subject: input.message.subject,
        from: input.message.from,
        aiProvider: input.ai.name,
        interpretedText: interpreted.text,
        warnings: interpreted.warnings
      })
    };
    if (proposalInput.body !== undefined) proposal.body = proposalInput.body;
    const dueAt = proposedDueAt(proposalInput.dueAt);
    if (dueAt !== undefined) proposal.dueAt = dueAt;
    if (proposalInput.draftReplyText !== undefined) proposal.draftReplyText = proposalInput.draftReplyText;
    if (proposalInput.rationale !== undefined) proposal.rationale = proposalInput.rationale;
    if (proposalInput.confidence !== undefined) proposal.confidence = proposalInput.confidence;
    proposals.push(
      await input.store.upsertEmailActionProposal(proposal)
    );
  }

  return proposals;
}

export type EmailScanResult = {
  query: string;
  maxPerAccount: number;
  accountsScanned: number;
  accountsSkipped: number;
  messagesSeen: number;
  messagesFetched: number;
  proposalsCreatedOrUpdated: number;
  errors: Array<{ accountId?: string; accountEmail?: string; messageId?: string; error: string }>;
};

export async function scanGmailInbox(input: {
  ai: AiProvider;
  store: RyanStore;
  client: GmailClientLike;
  userId: UUID;
  accountId?: UUID;
  query?: string;
  maxPerAccount?: number;
  syncAccounts?: boolean;
}): Promise<EmailScanResult> {
  const query = input.query?.trim() || DEFAULT_EMAIL_SCAN_QUERY;
  const maxPerAccount = Math.min(
    Math.max(input.maxPerAccount ?? DEFAULT_EMAIL_SCAN_MAX_PER_ACCOUNT, 1),
    100
  );
  const result: EmailScanResult = {
    query,
    maxPerAccount,
    accountsScanned: 0,
    accountsSkipped: 0,
    messagesSeen: 0,
    messagesFetched: 0,
    proposalsCreatedOrUpdated: 0,
    errors: []
  };
  if (input.syncAccounts !== false) {
    try {
      await syncGmailAccounts({
        store: input.store,
        client: input.client,
        userId: input.userId
      });
    } catch (err) {
      result.errors.push({
        error: `Gmail account sync failed: ${err instanceof Error ? err.message : String(err)}`
      });
      return result;
    }
  }
  const accounts = await input.store.listProviderAccounts({
    userId: input.userId,
    provider: EMAIL_PROVIDER,
    limit: 200
  });
  const filteredAccounts = accounts.filter((account) => {
    if (input.accountId !== undefined && account.id !== input.accountId) return false;
    return enabledForScan(account);
  });
  result.accountsSkipped = accounts.length - filteredAccounts.length;

  for (const account of filteredAccounts) {
    const email = accountEmail(account);
    if (!email) {
      result.errors.push({
        accountId: account.id,
        error: "Gmail account has no email address."
      });
      continue;
    }
    result.accountsScanned += 1;
    try {
      const searchResults = await input.client.searchMessages({
        accountEmail: email,
        query,
        max: maxPerAccount
      });
      result.messagesSeen += searchResults.length;
      let accountProposalCount = 0;
      for (const searchResult of searchResults) {
        try {
          const message = await input.client.getMessage({
            accountEmail: email,
            messageId: searchResult.id
          });
          result.messagesFetched += 1;
          const mergedMessage: GogEmailMessage = {
            ...searchResult,
            ...message,
            id: message.id || searchResult.id,
            raw: message.raw
          };
          const source = await upsertSourceForMessage({
            store: input.store,
            account,
            message: mergedMessage
          });
          const proposals = await triageMessage({
            ai: input.ai,
            store: input.store,
            account,
            source,
            message: mergedMessage,
            query
          });
          result.proposalsCreatedOrUpdated += proposals.length;
          accountProposalCount += proposals.length;
        } catch (err) {
          result.errors.push({
            accountId: account.id,
            accountEmail: email,
            messageId: searchResult.id,
            error: err instanceof Error ? err.message : String(err)
          });
        }
      }
      await updateAccountScanResult({
        store: input.store,
        account,
        result: asJsonObject({
          status: "ok",
          query,
          messagesSeen: searchResults.length,
          proposalsCreatedOrUpdated: accountProposalCount
        })
      });
    } catch (err) {
      result.errors.push({
        accountId: account.id,
        accountEmail: email,
        error: err instanceof Error ? err.message : String(err)
      });
      await updateAccountScanResult({
        store: input.store,
        account,
        result: asJsonObject({
          status: "failed",
          query,
          error: err instanceof Error ? err.message : String(err)
        })
      });
    }
  }

  return result;
}

export type EmailProposalView = EmailActionProposal & {
  account?: {
    id: string;
    email?: string;
    displayName?: string;
  };
  source?: {
    id: string;
    title?: string;
    summary?: string;
    url?: string;
    occurredAt?: string;
    metadata: JsonObject;
  };
};

export async function proposalView(
  store: RyanStore,
  proposal: EmailActionProposal
): Promise<EmailProposalView> {
  const [account, source] = await Promise.all([
    proposal.providerAccountId ? store.getProviderAccount(proposal.providerAccountId) : Promise.resolve(undefined),
    store.getExternalSource(proposal.sourceId)
  ]);
  return {
    ...proposal,
    ...(account
      ? {
          account: {
            id: account.id,
            ...(account.email ? { email: account.email } : {}),
            ...(account.displayName ? { displayName: account.displayName } : {})
          }
        }
      : {}),
    ...(source
      ? {
          source: {
            id: source.id,
            ...(source.title ? { title: source.title } : {}),
            ...(source.summary ? { summary: source.summary } : {}),
            ...(source.url ? { url: source.url } : {}),
            ...(source.occurredAt ? { occurredAt: source.occurredAt } : {}),
            metadata: source.metadata
          }
        }
      : {})
  };
}

function itemBodyForProposal(proposal: EmailActionProposal, source: ExternalSource | undefined): string | undefined {
  const pieces = [
    proposal.body,
    proposal.rationale ? `Why: ${proposal.rationale}` : undefined,
    source?.title ? `Email: ${source.title}` : undefined
  ].filter((piece): piece is string => typeof piece === "string" && piece.trim().length > 0);
  return pieces.length > 0 ? pieces.join("\n\n") : undefined;
}

export async function acceptEmailProposal(input: {
  store: RyanStore;
  userId: UUID;
  proposalId: UUID;
}): Promise<{ proposal: EmailActionProposal; item: Item }> {
  const proposal = await input.store.getEmailActionProposal(input.proposalId);
  if (!proposal || proposal.userId !== input.userId) {
    throw new Error(`Email proposal not found: ${input.proposalId}`);
  }
  if (proposal.status === "accepted" && proposal.acceptedItemId) {
    const existingItem = await input.store.getItem(proposal.acceptedItemId);
    if (existingItem) return { proposal, item: existingItem };
  }
  if (proposal.status === "rejected") {
    throw new Error("Rejected email proposals cannot be accepted.");
  }
  const source = await input.store.getExternalSource(proposal.sourceId);
  const itemInput: ItemCreateData = {
    userId: input.userId,
    kind: "task",
    title: proposal.title,
    priority: proposal.priority,
    metadata: asJsonObject({
      source: "gmail_proposal",
      emailProposalId: proposal.id,
      externalSourceId: proposal.sourceId,
      providerAccountId: proposal.providerAccountId,
      draftReplyText: proposal.draftReplyText,
      actionType: proposal.actionType
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
    idempotencyKey: `email-proposal:${proposal.id}:accept`,
    payload: asJsonObject({
      source: "gmail_proposal",
      proposalId: proposal.id,
      sourceId: proposal.sourceId
    })
  });
  await input.store.addSourceLink({
    userId: input.userId,
    sourceId: proposal.sourceId,
    targetType: "item",
    targetId: item.id,
    relation: "accepted_email_proposal"
  });
  const updated = await input.store.updateEmailActionProposal(proposal.id, {
    status: "accepted",
    acceptedAt: nowIso(),
    acceptedItemId: item.id
  });
  await input.store.addAuditLog({
    userId: input.userId,
    actorType: "user",
    action: "email.proposal.accept",
    targetType: "email_action_proposal",
    targetId: proposal.id,
    request: asJsonObject({ proposalId: proposal.id }),
    result: asJsonObject({ itemId: item.id }),
    status: "success",
    metadata: {}
  });
  return { proposal: updated, item };
}

export async function rejectEmailProposal(input: {
  store: RyanStore;
  userId: UUID;
  proposalId: UUID;
}): Promise<EmailActionProposal> {
  const proposal = await input.store.getEmailActionProposal(input.proposalId);
  if (!proposal || proposal.userId !== input.userId) {
    throw new Error(`Email proposal not found: ${input.proposalId}`);
  }
  if (proposal.status === "accepted") {
    throw new Error("Accepted email proposals cannot be rejected.");
  }
  const updated = await input.store.updateEmailActionProposal(proposal.id, {
    status: "rejected",
    rejectedAt: nowIso()
  });
  await input.store.addAuditLog({
    userId: input.userId,
    actorType: "user",
    action: "email.proposal.reject",
    targetType: "email_action_proposal",
    targetId: proposal.id,
    request: asJsonObject({ proposalId: proposal.id }),
    result: asJsonObject({ status: "rejected" }),
    status: "success",
    metadata: {}
  });
  return updated;
}

export async function gmailProposalCounts(store: RyanStore, userId: UUID): Promise<{
  proposed: number;
  accepted: number;
  rejected: number;
}> {
  const [proposed, accepted, rejected] = await Promise.all([
    store.listEmailActionProposals({ userId, status: "proposed", limit: 200 }),
    store.listEmailActionProposals({ userId, status: "accepted", limit: 200 }),
    store.listEmailActionProposals({ userId, status: "rejected", limit: 200 })
  ]);
  return {
    proposed: proposed.length,
    accepted: accepted.length,
    rejected: rejected.length
  };
}

export function parseScanMax(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_EMAIL_SCAN_MAX_PER_ACCOUNT;
  return Math.min(Math.max(Math.floor(parsed), 1), 100);
}
