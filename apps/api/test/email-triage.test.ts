import { describe, expect, it } from "vitest";
import { latestInboundMessage, shouldTriageEmailMessage } from "../src/email-triage.js";

describe("email triage message selection", () => {
  it("classifies the latest inbound reply rather than the first thread message or latest self reply", () => {
    const selected = latestInboundMessage({
      id: "thread-1",
      raw: {},
      messages: [
        {
          id: "old-inbound",
          from: "sender@example.com",
          date: "2026-07-20T12:00:00.000Z",
          bodyText: "Original request",
          raw: {}
        },
        {
          id: "new-inbound",
          from: "sender@example.com",
          date: "2026-07-21T12:00:00.000Z",
          bodyText: "New information",
          raw: {}
        },
        {
          id: "self-reply",
          from: "Ryan <ryan@example.com>",
          date: "2026-07-22T12:00:00.000Z",
          bodyText: "Thanks",
          raw: {}
        }
      ]
    }, "ryan@example.com");

    expect(selected?.id).toBe("new-inbound");
  });

  it("does not hard-filter automated or bulk senders", () => {
    expect(shouldTriageEmailMessage({
      id: "message-1",
      from: "DocuSign <no-reply@docusign.net>",
      subject: "Signature required",
      bodyText: "Please sign by Friday. Unsubscribe from marketing email.",
      raw: {
        headers: [{ name: "Precedence", value: "bulk" }]
      }
    })).toEqual({ shouldTriage: true });
  });
});
