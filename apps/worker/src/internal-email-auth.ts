import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";

export const internalEmailScanPath = "/v1/internal/email/scan-due";
const internalEmailPurpose = "ryanos:internal-email-scan:v1";

function decodeMasterKey(raw: string): Buffer {
  const value = raw.trim();
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
  throw new Error("RyanOS master key must decode to exactly 32 bytes.");
}

export async function loadInternalEmailMasterKey(env: NodeJS.ProcessEnv = process.env): Promise<Buffer> {
  const inline = env.RYANOS_MASTER_KEY?.trim();
  if (inline) return decodeMasterKey(inline);
  const path = env.RYANOS_MASTER_KEY_FILE?.trim() || "./secrets/master-key";
  return decodeMasterKey(await readFile(path, "utf8"));
}

export function signInternalEmailScanRequest(masterKey: Buffer, body: string): {
  timestamp: string;
  signature: string;
} {
  const timestamp = String(Date.now());
  const derivedKey = createHmac("sha256", masterKey).update(internalEmailPurpose).digest();
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const value = `${timestamp}\nPOST\n${internalEmailScanPath}\n${bodyHash}`;
  return {
    timestamp,
    signature: createHmac("sha256", derivedKey).update(value).digest("hex")
  };
}
