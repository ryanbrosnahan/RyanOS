import { describe, expect, it } from "vitest";
import {
  signInternalCalendarSyncRequest,
  verifyInternalCalendarSyncRequest
} from "../src/internal-calendar-auth.js";

describe("internal calendar sync authentication", () => {
  const masterKey = Buffer.alloc(32, 11);
  const body = JSON.stringify({ refreshCatalog: false });

  it("accepts a valid purpose-derived signature", () => {
    const signed = signInternalCalendarSyncRequest(masterKey, body, "1784916000000");
    expect(verifyInternalCalendarSyncRequest({
      masterKey,
      body,
      timestamp: signed.timestamp,
      signature: signed.signature,
      now: 1784916000000
    })).toBe(true);
  });

  it("rejects missing, expired, and body-mismatched signatures", () => {
    const signed = signInternalCalendarSyncRequest(masterKey, body, "1784916000000");
    expect(verifyInternalCalendarSyncRequest({
      masterKey,
      body: JSON.stringify({ refreshCatalog: true }),
      timestamp: signed.timestamp,
      signature: signed.signature,
      now: 1784916000000
    })).toBe(false);
    expect(verifyInternalCalendarSyncRequest({
      masterKey,
      body,
      timestamp: signed.timestamp,
      signature: signed.signature,
      now: 1784917000000
    })).toBe(false);
    expect(verifyInternalCalendarSyncRequest({
      masterKey,
      body,
      timestamp: undefined,
      signature: undefined
    })).toBe(false);
  });
});
