#!/usr/bin/env node
import { createDb } from "@ryanos/db";
import { setTimeout as sleepTimer } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { resolveTelegramBotToken } from "./telegram-credentials.js";

type TelegramPollResponse = {
  ok?: boolean;
  description?: string;
  parameters?: {
    retry_after?: number;
  };
  result?: Array<{
    update_id: number;
    [key: string]: unknown;
  }>;
};

type TelegramGetMeResponse = {
  ok?: boolean;
  description?: string;
  result?: {
    id?: number;
    username?: string;
    first_name?: string;
  };
};

const apiUrl = process.env.RYANOS_API_URL?.trim() || "http://127.0.0.1:4000";
const pollTimeoutSeconds = Number(process.env.TELEGRAM_POLL_TIMEOUT_SECONDS ?? "25");
const pollLimit = Number(process.env.TELEGRAM_POLL_LIMIT ?? "20");
const sendTyping =
  (process.env.TELEGRAM_SEND_TYPING ?? "true").trim().toLowerCase() !== "false";
const typingIntervalMs = Number(process.env.TELEGRAM_TYPING_INTERVAL_MS ?? "4500");
const retryBaseMs = Number(process.env.TELEGRAM_RETRY_BASE_MS ?? "1000");
const retryMaxMs = Number(process.env.TELEGRAM_RETRY_MAX_MS ?? "60000");

let shuttingDown = false;
const shutdownController = new AbortController();

function beginShutdown() {
  shuttingDown = true;
  shutdownController.abort();
}

process.once("SIGINT", beginShutdown);
process.once("SIGTERM", beginShutdown);

export class PollingStoppedError extends Error {
  constructor() {
    super("Telegram polling stopped");
    this.name = "PollingStoppedError";
  }
}

export class RetriableRequestError extends Error {
  readonly retryAfterMs: number | undefined;

  constructor(message: string, retryAfterMs?: number) {
    super(message);
    this.name = "RetriableRequestError";
    this.retryAfterMs = retryAfterMs;
  }
}

type RetryOperationOptions<T> = {
  operation: string;
  run: () => Promise<T>;
  shouldStop: () => boolean;
  sleep: (delayMs: number) => Promise<void>;
  baseDelayMs?: number;
  maxDelayMs?: number;
  random?: () => number;
  onRetry?: (input: {
    operation: string;
    attempt: number;
    delayMs: number;
    error: unknown;
  }) => void;
};

export function retryDelayMs(
  error: unknown,
  attempt: number,
  baseDelayMs = 1_000,
  maxDelayMs = 60_000,
  random: () => number = Math.random
): number {
  const exponent = Math.min(Math.max(attempt - 1, 0), 10);
  const boundedBase = Math.min(maxDelayMs, baseDelayMs * 2 ** exponent);
  const jittered = Math.min(maxDelayMs, boundedBase + Math.floor(boundedBase * 0.2 * random()));
  return Math.max(error instanceof RetriableRequestError ? error.retryAfterMs ?? 0 : 0, jittered);
}

export async function retryOperation<T>(options: RetryOperationOptions<T>): Promise<T> {
  let attempt = 0;
  while (!options.shouldStop()) {
    try {
      return await options.run();
    } catch (error) {
      if (!(error instanceof RetriableRequestError)) throw error;
      attempt += 1;
      const delayMs = retryDelayMs(
        error,
        attempt,
        options.baseDelayMs,
        options.maxDelayMs,
        options.random
      );
      options.onRetry?.({ operation: options.operation, attempt, delayMs, error });
      await options.sleep(delayMs);
    }
  }
  throw new PollingStoppedError();
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

async function waitForRetry(delayMs: number): Promise<void> {
  if (shuttingDown) return;
  try {
    await sleepTimer(delayMs, undefined, { signal: shutdownController.signal });
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "AbortError") throw error;
  }
}

function retryLog(input: {
  operation: string;
  attempt: number;
  delayMs: number;
  error: unknown;
}) {
  console.error(
    JSON.stringify({
      status: "retrying",
      operation: input.operation,
      attempt: input.attempt,
      delayMs: input.delayMs,
      error: input.error instanceof Error ? input.error.message : String(input.error)
    })
  );
}

function withRetry<T>(operation: string, run: () => Promise<T>): Promise<T> {
  return retryOperation({
    operation,
    run,
    shouldStop: () => shuttingDown,
    sleep: waitForRetry,
    baseDelayMs: retryBaseMs,
    maxDelayMs: retryMaxMs,
    onRetry: retryLog
  });
}

