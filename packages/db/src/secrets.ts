import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { UUID } from "@ryanos/shared";
import { resolveUserId, type RyanDb } from "./identity.js";
import * as schema from "./schema.js";

export const secretAlgorithm = "aes-256-gcm";
const secretAad = Buffer.from("ryanos-secret:v1", "utf8");
const defaultMasterKeyVersion = "local-v1";

export type SecretSetupAction = {
  id: string;
  title: string;
  blocking: boolean;
  instructions: string[];
  command?: string;
  docs?: string[];
};

export type SecretVaultStatus = {
  configured: boolean;
  ready: boolean;
  setupRequired: boolean;
  setupActions: SecretSetupAction[];
  warnings: string[];
  source?: string;
};

export type SecretVault = {
  key: Buffer;
  keyVersion: string;
  source: string;
};

export type LoadedSecretVault = {
  status: SecretVaultStatus;
  vault?: SecretVault;
};

export type EncryptedSecret = {
  ciphertext: string;
  nonce: string;
  keyVersion: string;
  metadata: Record<string, unknown>;
};

export type ProviderSecretStatus = {
  exists: boolean;
  decryptable?: boolean;
  providerAccountId?: UUID;
  secretRecordId?: UUID;
  keyVersion?: string;
  error?: string;
};

export type ProviderSecretInput = {
  userId: UUID;
  provider: string;
  externalAccountId: string;
  kind: string;
};

export type StoreProviderSecretInput = ProviderSecretInput & {
  plaintext: string;
  accountDisplayName?: string;
  metadata?: Record<string, unknown>;
};

export function decodeMasterKey(raw: string): Buffer {
  const value = raw.trim();
  if (!value) throw new Error("RyanOS master key is empty.");

  const prefixed = value.match(/^(base64url|base64|hex):(.+)$/);
  const candidates = prefixed
    ? [{ encoding: prefixed[1] as BufferEncoding, value: prefixed[2] ?? "" }]
    : /^[0-9a-f]{64}$/i.test(value)
      ? [{ encoding: "hex" as BufferEncoding, value }]
      : [
          { encoding: "base64url" as BufferEncoding, value },
          { encoding: "base64" as BufferEncoding, value }
        ];

  for (const candidate of candidates) {
    try {
      const key = Buffer.from(candidate.value, candidate.encoding);
      if (key.length === 32) return key;
    } catch {
      // Try the next supported encoding.
    }
  }

  throw new Error(
    "RyanOS master key must decode to exactly 32 bytes. Generate one with `pnpm secrets:generate-key`."
  );
}

export async function loadSecretVaultFromEnv(
  env: NodeJS.ProcessEnv = process.env
): Promise<LoadedSecretVault> {
  const envKey = env.RYANOS_MASTER_KEY?.trim();
  const keyVersion = env.RYANOS_MASTER_KEY_VERSION?.trim() || defaultMasterKeyVersion;

  if (envKey) {
    try {
      return {
        status: {
          configured: true,
          ready: true,
          setupRequired: false,
          setupActions: [],
          warnings: [
            "`RYANOS_MASTER_KEY` is set directly; prefer `RYANOS_MASTER_KEY_FILE` for local Docker deployments."
          ],
          source: "env:RYANOS_MASTER_KEY"
        },
        vault: {
          key: decodeMasterKey(envKey),
          keyVersion,
          source: "env:RYANOS_MASTER_KEY"
        }
      };
    } catch (err) {
      return failedMasterKeyStatus("env:RYANOS_MASTER_KEY", err);
    }
  }

  const keyFile = env.RYANOS_MASTER_KEY_FILE?.trim() || "./secrets/master-key";
  try {
    const rawKey = await readFile(keyFile, "utf8");
    return {
      status: {
        configured: true,
        ready: true,
        setupRequired: false,
        setupActions: [],
        warnings: [],
        source: keyFile
      },
      vault: {
        key: decodeMasterKey(rawKey),
        keyVersion,
        source: keyFile
      }
    };
  } catch (err) {
    const code = typeof err === "object" && err !== null && "code" in err ? String(err.code) : "";
    if (code === "ENOENT") {
      return {
        status: {
          configured: false,
          ready: false,
          setupRequired: true,
          setupActions: [masterKeySetupAction()],
          warnings: [`Master key file not found at ${keyFile}.`],
          source: keyFile
        }
      };
    }
    return failedMasterKeyStatus(keyFile, err);
  }
}

export function encryptSecret(plaintext: string, vault: SecretVault): EncryptedSecret {
  const nonce = randomBytes(12);
  const cipher = createCipheriv(secretAlgorithm, vault.key, nonce);
  cipher.setAAD(secretAad);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([encrypted, authTag]).toString("base64url"),
    nonce: nonce.toString("base64url"),
    keyVersion: vault.keyVersion,
    metadata: {
      algorithm: secretAlgorithm,
      authTag: "appended"
    }
  };
}

