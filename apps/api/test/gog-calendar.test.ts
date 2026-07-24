import { describe, expect, it } from "vitest";
import { GogCalendarClient, type GogCalendarClientOptions } from "../src/gog-calendar.js";

type Runner = NonNullable<GogCalendarClientOptions["runner"]>;

describe("GogCalendarClient", () => {
  it("keeps Gmail read-only when authorizing a combined account", async () => {
    const calls: string[][] = [];
    const runner: Runner = async (args) => {
      calls.push(args);
      return {
        exitCode: 0,
        stderr: "",
        stdout: JSON.stringify({ authUrl: "https://accounts.google.com/o/oauth2/auth?client_id=test" })
      };
    };
    const client = new GogCalendarClient({ runner });

    await client.startRemoteAuth({ email: "ryan@example.com", includeGmail: true });

    expect(calls[0]).toEqual([
      "auth",
      "add",
      "ryan@example.com",
      "--services",
      "gmail,calendar",
      "--gmail-scope",
      "readonly",
      "--gmail-no-send",
      "--force-consent",
      "--remote",
      "--step",
      "1",
      "--json"
    ]);
  });

  it("creates owned events without sending attendee updates", async () => {
    const calls: string[][] = [];
    const runner: Runner = async (args) => {
      calls.push(args);
      return {
        exitCode: 0,
        stderr: "",
        stdout: JSON.stringify({
          id: "event-1",
          summary: "Deep work",
          start: { dateTime: "2026-07-24T15:00:00.000Z" },
          end: { dateTime: "2026-07-24T16:00:00.000Z" },
          status: "confirmed"
        })
      };
    };
    const client = new GogCalendarClient({ runner });

    await client.createEvent({
      accountEmail: "ryan@example.com",
      externalCalendarId: "primary",
      title: "Deep work",
      startAt: "2026-07-24T15:00:00.000Z",
      endAt: "2026-07-24T16:00:00.000Z",
      timezone: "America/Chicago",
      privateProperties: {
        ryanosOwned: "true",
        ryanosBlockId: "block-1"
      }
    });

    expect(calls[0]).toContain("--gmail-no-send");
    expect(calls[0]).toContain("--enable-commands");
    expect(calls[0]).toContain("--send-updates");
    expect(calls[0]?.[calls[0].indexOf("--send-updates") + 1]).toBe("none");
    expect(calls[0]).toContain("ryanosOwned=true");
    expect(calls[0]).toContain("ryanosBlockId=block-1");
  });

  it("parses calendar catalogs and event ownership metadata", async () => {
    const runner: Runner = async (args) => {
      if (args.includes("calendars")) {
        return {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({
            calendars: [{
              id: "primary",
              summary: "Ryan",
              accessRole: "owner",
              primary: true,
              timeZone: "America/Chicago"
            }]
          })
        };
      }
      return {
        exitCode: 0,
        stderr: "",
        stdout: JSON.stringify({
          events: [{
            id: "event-1",
            summary: "Focus",
            start: { dateTime: "2026-07-24T15:00:00.000Z" },
            end: { dateTime: "2026-07-24T16:00:00.000Z" },
            extendedProperties: {
              private: { ryanosOwned: "true" }
            }
          }]
        })
      };
    };
    const client = new GogCalendarClient({ runner });

    const calendars = await client.listCalendars("ryan@example.com");
    const events = await client.listEvents({
      accountEmail: "ryan@example.com",
      externalCalendarId: "primary",
      from: "2026-07-24T00:00:00.000Z",
      to: "2026-07-25T00:00:00.000Z"
    });

    expect(calendars[0]).toMatchObject({
      id: "primary",
      name: "Ryan",
      accessRole: "owner",
      primary: true
    });
    expect(events[0]?.privateProperties).toEqual({ ryanosOwned: "true" });
  });
});
