import type {
  AiProvider,
  IncomingMessage,
  PublicToolDefinition
} from "@ryanos/ai";
import { createHash } from "node:crypto";
import type {
  EmailActionProposal,
  EmailActionProposalUpsertData,
  EmailSenderPreference,
  EmailTriageDecision,
  EmailTriageOutcome,
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
import type {
  GogEmailMessage,
  GogEmailThread,
  GogGmailClient,
  GogSearchMessage,
  GogSearchPage
} from "./gog-gmail.js";

export const EMAIL_PROVIDER = "gmail";
export const EMAIL_TRIAGE_CLASSIFIER_VERSION = "email-triage-v2";
export const DEFAULT_EMAIL_SCAN_QUERY = "in:inbox newer_than:14d";
export const DEFAULT_EMAIL_SCAN_MAX_PER_ACCOUNT = 20;
export const DEFAULT_EMAIL_SCAN_MAX_PER_USER = 60;
const EMAIL_TRIAGE_BATCH_SIZE = 5;
const EMAIL_TRIAGE_MAX_RETRIES = 3;

export type GmailClientLike = Pick<GogGmailClient, "doctor" | "listAccounts"> & {
  searchMessagePage(input: {
    accountEmail: string;
    query: string;
    max: number;
    pageToken?: string;
  }): Promise<GogSearchPage>;
  getThread(input: { accountEmail: string; threadId: string }): Promise<GogEmailThread>;
};

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

const emailTriageDecisionInputSchema = emailProposalInputSchema.partial().extend({
  messageId: z.string().trim().min(1),
  outcome: z.enum(["actionable", "maybe", "no_action"]),
  reasonCode: z.string().trim().max(100).optional(),
  reason: z.string().trim().max(1200),
  confidence: z.preprocess(
    (value) => {
      const numberValue = typeof value === "string" ? Number(value) : value;
      if (typeof numberValue !== "number" || Number.isNaN(numberValue)) return undefined;
      return numberValue <= 1 ? Math.round(numberValue * 100) : Math.round(numberValue);
    },
    z.number().int().min(0).max(100)
  )
}).superRefine((value, context) => {
  if (value.outcome !== "no_action" && !value.title?.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["title"], message: "title is required" });
  }
});

const emailBatchDecisionSchema = z.object({
  decisions: z.array(emailTriageDecisionInputSchema).min(1).max(EMAIL_TRIAGE_BATCH_SIZE)
});

