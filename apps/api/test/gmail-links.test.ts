import { describe, expect, it } from "vitest";
import { gmailThreadUrl, normalizeGmailLinksInText, normalizeGmailUrl } from "../src/gmail-links.js";

describe("Gmail task links", () => {
  it("selects the mailbox by query and opens threads outside the inbox too", () => {
    const url = new URL(gmailThreadUrl("19abc123", "ryan+work@example.com"));
    expect(url.pathname).toBe("/mail/u/0/");
    expect(url.searchParams.get("authuser")).toBe("ryan+work@example.com");
    expect(url.hash).toBe("#all/19abc123");
    expect(gmailThreadUrl("19abc123")).toBe("https://mail.google.com/mail/u/0/#all/19abc123");
  });

  it.each(["ryan%40example.com", "ryan@example.com"])("repairs stored mailbox path %s", (mailbox) => {
    const url = new URL(normalizeGmailUrl(`https://mail.google.com/mail/u/${mailbox}/#inbox/19abc123`));
    expect(url.pathname).toBe("/mail/u/0/");
    expect(url.searchParams.get("authuser")).toBe("ryan@example.com");
    expect(url.hash).toBe("#all/19abc123");
  });

  it("repairs existing task bodies while preserving surrounding Markdown", () => {
    const body = "Do the thing.\n\n[Open email](https://mail.google.com/mail/u/ryan%40example.com/#inbox/19abc123)\n\nWhy: requested";
    expect(normalizeGmailLinksInText(body)).toBe(
      "Do the thing.\n\n[Open email](https://mail.google.com/mail/u/0/?authuser=ryan%40example.com#all/19abc123)\n\nWhy: requested"
    );
  });

  it("leaves other links and malformed URLs unchanged", () => {
    for (const value of ["not a URL", "https://example.com/mail/u/ryan%40example.com/#inbox/123", "https://mail.google.com/mail/u/%broken/#inbox/123", "https://mail.google.com/mail/u/1/#inbox/123", gmailThreadUrl("123", "ryan@example.com")]) {
      expect(normalizeGmailUrl(value)).toBe(value);
    }
  });
});