export function decryptSecret(record: {
  ciphertext: string;
  nonce: string;
  keyVersion: string;
}, vault: SecretVault): string {
  if (record.keyVersion !== vault.keyVersion) {
    throw new Error(
      `Secret was encrypted with key version ${record.keyVersion}, but loaded key is ${vault.keyVersion}.`
    );
  }
  const payload = Buffer.from(record.ciphertext, "base64url");
  if (payload.length <= 16) throw new Error("Encrypted secret payload is too short.");
  const encrypted = payload.subarray(0, payload.length - 16);
  const authTag = payload.subarray(payload.length - 16);
  const decipher = createDecipheriv(secretAlgorithm, vault.key, Buffer.from(record.nonce, "base64url"));
  decipher.setAAD(secretAad);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export class PostgresSecretStore {
  constructor(
    private readonly db: RyanDb,
    private readonly vault?: SecretVault
  ) {}

  async getProviderSecretStatus(input: ProviderSecretInput): Promise<ProviderSecretStatus> {
    const found = await this.findLatestProviderSecret(input);
    if (!found.account) return { exists: false };
    if (!found.record) {
      return {
        exists: false,
        providerAccountId: found.account.id
      };
    }

    const status: ProviderSecretStatus = {
      exists: true,
      providerAccountId: found.account.id,
      secretRecordId: found.record.id,
      keyVersion: found.record.keyVersion
    };
    if (!this.vault) return status;

    try {
      decryptSecret(found.record, this.vault);
      return {
        ...status,
        decryptable: true
      };
    } catch (err) {
      return {
        ...status,
        decryptable: false,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }

  async storeProviderSecret(input: StoreProviderSecretInput): Promise<ProviderSecretStatus> {
    const vault = this.requireVault();
    const userId = await resolveUserId(this.db, input.userId);
    const [account] = await this.db
      .insert(schema.providerAccounts)
      .values({
        userId,
        provider: input.provider,
        externalAccountId: input.externalAccountId,
        displayName: input.accountDisplayName,
        status: "active",
        metadata: {
          credentialStorage: "encrypted-db"
        }
      })
      .onConflictDoUpdate({
        target: [schema.providerAccounts.provider, schema.providerAccounts.externalAccountId],
        set: {
          userId,
          displayName: input.accountDisplayName,
          status: "active",
          updatedAt: new Date(),
          deletedAt: null,
          metadata: {
            credentialStorage: "encrypted-db"
          }
        }
      })
      .returning();

    if (!account) throw new Error("Failed to upsert provider account.");

    const encrypted = encryptSecret(input.plaintext, vault);
    const [record] = await this.db
      .insert(schema.secretRecords)
      .values({
        userId,
        providerAccountId: account.id,
        kind: input.kind,
        ciphertext: encrypted.ciphertext,
        nonce: encrypted.nonce,
        keyVersion: encrypted.keyVersion,
        metadata: {
          ...encrypted.metadata,
          ...(input.metadata ?? {})
        }
      })
      .returning();

    if (!record) throw new Error("Failed to store encrypted secret.");

    return {
      exists: true,
      decryptable: true,
      providerAccountId: account.id,
      secretRecordId: record.id,
      keyVersion: record.keyVersion
    };
  }

  async readProviderSecret(input: ProviderSecretInput): Promise<string | undefined> {
    const vault = this.requireVault();
    const found = await this.findLatestProviderSecret(input);
    if (!found.record) return undefined;
    return decryptSecret(found.record, vault);
  }

  private requireVault(): SecretVault {
    if (!this.vault) throw new Error("Secret vault is not configured.");
    return this.vault;
  }

  private async findLatestProviderSecret(input: ProviderSecretInput) {
    const userId = await resolveUserId(this.db, input.userId);
    const account = await this.db.query.providerAccounts.findFirst({
      where: and(
        eq(schema.providerAccounts.userId, userId),
        eq(schema.providerAccounts.provider, input.provider),
        eq(schema.providerAccounts.externalAccountId, input.externalAccountId),
        isNull(schema.providerAccounts.deletedAt)
      )
    });

    if (!account) return {};

    const record = await this.db.query.secretRecords.findFirst({
      where: and(
        eq(schema.secretRecords.userId, userId),
        eq(schema.secretRecords.providerAccountId, account.id),
        eq(schema.secretRecords.kind, input.kind)
      ),
      orderBy: [desc(schema.secretRecords.createdAt)]
    });

    return { account, record };
  }
}

function masterKeySetupAction(): SecretSetupAction {
  return {
    id: "master-key-file",
    title: "Generate local RyanOS master key",
    blocking: true,
    instructions: [
      "Generate a local master key before importing integration secrets.",
      "Keep `secrets/` out of git and back this key up separately from the database."
    ],
    command: "pnpm secrets:generate-key"
  };
}

function failedMasterKeyStatus(source: string, err: unknown): LoadedSecretVault {
  return {
    status: {
      configured: true,
      ready: false,
      setupRequired: true,
      setupActions: [masterKeySetupAction()],
      warnings: [
        `Could not load RyanOS master key from ${source}: ${
          err instanceof Error ? err.message : String(err)
        }`
      ],
      source
    }
  };
}
