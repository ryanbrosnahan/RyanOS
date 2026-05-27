import { describe, expect, it } from "vitest";
import { decodeMasterKey, decryptSecret, encryptSecret } from "@ryanos/db";

describe("secret encryption", () => {
  it("round-trips encrypted secret payloads with the configured key version", () => {
    const vault = {
      key: decodeMasterKey(Buffer.alloc(32, 7).toString("base64url")),
      keyVersion: "test-v1",
      source: "test"
    };

    const encrypted = encryptSecret("telegram-token", vault);

    expect(encrypted.keyVersion).toBe("test-v1");
    expect(encrypted.ciphertext).not.toContain("telegram-token");
    expect(decryptSecret(encrypted, vault)).toBe("telegram-token");
  });

  it("rejects secrets encrypted with a different key version", () => {
    const vault = {
      key: decodeMasterKey(Buffer.alloc(32, 7).toString("base64url")),
      keyVersion: "test-v1",
      source: "test"
    };
    const encrypted = encryptSecret("telegram-token", vault);

    expect(() =>
      decryptSecret(
        {
          ...encrypted,
          keyVersion: "other"
        },
        vault
      )
    ).toThrow(/other/);
  });
});
