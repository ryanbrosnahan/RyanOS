import { run, type TaskList } from "graphile-worker";
import { nowIso } from "@ryanos/shared";

const tasks: TaskList = {
  "ryanos.health": async (_payload, helpers) => {
    helpers.logger.info(`RyanOS worker health task ran at ${nowIso()}`);
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

