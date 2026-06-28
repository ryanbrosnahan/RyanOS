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
  initialProgressNote: z.string().trim().min(1).max(4000).optional(),
  checklistItems: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
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
      initialProgressNote: {
        type: "string",
        maxLength: 4000,
        description:
          "Optional progress note only when the email clearly documents useful task progress that already happened."
      },
      checklistItems: {
        type: "array",
        maxItems: 20,
        items: { type: "string", maxLength: 500 },
        description:
          "Optional concrete substeps only when the email clearly implies a useful flat checklist."
      },
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

const automatedSenderTokens = new Set([
  "account",
  "accounts",
  "admin",
  "alert",
  "alerts",
  "auto",
  "automated",
  "billing",
  "contact",
  "customerservice",
  "deal",
  "deals",
  "donotreply",
  "hello",
  "help",
  "info",
  "mailer",
  "marketing",
  "news",
  "newsletter",
  "no-reply",
  "noreply",
  "notification",
  "notifications",
  "notify",
  "offer",
  "offers",
  "postmaster",
  "promo",
  "promotions",
  "receipt",
  "receipts",
  "reply",
  "security",
  "service",
  "services",
  "statement",
  "statements",
  "support",
  "system",
  "team",
  "transaction",
  "transactions",
  "updates"
]);

const automatedDomainParts = [
  "accounts.google.com",
  "chase.com",
  "discover.com",
  "furnishedfinder.com",
  "google.com",
  "ring.com",
  "samsclub.com",
  "samsclub-email.com"
];

const automatedSubjectPatterns = [
  /\baccount alert\b/i,
  /\balarm\b/i,
  /\bavailable credit\b/i,
  /\bcamera\b.*\boffline\b/i,
  /\bcash back\b/i,
  /\bfurnished finder\b/i,
  /\blocation sharing\b/i,
  /\bnew sign-?in\b/i,
  /\bsecurity alert\b/i,
  /\bstatement\b.*\bready\b/i,
  /\bstorage\b/i,
  /\bverification code\b/i
];

export type EmailTriageFilterDecision = {
  shouldTriage: boolean;
  reason?: string;
};

function emailAddressFromHeader(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const bracketed = trimmed.match(/<([^>]+)>/);
  const candidate = bracketed?.[1] ?? trimmed;
  const email = candidate.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  return email?.toLowerCase();
}

function senderLocalPart(from: string | undefined): string | undefined {
  return emailAddressFromHeader(from)?.split("@")[0];
}

function senderDomain(from: string | undefined): string | undefined {
  return emailAddressFromHeader(from)?.split("@")[1];
}

function rawHeaderValue(raw: unknown, name: string): string | undefined {
  const rawRecord = asRecord(raw);
  const messageRecord = asRecord(rawRecord?.message);
  const payloadRecord = asRecord(rawRecord?.payload) ?? asRecord(messageRecord?.payload);
  const headers = rawRecord?.headers ?? messageRecord?.headers ?? payloadRecord?.headers;
  if (Array.isArray(headers)) {
    const match = headers
      .map(asRecord)
      .find((header) => {
        const headerName = header?.name;
        return typeof headerName === "string" && headerName.toLowerCase() === name.toLowerCase();
      });
    const value = match?.value;
    return typeof value === "string" && value.trim().length > 0 ? value : undefined;
  }
  const headerRecord = asRecord(headers);
  if (!headerRecord) return undefined;
  const direct = headerRecord[name] ?? headerRecord[name.toLowerCase()] ?? headerRecord[name.toUpperCase()];
  return typeof direct === "string" && direct.trim().length > 0 ? direct : undefined;
}

function hasBulkOrAutomatedHeaders(message: GogEmailMessage): boolean {
  const autoSubmitted = rawHeaderValue(message.raw, "Auto-Submitted")?.trim().toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return true;
  const precedence = rawHeaderValue(message.raw, "Precedence")?.trim().toLowerCase();
  if (precedence && ["bulk", "junk", "list"].includes(precedence)) return true;
  return rawHeaderValue(message.raw, "List-Unsubscribe") !== undefined;
}

function hasAutomatedSenderToken(localPart: string | undefined, from: string | undefined): boolean {
  const haystack = `${localPart ?? ""} ${from ?? ""}`.toLowerCase();
  const normalized = haystack.replace(/[^a-z0-9]+/g, "");
  if (
    normalized.includes("noreply") ||
    normalized.includes("donotreply") ||
    normalized.includes("noresponse")
  ) {
    return true;
  }
  const tokens = haystack.split(/[^a-z0-9-]+/).filter(Boolean);
  return tokens.some((token) => automatedSenderTokens.has(token));
}

function hasAutomatedDomain(domain: string | undefined): boolean {
  if (!domain) return false;
  return automatedDomainParts.some((part) => domain === part || domain.endsWith(`.${part}`));
}

function hasAutomatedSubject(subject: string | undefined): boolean {
  if (!subject) return false;
  return automatedSubjectPatterns.some((pattern) => pattern.test(subject));
}

