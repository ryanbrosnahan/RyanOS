import {
  loadSecretVaultFromEnv,
  PostgresSecretStore,
  type RyanDb
} from "@ryanos/db";

export type TelegramBotTokenResolution = {
  token?: string;
  source?: "encrypted-db" | "env";
  warnings: string[];
};

export async function resolveTelegramBotToken(input: {
  db?: RyanDb;
}): Promise<TelegramBotTokenResolution> {
  const warnings: string[] = [];

  if (input.db) {
    const loadedVault = await loadSecretVaultFromEnv();
    if (loadedVault.vault) {
      try {
        const token = await new PostgresSecretStore(input.db, loadedVault.vault).readProviderSecret({
          userId: "local-owner",
          provider: "telegram",
          externalAccountId: "bot",
          kind: "bot_token"
        });
        if (token) {
          return {
            token,
            source: "encrypted-db",
            warnings
          };
        }
      } catch (err) {
        warnings.push(
          `Could not read encrypted Telegram token: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    } else {
      warnings.push(...loadedVault.status.warnings);
    }
  }

  const envToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (envToken) {
    return {
      token: envToken,
      source: "env",
      warnings
    };
  }

  return { warnings };
}
