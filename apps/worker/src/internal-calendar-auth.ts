import { createHash, createHmac } from "node:crypto";

export const internalCalendarSyncPath = "/v1/internal/calendar/sync-due";
const internalCalendarPurpose = "ryanos:internal-calendar-sync:v1";

export function signInternalCalendarSyncRequest(masterKey: Buffer, body: string): {
  timestamp: string;
  signature: string;
} {
  const timestamp = String(Date.now());
  const derivedKey = createHmac("sha256", masterKey).update(internalCalendarPurpose).digest();
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const value = `${timestamp}\nPOST\n${internalCalendarSyncPath}\n${bodyHash}`;
  return {
    timestamp,
    signature: createHmac("sha256", derivedKey).update(value).digest("hex")
  };
}