export const emailClassifyBatchTool: PublicToolDefinition = {
  name: "email.classify_batch",
  description: "Classify each supplied Gmail message and propose one task when action is warranted.",
  metadata: {
    sideEffect: "read",
    confirmation: "required",
    retrySafety: "idempotent",
    descriptionForModel: "Records triage decisions and proposals only. It never changes Gmail or creates tasks."
  },
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["decisions"],
    properties: {
      decisions: {
        type: "array",
        minItems: 1,
        maxItems: EMAIL_TRIAGE_BATCH_SIZE,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["messageId", "outcome", "reason", "confidence"],
          properties: {
            messageId: { type: "string" },
            outcome: { type: "string", enum: ["actionable", "maybe", "no_action"] },
            reasonCode: { type: "string", maxLength: 100 },
            reason: { type: "string", maxLength: 1200 },
            confidence: { type: "number", minimum: 0, maximum: 100 },
            actionType: {
              type: "string",
              enum: ["reply", "task", "follow_up", "schedule", "delegate", "other"]
            },
            title: { type: "string", maxLength: 240 },
            body: { type: "string", maxLength: 4000 },
            initialProgressNote: { type: "string", maxLength: 4000 },
            checklistItems: {
              type: "array",
              maxItems: 20,
              items: { type: "string", maxLength: 500 }
            },
            priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
            dueAt: { type: "string" },
            draftReplyText: { type: "string", maxLength: 8000 },
            rationale: { type: "string", maxLength: 1200 }
          }
        }
      }
    }
  }
};

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
  mailboxContext?: string;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastScanAt?: string;
  lastSyncAt?: string;
  lastScanResult?: JsonObject;
} {
  const settings = asRecord(metadataRecord(account).emailTriage) ?? {};
  const output = {
    enabled: settings.enabled !== false
  } as {
    enabled: boolean;
    mailboxContext?: string;
    lastAttemptAt?: string;
    lastSuccessAt?: string;
    lastFailureAt?: string;
    lastScanAt?: string;
    lastSyncAt?: string;
    lastScanResult?: JsonObject;
  };
  if (typeof settings.mailboxContext === "string") output.mailboxContext = settings.mailboxContext;
  if (typeof settings.lastAttemptAt === "string") output.lastAttemptAt = settings.lastAttemptAt;
  if (typeof settings.lastSuccessAt === "string") output.lastSuccessAt = settings.lastSuccessAt;
  if (typeof settings.lastFailureAt === "string") output.lastFailureAt = settings.lastFailureAt;
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

function gmailMessageUrl(account: ProviderAccount, message: GogEmailMessage | GogSearchMessage): string {
  const mailbox = accountEmail(account) ?? "0";
  const threadId = message.threadId ?? message.id;
  return `https://mail.google.com/mail/u/${encodeURIComponent(mailbox)}/#inbox/${encodeURIComponent(threadId)}`;
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

export function emailAddressFromHeader(value: string | undefined): string | undefined {
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
  if (!bodyExcerpt(message) && !message.subject?.trim()) {
    return { shouldTriage: false, reason: "empty_content" };
  }
  return { shouldTriage: true };
}

function modelSignals(message: GogEmailMessage): string[] {
  const signals: string[] = [];
  const localPart = senderLocalPart(message.from);
  if (hasBulkOrAutomatedHeaders(message)) signals.push("bulk_or_automated_headers");
  if (hasAutomatedSenderToken(localPart, message.from)) signals.push("automated_sender");
  if (hasAutomatedDomain(senderDomain(message.from))) signals.push("automated_domain");
  if (hasAutomatedSubject(message.subject)) signals.push("automated_subject");
  if (`${message.snippet ?? ""} ${message.bodyText ?? ""}`.toLowerCase().includes("unsubscribe")) {
    signals.push("unsubscribe_text");
  }
  return signals;
}

function proposedDueAt(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

export function preferenceForSender(
  preferences: EmailSenderPreference[],
  address: string | undefined
): EmailSenderPreference | undefined {
  if (!address) return undefined;
  const exact = preferences.find(
    (preference) => preference.matchType === "address" && preference.value === address
  );
  if (exact) return exact;
  const domain = address.split("@")[1];
  if (!domain) return undefined;
  return preferences
    .filter(
      (preference) =>
        preference.matchType === "domain" &&
        (domain === preference.value || domain.endsWith(`.${preference.value}`))
    )
    .sort((left, right) => right.value.length - left.value.length)[0];
}

function dateValue(message: GogEmailMessage): number {
  const iso = isoFromGmailDate(message.date);
  return iso ? new Date(iso).getTime() : 0;
}

export function latestInboundMessage(
  thread: GogEmailThread,
  mailboxAddress: string
): GogEmailMessage | undefined {
  const mailbox = mailboxAddress.toLowerCase();
  return [...thread.messages]
    .sort((left, right) => dateValue(right) - dateValue(left))
    .find((message) => emailAddressFromHeader(message.from) !== mailbox);
}

function contentFingerprint(message: GogEmailMessage): string {
  return createHash("sha256")
    .update([
      message.id,
      message.threadId ?? "",
      message.from ?? "",
      message.subject ?? "",
      message.date ?? "",
      bodyExcerpt(message)
    ].join("\n"))
    .digest("hex");
}

function threadContext(thread: GogEmailThread, latestMessageId: string): string {
  return [...thread.messages]
    .sort((left, right) => dateValue(left) - dateValue(right))
    .filter((message) => message.id !== latestMessageId)
    .slice(-3)
    .map((message) => [
      `From: ${message.from ?? "unknown"}`,
      `Date: ${message.date ?? "unknown"}`,
      `Summary: ${compactText(message.bodyText ?? message.snippet, 1000) ?? ""}`
    ].join("\n"))
    .join("\n---\n");
}

type TriageCandidate = {
  account: ProviderAccount;
  source: ExternalSource;
  message: GogEmailMessage;
  thread: GogEmailThread;
  fingerprint: string;
  senderAddress?: string;
  senderPreference?: EmailSenderPreference;
  priorRetryCount: number;
};

function batchMessageForAi(input: {
  candidates: TriageCandidate[];
  query: string;
  displayName?: string;
  timezone?: string;
}): IncomingMessage {
  const first = input.candidates[0];
  if (!first) throw new Error("Cannot classify an empty email batch.");
  const rendered = input.candidates.map((candidate, index) => {
    const email = accountEmail(candidate.account) ?? candidate.account.id;
    const accountContext = asRecord(metadataRecord(candidate.account).emailTriage)?.mailboxContext;
    return [
      `MESSAGE ${index + 1}`,
      `Message ID: ${candidate.message.id}`,
      `Mailbox: ${email}`,
      `Mailbox context: ${typeof accountContext === "string" ? accountContext : "none supplied"}`,
      `Sender preference: ${candidate.senderPreference?.disposition ?? "none"}`,
      `Model signals: ${modelSignals(candidate.message).join(", ") || "none"}`,
      `From: ${candidate.message.from ?? "unknown"}`,
      `To: ${candidate.message.to ?? "unknown"}`,
      `Date: ${candidate.message.date ?? "unknown"}`,
      `Subject: ${candidate.message.subject ?? "(no subject)"}`,
      `Snippet: ${candidate.message.snippet ?? ""}`,
      "Latest inbound sanitized content:",
      bodyExcerpt(candidate.message),
      "Prior thread context (oldest to newest, bounded):",
      threadContext(candidate.thread, candidate.message.id) || "none"
    ].join("\n");
  });
  return {
    id: `gmail-batch:${first.account.userId}:${Date.now()}`,
    provider: "system",
    chatId: `gmail-triage:${first.account.userId}`,
    userId: first.account.userId,
    text: [
      "RyanOS Gmail triage. Classify every supplied latest inbound message.",
      `User display name: ${input.displayName ?? "RyanOS user"}`,
      `User timezone: ${input.timezone ?? "unknown"}`,
      `Scan query: ${input.query}`,
      "Call email.classify_batch exactly once and return one decision for every supplied Message ID.",
      "Outcomes: actionable for a clear required action, maybe for plausible action needing review, no_action for informational mail.",
      "A likely sender preference is a positive prior, never a forced task.",
      "Automated sender, bulk headers, unsubscribe text, and promotional language lower confidence but do not veto DocuSign, leads, payment failures, booking changes, deadlines, approvals, or account problems.",
      "Human requests, signatures/approvals, customer or rental leads, failed payments, account exceptions, appointments requiring confirmation, and expiring business opportunities are often actionable.",
      "Routine receipts, newsletters, successful shipping/status notices, marketing, and completed confirmations are usually no_action unless they request a concrete response.",
      "One outcome with several steps must become one task proposal with checklistItems, not several separate tasks.",
      "Use initialProgressNote only when the email states useful progress that already happened, such as a message sent, response received, or vendor contacted.",
      "Use checklistItems only for concrete flat substeps the email clearly implies; do not invent speculative steps.",
      "Do not send email, create Gmail drafts, mark messages read, label messages, or create RyanOS items.",
      "",
      rendered.join("\n\n====================\n\n")
    ].join("\n"),
    timestamp: nowIso(),
    attachments: [],
    metadata: {
      kind: "gmail_triage",
      classifierVersion: EMAIL_TRIAGE_CLASSIFIER_VERSION,
      messageIds: input.candidates.map((candidate) => candidate.message.id)
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
    if (!account.scopes.some((scope) => scope.toLowerCase().includes("gmail"))) continue;
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
  succeeded: boolean;
}): Promise<void> {
  const at = nowIso();
  await input.store.updateProviderAccount(input.account.id, {
    metadata: mergeEmailTriageMetadata(input.account, {
      lastAttemptAt: at,
      ...(input.succeeded ? { lastSuccessAt: at } : { lastFailureAt: at }),
      lastScanAt: at,
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
    url: gmailMessageUrl(input.account, input.message),
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
        date: input.message.date,
        fingerprint: contentFingerprint(input.message)
      }
    })
  };
  const summary = compactText(input.message.snippet ?? input.message.bodyText, 1000);
  if (summary !== undefined) source.summary = summary;
  const occurredAt = isoFromGmailDate(input.message.date);
  if (occurredAt !== undefined) source.occurredAt = occurredAt;
  return input.store.upsertExternalSource(source);
}

function sanitizedError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const redacted = message
    .replace(/[\r\n]+/g, " ")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b(bearer|token|secret|password|authorization)\b\s*[:=]?\s*[^\s,;]+/gi, "$1 [redacted]")
    .replace(/\/(?:Users|home)\/[^\s]+/g, "[local-path]");
  return compactText(redacted, 500) ?? "Unknown email triage error";
}

async function recordDecision(input: {
  store: RyanStore;
  candidate: TriageCandidate;
  outcome: EmailTriageOutcome;
  reasonCode?: string;
  reason?: string;
  confidence?: number;
  retryCount?: number;
  nextRetryAt?: string;
  metadata?: JsonObject;
}): Promise<EmailTriageDecision> {
  return input.store.upsertEmailTriageDecision({
    userId: input.candidate.account.userId,
    sourceId: input.candidate.source.id,
    providerAccountId: input.candidate.account.id,
    gmailMessageId: input.candidate.message.id,
    gmailThreadId: input.candidate.message.threadId ?? input.candidate.thread.id,
    contentFingerprint: input.candidate.fingerprint,
    classifierVersion: EMAIL_TRIAGE_CLASSIFIER_VERSION,
    outcome: input.outcome,
    ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
    ...(input.candidate.senderAddress ? { senderAddress: input.candidate.senderAddress } : {}),
    retryCount: input.retryCount ?? 0,
    ...(input.nextRetryAt ? { nextRetryAt: input.nextRetryAt } : {}),
    evaluatedAt: nowIso(),
    metadata: input.metadata ?? {}
  });
}

async function recordClassifierError(input: {
  store: RyanStore;
  candidate: TriageCandidate;
  error: unknown;
}): Promise<EmailTriageDecision> {
  const retryCount = Math.min(input.candidate.priorRetryCount + 1, EMAIL_TRIAGE_MAX_RETRIES);
  const delayMinutes = Math.min(5 * (2 ** Math.max(retryCount - 1, 0)), 60);
  return recordDecision({
    store: input.store,
    candidate: input.candidate,
    outcome: "error",
    reasonCode: "classifier_error",
    reason: sanitizedError(input.error),
    retryCount,
    nextRetryAt: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
    metadata: asJsonObject({ retryable: retryCount < EMAIL_TRIAGE_MAX_RETRIES })
  });
}

async function upsertProposalFromDecision(input: {
  store: RyanStore;
  ai: AiProvider;
  candidate: TriageCandidate;
  decision: EmailTriageDecision;
  proposalInput: z.infer<typeof emailTriageDecisionInputSchema>;
  interpretedText?: string;
  warnings?: string[];
}): Promise<{ proposal: EmailActionProposal; created: boolean }> {
  const proposalInput = input.proposalInput;
  const idempotencyKey = ["gmail", input.candidate.account.id, input.candidate.message.id].join(":");
  const existing = (await input.store.listEmailActionProposals({
    userId: input.candidate.account.userId,
    providerAccountId: input.candidate.account.id,
    limit: 200
  })).find((candidate) => candidate.idempotencyKey === idempotencyKey);
  const proposal: EmailActionProposalUpsertData = {
    userId: input.candidate.account.userId,
    sourceId: input.candidate.source.id,
    providerAccountId: input.candidate.account.id,
    triageDecisionId: input.decision.id,
    idempotencyKey,
    actionType: proposalInput.actionType ?? "task",
    title: proposalInput.title ?? sourceTitle(input.candidate.message),
    priority: proposalInput.priority ?? "normal",
    metadata: asJsonObject({
      source: "gmail_triage",
      triageOutcome: input.decision.outcome,
      accountEmail: accountEmail(input.candidate.account),
      messageId: input.candidate.message.id,
      threadId: input.candidate.message.threadId,
      subject: input.candidate.message.subject,
      from: input.candidate.message.from,
      senderPreference: input.candidate.senderPreference?.disposition,
      initialProgressNote: proposalInput.initialProgressNote,
      checklistItems: proposalInput.checklistItems,
      aiProvider: input.ai.name,
      interpretedText: input.interpretedText,
      warnings: input.warnings
    })
  };
  if (proposalInput.body !== undefined) proposal.body = proposalInput.body;
  const dueAt = proposedDueAt(proposalInput.dueAt);
  if (dueAt !== undefined) proposal.dueAt = dueAt;
  if (proposalInput.draftReplyText !== undefined) proposal.draftReplyText = proposalInput.draftReplyText;
  proposal.rationale = proposalInput.rationale ?? proposalInput.reason;
  proposal.confidence = proposalInput.confidence;
  return {
    proposal: await input.store.upsertEmailActionProposal(proposal),
    created: existing === undefined
  };
}

type BatchTriageResult = {
  actionable: number;
  maybe: number;
  noAction: number;
  modelErrors: number;
  newProposals: number;
  updatedProposals: number;
  proposalsCreatedOrUpdated: number;
};

async function triageBatch(input: {
  ai: AiProvider;
  store: RyanStore;
  candidates: TriageCandidate[];
  query: string;
  displayName?: string;
  timezone?: string;
}): Promise<BatchTriageResult> {
  const result: BatchTriageResult = {
    actionable: 0,
    maybe: 0,
    noAction: 0,
    modelErrors: 0,
    newProposals: 0,
    updatedProposals: 0,
    proposalsCreatedOrUpdated: 0
  };
  let interpreted: Awaited<ReturnType<AiProvider["interpret"]>>;
  try {
    interpreted = await input.ai.interpret(
      batchMessageForAi(input),
      [emailClassifyBatchTool]
    );
  } catch (error) {
    await Promise.all(input.candidates.map((candidate) => recordClassifierError({
      store: input.store,
      candidate,
      error
    })));
    result.modelErrors = input.candidates.length;
    return result;
  }

  const calls = interpreted.toolCalls.filter((call) => call.name === emailClassifyBatchTool.name);
  const parsed = calls.length === 1 ? emailBatchDecisionSchema.safeParse(calls[0]?.input) : undefined;
  const decisions = parsed?.success ? parsed.data.decisions : [];
  const countsByMessageId = new Map<string, number>();
  for (const decision of decisions) {
    countsByMessageId.set(decision.messageId, (countsByMessageId.get(decision.messageId) ?? 0) + 1);
  }

  for (const candidate of input.candidates) {
    const decisionInput = decisions.find((decision) => decision.messageId === candidate.message.id);
    if (!decisionInput || countsByMessageId.get(candidate.message.id) !== 1) {
      await recordClassifierError({
        store: input.store,
        candidate,
        error: parsed && !parsed.success
          ? `Invalid batch classifier output: ${parsed.error.issues[0]?.message ?? "schema error"}`
          : "Classifier omitted or duplicated the supplied message ID."
      });
      result.modelErrors += 1;
      continue;
    }
    const decision = await recordDecision({
      store: input.store,
      candidate,
      outcome: decisionInput.outcome,
      ...(decisionInput.reasonCode ? { reasonCode: decisionInput.reasonCode } : {}),
      reason: decisionInput.reason,
      confidence: decisionInput.confidence,
      metadata: asJsonObject({
        modelSignals: modelSignals(candidate.message),
        senderPreference: candidate.senderPreference?.disposition,
        aiProvider: input.ai.name,
        warnings: interpreted.warnings
      })
    });
    if (decision.outcome === "actionable") result.actionable += 1;
    if (decision.outcome === "maybe") result.maybe += 1;
    if (decision.outcome === "no_action") result.noAction += 1;
    if (decision.outcome !== "no_action") {
      const proposalResult = await upsertProposalFromDecision({
        store: input.store,
        ai: input.ai,
        candidate,
        decision,
        proposalInput: decisionInput,
        ...(interpreted.text ? { interpretedText: interpreted.text } : {}),
        ...(interpreted.warnings ? { warnings: interpreted.warnings } : {})
      });
      if (proposalResult.created) result.newProposals += 1;
      else result.updatedProposals += 1;
      result.proposalsCreatedOrUpdated += 1;
    }
  }
  return result;
}

export type EmailScanResult = {
  query: string;
  maxPerAccount: number;
  maxPerUser: number;
  accountsScanned: number;
  accountsFailed: number;
  accountsSkipped: number;
  threadsSeen: number;
  unseenThreadsEvaluated: number;
  unchangedDecisions: number;
  messagesSeen: number;
  messagesFetched: number;
  messagesSkippedByFilter: number;
  filterReasons: Record<string, number>;
  actionableDecisions: number;
  maybeDecisions: number;
  noActionDecisions: number;
  senderRuleExclusions: number;
  modelFailures: number;
  backlog: number;
  newProposals: number;
  updatedProposals: number;
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
  maxPerUser?: number;
  syncAccounts?: boolean;
  includeNewAccounts?: boolean;
  displayName?: string;
  timezone?: string;
}): Promise<EmailScanResult> {
  const query = input.query?.trim() || DEFAULT_EMAIL_SCAN_QUERY;
  const maxPerAccount = Math.min(
    Math.max(input.maxPerAccount ?? DEFAULT_EMAIL_SCAN_MAX_PER_ACCOUNT, 1),
    100
  );
  const maxPerUser = Math.min(
    Math.max(input.maxPerUser ?? DEFAULT_EMAIL_SCAN_MAX_PER_USER, 1),
    200
  );
  const result: EmailScanResult = {
    query,
    maxPerAccount,
    maxPerUser,
    accountsScanned: 0,
    accountsFailed: 0,
    accountsSkipped: 0,
    threadsSeen: 0,
    unseenThreadsEvaluated: 0,
    unchangedDecisions: 0,
    messagesSeen: 0,
    messagesFetched: 0,
    messagesSkippedByFilter: 0,
    filterReasons: {},
    actionableDecisions: 0,
    maybeDecisions: 0,
    noActionDecisions: 0,
    senderRuleExclusions: 0,
    modelFailures: 0,
    backlog: 0,
    newProposals: 0,
    updatedProposals: 0,
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
  const senderPreferences = await input.store.listEmailSenderPreferences(input.userId);
  let userUnseenCount = 0;

  for (const account of filteredAccounts) {
    if (userUnseenCount >= maxPerUser) {
      result.accountsSkipped += 1;
      continue;
    }
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
      const candidates: TriageCandidate[] = [];
      let pageToken: string | undefined;
      let accountUnseenCount = 0;
      let accountThreadsSeen = 0;
      let accountProposalCount = 0;
      let accountSkippedByFilter = 0;
      let accountUnchanged = 0;
      const accountFilterReasons: Record<string, number> = {};
      let hasMore = false;

      do {
        const page = await input.client.searchMessagePage({
          accountEmail: email,
          query,
          max: Math.max(maxPerAccount, 25),
          ...(pageToken ? { pageToken } : {})
        });
        pageToken = page.nextPageToken;
        hasMore = Boolean(pageToken);
        result.messagesSeen += page.messages.length;
        result.threadsSeen += page.messages.length;
        accountThreadsSeen += page.messages.length;

        for (const searchResult of page.messages) {
          if (accountUnseenCount >= maxPerAccount || userUnseenCount >= maxPerUser) break;
          try {
            const threadId = searchResult.threadId ?? searchResult.id;
            const thread = await input.client.getThread({ accountEmail: email, threadId });
            result.messagesFetched += thread.messages.length;
            const inbound = latestInboundMessage(thread, email);
            const selectedMessage = inbound ?? [...thread.messages]
              .sort((left, right) => dateValue(right) - dateValue(left))[0];
            if (!selectedMessage) continue;
            const message: GogEmailMessage = {
              ...selectedMessage,
              threadId,
              ...((selectedMessage.subject ?? searchResult.subject)
                ? { subject: selectedMessage.subject ?? searchResult.subject }
                : {}),
              ...((selectedMessage.snippet ?? searchResult.snippet)
                ? { snippet: selectedMessage.snippet ?? searchResult.snippet }
                : {}),
              raw: selectedMessage.raw
            };
            const fingerprint = contentFingerprint(message);
            const priorDecisions = await input.store.listEmailTriageDecisions({
              userId: input.userId,
              providerAccountId: account.id,
              gmailThreadId: threadId,
              limit: 200
            });
            const prior = priorDecisions.find(
              (decision) =>
                decision.gmailMessageId === message.id &&
                decision.contentFingerprint === fingerprint &&
                decision.classifierVersion === EMAIL_TRIAGE_CLASSIFIER_VERSION
            );
            const legacyDecision = priorDecisions.find(
              (decision) =>
                decision.gmailMessageId === message.id &&
                decision.classifierVersion === "legacy-v1"
            );
            const retryDue = prior?.outcome === "error" &&
              prior.retryCount < EMAIL_TRIAGE_MAX_RETRIES &&
              (!prior.nextRetryAt || new Date(prior.nextRetryAt).getTime() <= Date.now());
            if ((prior && !retryDue) || (!prior && legacyDecision)) {
              result.unchangedDecisions += 1;
              accountUnchanged += 1;
              continue;
            }

            accountUnseenCount += 1;
            userUnseenCount += 1;
            result.unseenThreadsEvaluated += 1;
            const source = await upsertSourceForMessage({ store: input.store, account, message });
            const senderAddress = emailAddressFromHeader(message.from);
            const senderPreference = preferenceForSender(senderPreferences, senderAddress);
            const candidate: TriageCandidate = {
              account,
              source,
              message,
              thread,
              fingerprint,
              ...(senderAddress ? { senderAddress } : {}),
              ...(senderPreference ? { senderPreference } : {}),
              priorRetryCount: prior?.retryCount ?? 0
            };

            let deterministicReason: string | undefined;
            if (!inbound) {
              deterministicReason = "self_sent";
            } else if (message.labels && message.labels.length > 0 && !message.labels.includes("INBOX")) {
              deterministicReason = "outside_inbox";
            } else if (senderPreference?.disposition === "never") {
              deterministicReason = "sender_preference_never";
              result.senderRuleExclusions += 1;
            } else {
              const filterDecision = shouldTriageEmailMessage(message);
              if (!filterDecision.shouldTriage) deterministicReason = filterDecision.reason ?? "filtered";
            }
            if (deterministicReason) {
              await recordDecision({
                store: input.store,
                candidate,
                outcome: "no_action",
                reasonCode: deterministicReason,
                reason: deterministicReason === "sender_preference_never"
                  ? "Blocked by the user's sender preference."
                  : "Excluded before classification because the message is not eligible.",
                metadata: asJsonObject({ deterministic: true })
              });
              result.noActionDecisions += 1;
              result.messagesSkippedByFilter += 1;
              result.filterReasons[deterministicReason] = (result.filterReasons[deterministicReason] ?? 0) + 1;
              accountSkippedByFilter += 1;
              accountFilterReasons[deterministicReason] = (accountFilterReasons[deterministicReason] ?? 0) + 1;
            } else {
              candidates.push(candidate);
            }
          } catch (error) {
            result.errors.push({
              accountId: account.id,
              accountEmail: email,
              messageId: searchResult.id,
              error: sanitizedError(error)
            });
          }
        }
      } while (
        hasMore &&
        accountUnseenCount < maxPerAccount &&
        userUnseenCount < maxPerUser
      );

      if (hasMore) result.backlog += 1;
      for (let index = 0; index < candidates.length; index += EMAIL_TRIAGE_BATCH_SIZE) {
        const batch = candidates.slice(index, index + EMAIL_TRIAGE_BATCH_SIZE);
        const batchResult = await triageBatch({
          ai: input.ai,
          store: input.store,
          candidates: batch,
          query,
          ...(input.displayName ? { displayName: input.displayName } : {}),
          ...(input.timezone ? { timezone: input.timezone } : {})
        });
        result.actionableDecisions += batchResult.actionable;
        result.maybeDecisions += batchResult.maybe;
        result.noActionDecisions += batchResult.noAction;
        result.modelFailures += batchResult.modelErrors;
        result.newProposals += batchResult.newProposals;
        result.updatedProposals += batchResult.updatedProposals;
        result.proposalsCreatedOrUpdated += batchResult.proposalsCreatedOrUpdated;
        accountProposalCount += batchResult.proposalsCreatedOrUpdated;
      }
      await updateAccountScanResult({
        store: input.store,
        account,
        succeeded: true,
        result: asJsonObject({
          status: "ok",
          query,
          threadsSeen: accountThreadsSeen,
          unseenThreadsEvaluated: accountUnseenCount,
          unchangedDecisions: accountUnchanged,
          messagesSkippedByFilter: accountSkippedByFilter,
          filterReasons: accountFilterReasons,
          proposalsCreatedOrUpdated: accountProposalCount,
          backlog: hasMore ? 1 : 0
        })
      });
    } catch (error) {
      result.accountsFailed += 1;
      result.errors.push({
        accountId: account.id,
        accountEmail: email,
        error: sanitizedError(error)
      });
      await updateAccountScanResult({
        store: input.store,
        account,
        succeeded: false,
        result: asJsonObject({
          status: "failed",
          query,
          error: sanitizedError(error)
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
  triage?: {
    id: string;
    outcome: EmailTriageOutcome;
    reasonCode?: string;
    reason?: string;
  };
  senderAddress?: string;
  senderPreference?: {
    id: string;
    matchType: EmailSenderPreference["matchType"];
    value: string;
    disposition: EmailSenderPreference["disposition"];
  };
  initialProgressNote?: string;
  checklistItems: string[];
};

export async function proposalView(
  store: RyanStore,
  proposal: EmailActionProposal
): Promise<EmailProposalView> {
  const [account, source, triage, preferences] = await Promise.all([
    proposal.providerAccountId ? store.getProviderAccount(proposal.providerAccountId) : Promise.resolve(undefined),
    store.getExternalSource(proposal.sourceId),
    proposal.triageDecisionId
      ? store.getEmailTriageDecision(proposal.triageDecisionId)
      : Promise.resolve(undefined),
    store.listEmailSenderPreferences(proposal.userId)
  ]);
  const gmailMetadata = asRecord(source?.metadata.gmail);
  const senderAddress = emailAddressFromHeader(
    typeof gmailMetadata?.from === "string" ? gmailMetadata.from : undefined
  );
  const senderPreference = preferenceForSender(preferences, senderAddress);
  const initialProgressNote = initialProgressNoteForProposal(proposal);
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
      : {}),
    ...(triage
      ? {
          triage: {
            id: triage.id,
            outcome: triage.outcome,
            ...(triage.reasonCode ? { reasonCode: triage.reasonCode } : {}),
            ...(triage.reason ? { reason: triage.reason } : {})
          }
        }
      : {}),
    ...(senderAddress ? { senderAddress } : {}),
    ...(senderPreference
      ? {
          senderPreference: {
            id: senderPreference.id,
            matchType: senderPreference.matchType,
            value: senderPreference.value,
            disposition: senderPreference.disposition
          }
        }
      : {}),
    ...(initialProgressNote ? { initialProgressNote } : {}),
    checklistItems: checklistItemsForProposal(proposal)
  };
}

function itemBodyForProposal(proposal: EmailActionProposal, source: ExternalSource | undefined): string | undefined {
  const pieces = [
    proposal.body,
    proposal.rationale ? `Why: ${proposal.rationale}` : undefined,
    source?.title ? `Email: ${source.title}` : undefined,
    source?.url ? `[Open email](${source.url})` : undefined
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
