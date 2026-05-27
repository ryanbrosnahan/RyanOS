#!/usr/bin/env node
import { createDb } from "@ryanos/db";
import { resolveTelegramBotToken } from "./telegram-credentials.js";

type TelegramPollResponse = {
  ok?: boolean;
  description?: string;
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

let shuttingDown = false;

process.once("SIGINT", () => {
  shuttingDown = true;
});
process.once("SIGTERM", () => {
  shuttingDown = true;
});

async function telegramApi<T>(
  token: string,
  method: string,
  payload: Record<string, unknown>
): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const body = (await response.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  if (!response.ok || body.ok !== true) {
    throw new Error(
      `Telegram ${method} failed with HTTP ${response.status}: ${
        body.description ?? response.statusText
      }`
    );
  }
  return body as T;
}

async function forwardUpdate(update: Record<string, unknown>) {
  const response = await fetch(`${apiUrl}/v1/inbound/telegram`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(update)
  });
  const body = (await response.json().catch(() => ({}))) as unknown;
  if (!response.ok) {
    throw new Error(`RyanOS inbound returned HTTP ${response.status}: ${JSON.stringify(body)}`);
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

    const bot = await telegramApi<TelegramGetMeResponse>(tokenResolution.token, "getMe", {});
    const username = bot.result?.username;
    console.log(
      username
        ? `RyanOS Telegram poller connected to @${username}. Open https://t.me/${username} and send /start.`
        : "RyanOS Telegram poller connected. Open your bot in Telegram and send /start."
    );

    await telegramApi(tokenResolution.token, "deleteWebhook", {
      drop_pending_updates: false
    });

    let offset = Number(process.env.TELEGRAM_POLL_OFFSET ?? "0") || undefined;
    while (!shuttingDown) {
      const body = await telegramApi<TelegramPollResponse>(tokenResolution.token, "getUpdates", {
        ...(offset === undefined ? {} : { offset }),
        timeout: pollTimeoutSeconds,
        limit: pollLimit,
        allowed_updates: ["message", "edited_message", "channel_post"]
      });

      for (const update of body.result ?? []) {
        try {
          const result = await forwardUpdateWithTyping(tokenResolution.token, update);
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
        } catch (err) {
          console.error(
            JSON.stringify(
              {
                status: "failed",
                updateId: update.update_id,
                error: err instanceof Error ? err.message : String(err)
              },
              null,
              2
            )
          );
        } finally {
          offset = update.update_id + 1;
        }
      }
    }
  } finally {
    await database.pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
