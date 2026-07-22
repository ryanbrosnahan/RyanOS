import { describe, expect, it } from "vitest";
import {
  signInternalEmailScanRequest,
  verifyInternalEmailScanRequest
} from "../src/internal-email-auth.js";

describe("internal email scan authentication", () => {
  const masterKey = Buffer.alloc(32, 7);
  const body = JSON.stringify({ syncAccounts: false });

  it("accepts a valid purpose-derived signature", () => {
    const signed = signInternalEmailScanRequest(masterKey, body, "1784758000000");
    expect(verifyInternalEmailScanRequest({
      masterKey,
      body,
      timestamp: signed.timestamp,
      signature: signed.signature,
      now: 1784758000000
    })).toBe(true);
  });

  it("rejects unsigned, tampered, and expired requests", () => {
    const signed = signInternalEmailScanRequest(masterKey, body, "1784758000000");
    expect(verifyInternalEmailScanRequest({
      masterKey,
      body: JSON.stringify({ syncAccounts: true }),
      timestamp: signed.timestamp,
      signature: signed.signature,
      now: 1784758000000
    })).toBe(false);
    expect(verifyInternalEmailScanRequest({
      masterKey,
      body,
      timestamp: signed.timestamp,
      signature: signed.signature,
      now: 1784759000000
    })).toBe(false);
    expect(verifyInternalEmailScanRequest({
      masterKey,
      body,
      timestamp: undefined,
      signature: undefined
    })).toBe(false);
  });
});
