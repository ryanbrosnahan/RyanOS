#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { stdin } from "node:process";
import { createDb, loadSecretVaultFromEnv, PostgresSecretStore } from "@ryanos/db";

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readToken(): Promise<{ token: string; source: string }> {
  const file = argValue("--file") ?? process.env.RYANOS_TELEGRAM_BOT_TOKEN_FILE;
  if (file) {
    return {
      token: await readFile(file, "utf8"),
      source: file
    };
  }

  if (process.argv.includes("--stdin") || !stdin.isTTY) {
    return {
      token: await readStdin(),
      source: "stdin"
    };
  }

  if (process.env.TELEGRAM_BOT_TOKEN?.trim()) {
    return {
      token: process.env.TELEGRAM_BOT_TOKEN,
      source: "env:TELEGRAM_BOT_TOKEN"
    };
  }

  throw new Error(
    "No Telegram token provided. Use `--file /app/secrets/telegram-bot-token` or pipe the token with `--stdin`."
  );
}

function validateTelegramBotToken(token: string): string {
  const trimmed = token.trim();
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(trimmed)) {
    throw new Error("Telegram bot token does not match the expected bot-token shape.");
  }
  return trimmed;
}

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is required to import Telegram credentials.");
  }

  const loadedVault = await loadSecretVaultFromEnv();
  if (!loadedVault.vault) {
    throw new Error(
      `RyanOS master key is not ready: ${loadedVault.status.warnings.join(" ")}`
    );
  }

  const { token, source } = await readToken();
  const database = createDb();
  try {
    const secretStore = new PostgresSecretStore(database.db, loadedVault.vault);
    const result = await secretStore.storeProviderSecret({
      userId: "local-owner",
      provider: "telegram",
      externalAccountId: "bot",
      accountDisplayName: "Telegram Bot",
      kind: "bot_token",
      plaintext: validateTelegramBotToken(token),
      metadata: {
        importedBy: "telegram-token-cli",
        importedFrom: source,
        importedAt: new Date().toISOString()
      }
    });

    console.log(
      JSON.stringify(
        {
          status: "stored",
          provider: "telegram",
          kind: "bot_token",
          providerAccountId: result.providerAccountId,
          secretRecordId: result.secretRecordId,
          keyVersion: result.keyVersion
        },
        null,
        2
      )
    );
  } finally {
    await database.pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