export function shouldTriageEmailMessage(message: GogEmailMessage): EmailTriageFilterDecision {
  const from = message.from?.trim();
  if (!from) return { shouldTriage: false, reason: "missing_sender" };
  const localPart = senderLocalPart(from);
  if (hasBulkOrAutomatedHeaders(message)) return { shouldTriage: false, reason: "bulk_or_automated_headers" };
  if (hasAutomatedSenderToken(localPart, from)) return { shouldTriage: false, reason: "automated_sender" };
  if (hasAutomatedDomain(senderDomain(from))) return { shouldTriage: false, reason: "automated_domain" };
  if (hasAutomatedSubject(message.subject)) return { shouldTriage: false, reason: "automated_subject" };
  const preview = `${message.snippet ?? ""} ${message.bodyText ?? ""}`.toLowerCase();
  if (preview.includes("unsubscribe")) return { shouldTriage: false, reason: "bulk_or_marketing" };
  return { shouldTriage: true };
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
      "Use initialProgressNote only when the email states useful progress that already happened, such as a message sent, response received, or vendor contacted.",
      "Use checklistItems only for concrete flat substeps the email clearly implies; do not invent speculative steps.",
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
  accountEmail?: string;
  includeNewAccounts?: boolean;
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
    const matchesRequestedAccount =
      input.accountEmail === undefined ||
      account.email.toLowerCase() === input.accountEmail.toLowerCase() ||
      account.externalAccountId.toLowerCase() === input.accountEmail.toLowerCase();
    if (!matchesRequestedAccount) continue;
    const prior = existingByExternalId.get(account.externalAccountId) ?? existingByExternalId.get(account.email);
    if (!prior && input.accountEmail === undefined && input.includeNewAccounts !== true) continue;
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
        initialProgressNote: proposalInput.initialProgressNote,
        checklistItems: proposalInput.checklistItems,
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
  messagesSkippedByFilter: number;
  filterReasons: Record<string, number>;
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
  includeNewAccounts?: boolean;
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
    messagesSkippedByFilter: 0,
    filterReasons: {},
    proposalsCreatedOrUpdated: 0,
    errors: []
  };
  if (input.syncAccounts !== false) {
    try {
      const syncInput: Parameters<typeof syncGmailAccounts>[0] = {
        store: input.store,
        client: input.client,
        userId: input.userId
      };
      if (input.includeNewAccounts !== undefined) {
        syncInput.includeNewAccounts = input.includeNewAccounts;
      }
      await syncGmailAccounts(syncInput);
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
      let accountSkippedByFilter = 0;
      const accountFilterReasons: Record<string, number> = {};
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
          const filterDecision = shouldTriageEmailMessage(mergedMessage);
          if (!filterDecision.shouldTriage) {
            const reason = filterDecision.reason ?? "filtered";
            result.messagesSkippedByFilter += 1;
            result.filterReasons[reason] = (result.filterReasons[reason] ?? 0) + 1;
            accountSkippedByFilter += 1;
            accountFilterReasons[reason] = (accountFilterReasons[reason] ?? 0) + 1;
            continue;
          }
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
          messagesSkippedByFilter: accountSkippedByFilter,
          filterReasons: accountFilterReasons,
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

function initialProgressNoteForProposal(proposal: EmailActionProposal): string | undefined {
  const metadata = asRecord(proposal.metadata) ?? {};
  const value = metadata.initialProgressNote;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function checklistItemsForProposal(proposal: EmailActionProposal): string[] {
  const metadata = asRecord(proposal.metadata) ?? {};
  const values = Array.isArray(metadata.checklistItems) ? metadata.checklistItems : [];
  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .slice(0, 20);
}

async function getEmailProposalForUser(input: {
  store: RyanStore;
  userId: UUID;
  proposalId: UUID;
}): Promise<EmailActionProposal | undefined> {
  const proposal = await input.store.getEmailActionProposal(input.proposalId);
  if (!proposal) return undefined;
  if (proposal.userId === input.userId) return proposal;
  const visibleProposals = await input.store.listEmailActionProposals({
    userId: input.userId,
    limit: 200
  });
  return visibleProposals.find((candidate) => candidate.id === input.proposalId);
}

export async function acceptEmailProposal(input: {
  store: RyanStore;
  userId: UUID;
  proposalId: UUID;
}): Promise<{ proposal: EmailActionProposal; item: Item }> {
  const proposal = await getEmailProposalForUser(input);
  if (!proposal) {
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
  const initialProgressNote = initialProgressNoteForProposal(proposal);
  if (initialProgressNote !== undefined) {
    const note = await input.store.createItemProgressNote({
      userId: input.userId,
      itemId: item.id,
      body: initialProgressNote,
      metadata: asJsonObject({
        source: "gmail_proposal",
        proposalId: proposal.id,
        sourceId: proposal.sourceId
      })
    });
    await input.store.addItemEvent({
      userId: input.userId,
      itemId: item.id,
      eventType: "progress_note_added",
      occurredAt: note.occurredAt,
      idempotencyKey: `email-proposal:${proposal.id}:initial-progress-note`,
      payload: asJsonObject({
        source: "gmail_proposal",
        proposalId: proposal.id,
        progressNoteId: note.id
      })
    });
  }
  const checklistItems = checklistItemsForProposal(proposal);
  if (checklistItems.length > 0) {
    const createdChecklistItems = [];
    for (const [index, title] of checklistItems.entries()) {
      createdChecklistItems.push(
        await input.store.createItemChecklistItem({
          userId: input.userId,
          itemId: item.id,
          title,
          sortOrder: index,
          metadata: asJsonObject({
            source: "gmail_proposal",
            proposalId: proposal.id,
            sourceId: proposal.sourceId
          })
        })
      );
    }
    await input.store.addItemEvent({
      userId: input.userId,
      itemId: item.id,
      eventType: "checklist_item_added",
      occurredAt: nowIso(),
      idempotencyKey: `email-proposal:${proposal.id}:checklist`,
      payload: asJsonObject({
        source: "gmail_proposal",
        proposalId: proposal.id,
        checklistItemIds: createdChecklistItems.map((checklistItem) => checklistItem.id)
      })
    });
  }
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
  const proposal = await getEmailProposalForUser(input);
  if (!proposal) {
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
