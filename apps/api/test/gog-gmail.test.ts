import { describe, expect, it } from "vitest";
import { GogGmailClient, type GogRunner } from "../src/gog-gmail.js";

describe("GogGmailClient", () => {
  it("constructs Gmail search and get commands with no-send guard", async () => {
    const calls: string[][] = [];
    const runner: GogRunner = async (args) => {
      calls.push(args);
      if (args.includes("search")) {
        return {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({
            messages: [
              {
                id: "msg-1",
                threadId: "thread-1",
                subject: "Court filing",
                from: "sender@example.com"
              }
            ]
          })
        };
      }
      return {
        exitCode: 0,
        stderr: "",
        stdout: JSON.stringify({
          id: "msg-1",
          headers: {
            Subject: "Court filing",
            From: "sender@example.com",
            To: "ryan@example.com"
          },
          text: "Please review this filing."
        })
      };
    };
    const client = new GogGmailClient({ runner });

    const messages = await client.searchMessages({
      accountEmail: "ryan@example.com",
      query: "in:inbox is:unread newer_than:7d",
      max: 25
    });
    const message = await client.getMessage({
      accountEmail: "ryan@example.com",
      messageId: "msg-1"
    });

    expect(calls[0]).toEqual([
      "--gmail-no-send",
      "--account",
      "ryan@example.com",
      "gmail",
      "search",
      "in:inbox is:unread newer_than:7d",
      "--max",
      "25",
      "--json"
    ]);
    expect(calls[1]).toEqual([
      "--gmail-no-send",
      "--account",
      "ryan@example.com",
      "gmail",
      "get",
      "msg-1",
      "--sanitize-content",
      "--json"
    ]);
    expect(messages).toEqual([
      expect.objectContaining({
        id: "msg-1",
        subject: "Court filing"
      })
    ]);
    expect(message).toMatchObject({
      id: "msg-1",
      subject: "Court filing",
      from: "sender@example.com",
      to: "ryan@example.com",
      bodyText: "Please review this filing."
    });
  });

  it("parses account lists from gog auth JSON", async () => {
    const runner: GogRunner = async () => ({
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({
        accounts: [
          {
            email: "one@example.com",
            displayName: "One",
            services: ["gmail"]
          },
          "two@example.com"
        ]
      })
    });
    const client = new GogGmailClient({ runner });

    await expect(client.listAccounts()).resolves.toEqual([
      expect.objectContaining({
        email: "one@example.com",
        displayName: "One",
        scopes: ["gmail"]
      }),
      expect.objectContaining({
        email: "two@example.com",
        scopes: ["gmail"]
      })
    ]);
  });
});
