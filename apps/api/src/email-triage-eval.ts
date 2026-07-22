import { createAiProviderFromEnv } from "@ryanos/ai";
import { InMemoryRyanStore, type RyanStore } from "@ryanos/core";
import { createDb, PostgresRyanStore } from "@ryanos/db";
import type { GogEmailMessage } from "./gog-gmail.js";
import { scanGmailInbox, type GmailClientLike } from "./email-triage.js";

type Fixture = {
  id: string;
  expected: "actionable" | "maybe" | "no_action";
  from: string;
  subject: string;
  body: string;
};

const fixtures: Fixture[] = [
  { id: "human-request", expected: "actionable", from: "alex@example.com", subject: "Can you review this?", body: "Please review the attached plan and send comments by Friday." },
  { id: "rental-lead", expected: "actionable", from: "guest@example.com", subject: "July rental availability", body: "Is the house available July 10-14? Please send the total price." },
  { id: "docusign", expected: "actionable", from: "no-reply@docusign.net", subject: "Signature required", body: "Your signature is required by tomorrow to complete the agreement." },
  { id: "account-exception", expected: "actionable", from: "alerts@service.example", subject: "Account verification needed", body: "We could not verify your account. Upload identification to avoid suspension." },
  { id: "payment-failure", expected: "actionable", from: "billing@vendor.example", subject: "Payment failed", body: "Your payment failed. Update the payment method to keep service active." },
  { id: "appointment", expected: "actionable", from: "office@clinic.example", subject: "Confirm appointment", body: "Please confirm or reschedule your appointment for Monday at 2 PM." },
  { id: "newsletter", expected: "no_action", from: "news@publisher.example", subject: "Weekly newsletter", body: "This week's stories and product updates. Unsubscribe at any time." },
  { id: "receipt", expected: "no_action", from: "receipts@store.example", subject: "Your receipt", body: "Payment was successful. This email is your receipt." },
  { id: "shipping", expected: "no_action", from: "tracking@shipper.example", subject: "Package delivered", body: "Your package was delivered at 1:42 PM." },
  { id: "marketing-deadline", expected: "maybe", from: "events@industry.example", subject: "Speaker applications close Friday", body: "Applications for the industry conference close Friday. Apply if you want to present." }
];

function fixtureMessage(fixture: Fixture): GogEmailMessage {
  return {
    id: fixture.id,
    threadId: `thread-${fixture.id}`,
    from: fixture.from,
    to: "evaluation@ryanos.local",
    subject: fixture.subject,
    bodyText: fixture.body,
    date: "2026-07-22T12:00:00.000Z",
    labels: ["INBOX"],
    raw: {}
  };
}

function fixtureClient(): GmailClientLike {
  return {
    async doctor() {
      return { installed: true, ok: true };
    },
    async listAccounts() {
      return [];
    },
    async searchMessagePage() {
      return {
        messages: fixtures.map((fixture) => ({
          id: `thread-${fixture.id}`,
          threadId: `thread-${fixture.id}`,
          raw: {}
        }))
      };
    },
    async getThread({ threadId }) {
      const fixture = fixtures.find((candidate) => `thread-${candidate.id}` === threadId);
      if (!fixture) throw new Error(`Unknown fixture thread: ${threadId}`);
      return { id: threadId, messages: [fixtureMessage(fixture)], raw: {} };
    }
  };
}

async function productionAcceptanceAggregate(): Promise<Record<string, number> | undefined> {
  if (!process.env.DATABASE_URL) return undefined;
  const database = createDb();
  try {
    const store: RyanStore = new PostgresRyanStore(database.db);
    const accounts = await store.listProviderAccountsForProvider("gmail", 5000);
    const userIds = [...new Set(accounts.map((account) => account.userId))];
    const counts = { proposed: 0, accepted: 0, rejected: 0 };
    for (const userId of userIds) {
      for (const status of ["proposed", "accepted", "rejected"] as const) {
        counts[status] += (await store.listEmailActionProposals({ userId, status, limit: 200 })).length;
      }
    }
    return counts;
  } finally {
    await database.pool.end();
  }
}

const ai = createAiProviderFromEnv();
const status = await ai.getStatus();
if (!status.ready) throw new Error(`AI provider is not ready: ${status.warnings.join(" ")}`);
const store = new InMemoryRyanStore();
await store.upsertProviderAccount({
  userId: "email-evaluation",
  provider: "gmail",
  externalAccountId: "evaluation@ryanos.local",
  email: "evaluation@ryanos.local"
});
await scanGmailInbox({
  ai,
  store,
  client: fixtureClient(),
  userId: "email-evaluation",
  syncAccounts: false,
  maxPerAccount: fixtures.length,
  maxPerUser: fixtures.length,
  displayName: "Email evaluation user",
  timezone: "America/Chicago"
});
const decisions = await store.listEmailTriageDecisions({ userId: "email-evaluation", limit: 200 });
const rows = fixtures.map((fixture) => {
  const actual = decisions.find((decision) => decision.gmailMessageId === fixture.id)?.outcome ?? "missing";
  return { id: fixture.id, expected: fixture.expected, actual, correct: fixture.expected === actual };
});
const productionAcceptance = await productionAcceptanceAggregate();
process.stdout.write(`${JSON.stringify({
  fixtures: rows,
  accuracy: rows.filter((row) => row.correct).length / rows.length,
  ...(productionAcceptance ? { productionAcceptance } : {})
}, null, 2)}\n`);