async function telegramApi<T>(
  token: string,
  method: string,
  payload: Record<string, unknown>,
  fetchFn: typeof fetch = fetch
): Promise<T> {
  let response: Response;
  try {
    response = await fetchFn(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    throw new RetriableRequestError(
      `Telegram ${method} request failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    description?: string;
    parameters?: { retry_after?: number };
  };
  if (!response.ok || body.ok !== true) {
    const message =
      `Telegram ${method} failed with HTTP ${response.status}: ${
        body.description ?? response.statusText
      }`;
    if (retryableStatus(response.status)) {
      const retryAfterSeconds = body.parameters?.retry_after;
      throw new RetriableRequestError(
        message,
        typeof retryAfterSeconds === "number" && retryAfterSeconds >= 0
          ? retryAfterSeconds * 1_000
          : undefined
      );
    }
    throw new Error(message);
  }
  return body as T;
}

async function forwardUpdate(update: Record<string, unknown>) {
  let response: Response;
  try {
    response = await fetch(`${apiUrl}/v1/inbound/telegram`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(update)
    });
  } catch (error) {
    throw new RetriableRequestError(
      `RyanOS inbound request failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const body = (await response.json().catch(() => ({}))) as unknown;
  if (!response.ok) {
    const message = `RyanOS inbound returned HTTP ${response.status}: ${JSON.stringify(body)}`;
    if (retryableStatus(response.status)) throw new RetriableRequestError(message);
    throw new Error(message);
  }
  return body;
}

function extractTelegramChatId(update: Record<string, unknown>): string | undefined {
  for (const key of ["message", "edited_message", "channel_post"]) {
    const candidate = update[key];
    if (!candidate || typeof candidate !== "object") continue;
    const chat = (candidate as Record<string, unknown>).chat;
    if (!chat || typeof chat !== "object") continue;
    const chatId = (chat as Record<string, unknown>).id;
    if (typeof chatId === "string" || typeof chatId === "number") {
      return String(chatId);
    }
  }
  return undefined;
}

async function sendTypingAction(token: string, chatId: string): Promise<void> {
  try {
    await telegramApi(token, "sendChatAction", {
      chat_id: chatId,
      action: "typing"
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        status: "typing_action_failed",
        chatId,
        error: err instanceof Error ? err.message : String(err)
      })
    );
  }
}

async function forwardUpdateWithTyping(token: string, update: Record<string, unknown>) {
  const chatId = sendTyping ? extractTelegramChatId(update) : undefined;
  if (!chatId) return forwardUpdate(update);

  void sendTypingAction(token, chatId);
  const interval = setInterval(() => {
    void sendTypingAction(token, chatId);
  }, typingIntervalMs);
  try {
    return await forwardUpdate(update);
  } finally {
    clearInterval(interval);
  }
}

async function main() {
  const database = createDb();
  try {
    const tokenResolution = await resolveTelegramBotToken({ db: database.db });
    if (!tokenResolution.token) {
      throw new Error(
        `Telegram token is not available. ${tokenResolution.warnings.join(" ")}`
      );
    }

    const bot = await withRetry("telegram.getMe", () =>
      telegramApi<TelegramGetMeResponse>(tokenResolution.token!, "getMe", {})
    );
    const username = bot.result?.username;
    console.log(
      username
        ? `RyanOS Telegram poller connected to @${username}. Open https://t.me/${username} and send /start.`
        : "RyanOS Telegram poller connected. Open your bot in Telegram and send /start."
    );

    await withRetry("telegram.deleteWebhook", () =>
      telegramApi(tokenResolution.token!, "deleteWebhook", {
        drop_pending_updates: false
      })
    );

    let offset = Number(process.env.TELEGRAM_POLL_OFFSET ?? "0") || undefined;
    while (!shuttingDown) {
      const body = await withRetry("telegram.getUpdates", () =>
        telegramApi<TelegramPollResponse>(tokenResolution.token!, "getUpdates", {
          ...(offset === undefined ? {} : { offset }),
          timeout: pollTimeoutSeconds,
          limit: pollLimit,
          allowed_updates: ["message", "edited_message", "channel_post"]
        })
      );

      for (const update of body.result ?? []) {
        try {
          const result = await withRetry(`ryanos.forwardUpdate.${update.update_id}`, () =>
            forwardUpdateWithTyping(tokenResolution.token!, update)
          );
          console.log(
            JSON.stringify(
              {
                status: "forwarded",
                updateId: update.update_id,
                result
              },
              null,
              2
            )
          );
        } catch (error) {
          if (error instanceof PollingStoppedError) throw error;
          console.error(
            JSON.stringify(
              {
                status: "permanent_delivery_failure",
                updateId: update.update_id,
                error: error instanceof Error ? error.message : String(error)
              },
              null,
              2
            )
          );
        }
        offset = update.update_id + 1;
      }
    }
  } finally {
    await database.pool.end();
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  main().catch((error) => {
    if (error instanceof PollingStoppedError) return;
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
