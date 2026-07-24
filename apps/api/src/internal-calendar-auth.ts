import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const internalCalendarSyncPath = "/v1/internal/calendar/sync-due";
const internalCalendarPurpose = "ryanos:internal-calendar-sync:v1";
const maximumClockSkewMs = 5 * 60_000;

function derivedKey(masterKey: Buffer): Buffer {
  return createHmac("sha256", masterKey).update(internalCalendarPurpose).digest();
}

function signedValue(timestamp: string, body: string): string {
  const bodyHash = createHash("sha256").update(body).digest("hex");
  return `${timestamp}\nPOST\n${internalCalendarSyncPath}\n${bodyHash}`;
}

export function signInternalCalendarSyncRequest(
  masterKey: Buffer,
  body: string,
  timestamp = String(Date.now())
): { timestamp: string; signature: string } {
  return {
    timestamp,
    signature: createHmac("sha256", derivedKey(masterKey))
      .update(signedValue(timestamp, body))
      .digest("hex")
  };
}

export function verifyInternalCalendarSyncRequest(input: {
  masterKey: Buffer;
  body: string;
  timestamp: string | undefined;
  signature: string | undefined;
  now?: number;
}): boolean {
  if (!input.timestamp || !input.signature || !/^[a-f0-9]{64}$/i.test(input.signature)) return false;
  const timestampMs = Number(input.timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs((input.now ?? Date.now()) - timestampMs) > maximumClockSkewMs) {
    return false;
  }
  const expected = signInternalCalendarSyncRequest(input.masterKey, input.body, input.timestamp).signature;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(input.signature, "hex"));
}
