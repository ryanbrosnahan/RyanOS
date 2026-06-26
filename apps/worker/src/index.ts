import { run, type TaskList } from "graphile-worker";
import { nowIso } from "@ryanos/shared";
import { readFile } from "node:fs/promises";

const apiUrl = process.env.RYANOS_API_URL?.trim() || "http://api:4000";
const rfpIngestToken = process.env.RYANOS_RFP_INGEST_TOKEN?.trim();
const emailScanEnabled = process.env.EMAIL_TRIAGE_ENABLED !== "false";
const emailScanIntervalMinutes = Math.min(
  Math.max(Number(process.env.EMAIL_SCAN_INTERVAL_MINUTES ?? "60") || 60, 5),
  1440
);
const rfpReportIngestEnabled = process.env.RFP_REPORT_INGEST_ENABLED !== "false";
const rfpReportIngestIntervalMinutes = Math.min(
  Math.max(Number(process.env.RFP_REPORT_INGEST_INTERVAL_MINUTES ?? "60") || 60, 5),
  1440
);

type ReportSource = {
  path: string;
  userId: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function configuredReportSources(): ReportSource[] {
  const raw = process.env.RYANOS_RFP_REPORT_SOURCES?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.flatMap((entry): ReportSource[] => {
        if (typeof entry === "string" && entry.trim()) {
          return [{ path: entry.trim(), userId: "local-owner" }];
        }
        const record = asRecord(entry);
        if (typeof record.path === "string" && record.path.trim()) {
          return [{
            path: record.path.trim(),
            userId: typeof record.userId === "string" && record.userId.trim() ? record.userId.trim() : "local-owner"
          }];
        }
        return [];
      });
    }
  } catch {
    // Fall through to comma-separated parsing.
  }
  return raw
    .split(",")
    .map((path) => path.trim())
    .filter(Boolean)
    .map((path) => ({ path, userId: "local-owner" }));
}

async function readReportSource(source: ReportSource): Promise<Record<string, unknown>> {
  const raw = await readFile(source.path, "utf8");
  const report = JSON.parse(raw) as unknown;
  return {
    userId: source.userId,
    report
  };
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
  "ryanos.rfp_reports.ingest": async (payload, helpers) => {
    const input = asRecord(payload);
    const sources = Array.isArray(input.sources)
      ? input.sources.flatMap((entry): ReportSource[] => {
          if (typeof entry === "string" && entry.trim()) return [{ path: entry.trim(), userId: "local-owner" }];
          const record = asRecord(entry);
          if (typeof record.path === "string" && record.path.trim()) {
            return [{
              path: record.path.trim(),
              userId: typeof record.userId === "string" && record.userId.trim() ? record.userId.trim() : "local-owner"
            }];
          }
          return [];
        })
      : configuredReportSources();
    if (sources.length === 0) {
      helpers.logger.info("No RFP report sources configured.");
      return;
    }
    const results = [];
    for (const source of sources) {
      const body = await readReportSource(source);
      const result = await requestOpportunityReportIngest(body);
      results.push({ path: source.path, result });
    }
    helpers.logger.info(`RFP report ingest results: ${JSON.stringify(results)}`);
  },
  "ryanos.daily_plan.prompt": async (payload, helpers) => {
    helpers.logger.info(`Daily plan prompt task is retired; ignoring payload: ${JSON.stringify(payload)}`);
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

async function requestOpportunityReportIngest(body: Record<string, unknown>): Promise<unknown> {
  const headers: Record<string, string> = {
    "content-type": "application/json"
  };
  if (rfpIngestToken) {
    headers.authorization = `Bearer ${rfpIngestToken}`;
  }
  const response = await fetch(
    rfpIngestToken
      ? `${apiUrl}/v1/automation/rfp-reports/ingest`
      : `${apiUrl}/v1/opportunity-proposals/ingest`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    }
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Opportunity report ingest returned HTTP ${response.status}: ${JSON.stringify(result)}`);
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

const reportSources = configuredReportSources();
if (rfpReportIngestEnabled && reportSources.length > 0) {
  const runReportIngest = async () => {
    try {
      const results = [];
      for (const source of reportSources) {
        const body = await readReportSource(source);
        const result = await requestOpportunityReportIngest(body);
        results.push({ path: source.path, result });
      }
      console.log(`RyanOS RFP report ingest completed: ${JSON.stringify(results)}`);
    } catch (err) {
      console.error(`RyanOS RFP report ingest failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  setTimeout(() => {
    void runReportIngest();
  }, 90000);
  setInterval(() => {
    void runReportIngest();
  }, rfpReportIngestIntervalMinutes * 60 * 1000);
}

await runner.promise;
