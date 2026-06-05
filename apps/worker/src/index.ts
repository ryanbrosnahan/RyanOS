import { run, type TaskList } from "graphile-worker";
import { nowIso } from "@ryanos/shared";

const apiUrl = process.env.RYANOS_API_URL?.trim() || "http://api:4000";
const emailScanEnabled = process.env.EMAIL_TRIAGE_ENABLED !== "false";
const emailScanIntervalMinutes = Math.min(
  Math.max(Number(process.env.EMAIL_SCAN_INTERVAL_MINUTES ?? "60") || 60, 5),
  1440
);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const tasks: TaskList = {
  "ryanos.health": async (_payload, helpers) => {
    helpers.logger.info(`RyanOS worker health task ran at ${nowIso()}`);
  },
  "ryanos.email.scan": async (payload, helpers) => {
    const input = asRecord(payload);
    const body = {
      userId: typeof input.userId === "string" ? input.userId : "local-owner",
      syncAccounts: input.syncAccounts !== false,
      ...(typeof input.accountId === "string" ? { accountId: input.accountId } : {}),
      ...(typeof input.query === "string" ? { query: input.query } : {}),
      ...(typeof input.maxPerAccount === "number" ? { maxPerAccount: input.maxPerAccount } : {})
    };
    const result = await requestEmailScan(body);
    helpers.logger.info(`Email scan result: ${JSON.stringify(result)}`);
  },
  "ryanos.daily_plan.prompt": async (payload, helpers) => {
    const input = asRecord(payload);
    const body = {
      userId: typeof input.userId === "string" ? input.userId : "local-owner",
      timezone: typeof input.timezone === "string" ? input.timezone : "America/Chicago",
      ...(typeof input.date === "string" ? { date: input.date } : {}),
      sendTelegram: input.sendTelegram === true,
      ...(typeof input.telegramChatId === "string" ? { telegramChatId: input.telegramChatId } : {})
    };
    const response = await fetch(`${apiUrl}/v1/daily-plan/prompt`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Daily plan prompt returned HTTP ${response.status}: ${JSON.stringify(result)}`);
    }
    helpers.logger.info(`Daily plan prompt result: ${JSON.stringify(result)}`);
  },
  "ryanos.reminder.evaluate": async (payload, helpers) => {
    helpers.logger.info(`Reminder evaluation placeholder: ${JSON.stringify(payload)}`);
  }
};

async function requestEmailScan(body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`${apiUrl}/v1/email/scan`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Email scan returned HTTP ${response.status}: ${JSON.stringify(result)}`);
  }
  return result;
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("DATABASE_URL is required to start the worker.");
  process.exit(1);
}

const runner = await run({
  connectionString,
  concurrency: 2,
  noHandleSignals: false,
  pollInterval: 1000,
  taskList: tasks
});

console.log("RyanOS worker started.");

if (emailScanEnabled) {
  const runHourlyScan = async () => {
    try {
      const result = await requestEmailScan({
        userId: "local-owner",
        syncAccounts: true
      });
      console.log(`RyanOS hourly email scan completed: ${JSON.stringify(result)}`);
    } catch (err) {
      console.error(`RyanOS hourly email scan failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  setTimeout(() => {
    void runHourlyScan();
  }, 60000);
  setInterval(() => {
    void runHourlyScan();
  }, emailScanIntervalMinutes * 60 * 1000);
}

await runner.promise;
