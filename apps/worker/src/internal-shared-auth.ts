import { createHash, createHmac } from "node:crypto";

export const internalSharedCapturePath = "/v1/internal/shared/capture";
const internalSharedPurpose = "ryanos:internal-shared-capture:v1";

export function signInternalSharedCaptureRequest(masterKey: Buffer, body: string): {
  timestamp: string;
  signature: string;
} {
  const timestamp = String(Date.now());
  const derivedKey = createHmac("sha256", masterKey).update(internalSharedPurpose).digest();
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const value = `${timestamp}\nPOST\n${internalSharedCapturePath}\n${bodyHash}`;
  return {
    timestamp,
    signature: createHmac("sha256", derivedKey).update(value).digest("hex")
  };
}
