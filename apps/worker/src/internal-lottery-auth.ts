import { createHash, createHmac } from "node:crypto";

export const internalLotteryCheckPath = "/v1/internal/lottery/check-due";
const internalLotteryPurpose = "ryanos:internal-lottery-check:v1";

export function signInternalLotteryCheckRequest(masterKey: Buffer, body: string): {
  timestamp: string;
  signature: string;
} {
  const timestamp = String(Date.now());
  const derivedKey = createHmac("sha256", masterKey).update(internalLotteryPurpose).digest();
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const value = `${timestamp}\nPOST\n${internalLotteryCheckPath}\n${bodyHash}`;
  return {
    timestamp,
    signature: createHmac("sha256", derivedKey).update(value).digest("hex")
  };
}
