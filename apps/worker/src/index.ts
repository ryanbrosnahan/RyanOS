import { run, type TaskList } from "graphile-worker";
import { nowIso } from "@ryanos/shared";

const apiUrl = process.env.RYANOS_API_URL?.trim() || "http://api:4000";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const tasks: TaskList = {
  "ryanos.health": async (_payload, helpers) => {
    helpers.logger.info(`RyanOS worker health task ran at ${nowIso()}`);
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
await runner.promise;
