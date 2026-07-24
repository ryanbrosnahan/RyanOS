import { spawn } from "node:child_process";
import type { GogCommandResult, GogRunner } from "./gog-gmail.js";

export type GogCalendarAccount = {
  email: string;
  externalAccountId: string;
  displayName?: string;
  scopes: string[];
  status: string;
  raw: unknown;
};

export type GogCalendarListEntry = {
  id: string;
  name: string;
  timezone?: string;
  accessRole: string;
  backgroundColor?: string;
  primary: boolean;
  raw: unknown;
};

export type GogCalendarEvent = {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  transparency: "opaque" | "transparent";
  status: string;
  iCalUid?: string;
  location?: string;
  htmlLink?: string;
  recurringEventId?: string;
  etag?: string;
  privateProperties: Record<string, string>;
  description?: string;
  attendees?: Array<{ email: string; displayName?: string; responseStatus?: string }>;
  raw: unknown;
};

export type GogCalendarClientOptions = {
  command?: string;
  runner?: GogRunner;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
};

export type CalendarEventWriteInput = {
  accountEmail: string;
  externalCalendarId: string;
  title: string;
  startAt: string;
  endAt: string;
  timezone: string;
  description?: string;
  location?: string;
  transparency?: "opaque" | "transparent";
  privateProperties?: Record<string, string>;
};

function defaultRunner(
  args: string[],
  options: { command: string; env: NodeJS.ProcessEnv; timeoutMs: number }
): Promise<GogCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.command, args, {
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`gog command timed out after ${options.timeoutMs}ms: ${args.join(" ")}`));
    }, options.timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: exitCode ?? 1 });
    });
  });
}

function parseJson(stdout: string, command: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    throw new Error(
      `gog ${command} returned non-JSON output: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function ensureSuccess(result: GogCommandResult, command: string): void {
  if (result.exitCode === 0) return;
  const stderr = result.stderr.trim();
  throw new Error(`gog ${command} failed with exit ${result.exitCode}${stderr ? `: ${stderr}` : ""}`);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function textField(record: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function booleanField(record: Record<string, unknown> | undefined, keys: string[]): boolean | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    if (typeof record[key] === "boolean") return record[key] as boolean;
  }
  return undefined;
}

function arrayPayload(value: unknown, keys: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  for (const key of keys) {
    if (Array.isArray(record?.[key])) return record[key] as unknown[];
  }
  return [];
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string") {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function findUrl(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.match(/https?:\/\/[^\s"']+/)?.[0];
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findUrl(entry);
      if (found) return found;
    }
  }
  const record = asRecord(value);
  if (record) {
    for (const entry of Object.values(record)) {
      const found = findUrl(entry);
      if (found) return found;
    }
  }
  return undefined;
}

function accountFromUnknown(value: unknown): GogCalendarAccount | undefined {
  const record = asRecord(value);
  const email = textField(record, ["email", "account", "accountEmail", "user", "id"]);
  if (!email?.includes("@")) return undefined;
  const scopes = stringList(record?.services ?? record?.scopes ?? record?.enabledServices);
  const account: GogCalendarAccount = {
    email,
    externalAccountId: textField(record, ["externalAccountId", "external_account_id", "id"]) ?? email,
    scopes,
    status: textField(record, ["status"]) ?? "active",
    raw: value
  };
  const displayName = textField(record, ["displayName", "display_name", "name"]);
  if (displayName) account.displayName = displayName;
  return account;
}

function calendarFromUnknown(value: unknown): GogCalendarListEntry | undefined {
  const record = asRecord(value);
  const id = textField(record, ["id", "calendarId", "calendar_id"]);
  if (!id) return undefined;
  const calendar: GogCalendarListEntry = {
    id,
    name: textField(record, ["summary", "name", "title"]) ?? id,
    accessRole: textField(record, ["accessRole", "access_role"]) ?? "reader",
    primary: booleanField(record, ["primary", "isPrimary"]) ?? false,
    raw: value
  };
  const timezone = textField(record, ["timeZone", "timezone", "time_zone"]);
  if (timezone) calendar.timezone = timezone;
  const backgroundColor = textField(record, ["backgroundColor", "background_color", "color"]);
  if (backgroundColor) calendar.backgroundColor = backgroundColor;
  return calendar;
}

function dateValue(value: unknown): { value?: string; allDay: boolean } {
  if (typeof value === "string") {
    return { value, allDay: /^\d{4}-\d{2}-\d{2}$/.test(value) };
  }
  const record = asRecord(value);
  const dateTime = textField(record, ["dateTime", "date_time"]);
  if (dateTime) return { value: dateTime, allDay: false };
  const date = textField(record, ["date"]);
  return date ? { value: date, allDay: true } : { allDay: false };
}

function stringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

function eventFromUnknown(value: unknown): GogCalendarEvent | undefined {
  const record = asRecord(value);
  const id = textField(record, ["id", "eventId", "event_id"]);
  const start = dateValue(record?.start ?? record?.startAt ?? record?.start_at);
  const end = dateValue(record?.end ?? record?.endAt ?? record?.end_at);
  if (!id || !start.value || !end.value) return undefined;
  const extended = asRecord(record?.extendedProperties ?? record?.extended_properties);
  const event: GogCalendarEvent = {
    id,
    title: textField(record, ["summary", "title", "name"]) ?? "(Untitled event)",
    startAt: start.value,
    endAt: end.value,
    allDay: start.allDay || end.allDay,
    transparency: textField(record, ["transparency"]) === "transparent" ? "transparent" : "opaque",
    status: textField(record, ["status"]) ?? "confirmed",
    privateProperties: stringRecord(extended?.private ?? record?.privateProperties),
    raw: value
  };
  const optionalFields = {
    iCalUid: textField(record, ["iCalUID", "iCalUid", "icalUid", "ical_uid"]),
    location: textField(record, ["location"]),
    htmlLink: textField(record, ["htmlLink", "html_link", "url"]),
    recurringEventId: textField(record, ["recurringEventId", "recurring_event_id"]),
    etag: textField(record, ["etag"]),
    description: textField(record, ["description"])
  };
  for (const [key, fieldValue] of Object.entries(optionalFields)) {
    if (fieldValue !== undefined) Object.assign(event, { [key]: fieldValue });
  }
  if (Array.isArray(record?.attendees)) {
    event.attendees = record.attendees.flatMap((entry) => {
      const attendee = asRecord(entry);
      const email = textField(attendee, ["email"]);
      if (!email) return [];
      const result: { email: string; displayName?: string; responseStatus?: string } = { email };
      const displayName = textField(attendee, ["displayName", "display_name"]);
      if (displayName) result.displayName = displayName;
      const responseStatus = textField(attendee, ["responseStatus", "response_status"]);
      if (responseStatus) result.responseStatus = responseStatus;
      return [result];
    });
  }
  return event;
}

export class GogCalendarClient {
  private readonly command: string;
  private readonly runner: GogRunner;
  private readonly env: NodeJS.ProcessEnv;
  private readonly timeoutMs: number;

  constructor(options: GogCalendarClientOptions = {}) {
    this.command = options.command ?? "gog";
    this.runner = options.runner ?? defaultRunner;
    this.env = options.env ?? process.env;
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  private async run(args: string[], timeoutMs = this.timeoutMs): Promise<unknown> {
    const result = await this.runner(args, {
      command: this.command,
      env: { ...process.env, ...this.env },
      timeoutMs
    });
    ensureSuccess(result, args.join(" "));
    return parseJson(result.stdout, args.join(" "));
  }

  async listAccounts(): Promise<GogCalendarAccount[]> {
    const payload = await this.run(["auth", "list", "--check", "--json"], 30_000);
    return arrayPayload(payload, ["accounts", "items", "results"])
      .map(accountFromUnknown)
      .filter((account): account is GogCalendarAccount => account !== undefined);
  }

  async startRemoteAuth(input: { email: string; includeGmail: boolean }): Promise<{ authUrl: string }> {
    const services = input.includeGmail ? "gmail,calendar" : "calendar";
    const args = ["auth", "add", input.email, "--services", services];
    if (input.includeGmail) args.push("--gmail-scope", "readonly", "--gmail-no-send");
    args.push("--force-consent", "--remote", "--step", "1", "--json");
    const payload = await this.run(args, 30_000);
    const authUrl = findUrl(payload);
    if (!authUrl) throw new Error("gog remote auth did not return an authorization URL.");
    return { authUrl };
  }

  async completeRemoteAuth(input: {
    email: string;
    redirectUrl: string;
    includeGmail: boolean;
  }): Promise<void> {
    const services = input.includeGmail ? "gmail,calendar" : "calendar";
    const args = ["auth", "add", input.email, "--services", services];
    if (input.includeGmail) args.push("--gmail-scope", "readonly", "--gmail-no-send");
    args.push(
      "--force-consent",
      "--remote",
      "--step",
      "2",
      "--auth-url",
      input.redirectUrl,
      "--json"
    );
    await this.run(args, 60_000);
  }

  async listCalendars(accountEmail: string): Promise<GogCalendarListEntry[]> {
    const payload = await this.run([
      "--gmail-no-send",
      "--enable-commands",
      "calendar",
      "--account",
      accountEmail,
      "calendar",
      "calendars",
      "--all",
      "--json"
    ]);
    return arrayPayload(payload, ["calendars", "items", "results"])
      .map(calendarFromUnknown)
      .filter((calendar): calendar is GogCalendarListEntry => calendar !== undefined);
  }

  async listEvents(input: {
    accountEmail: string;
    externalCalendarId: string;
    from: string;
    to: string;
  }): Promise<GogCalendarEvent[]> {
    const payload = await this.run([
      "--gmail-no-send",
      "--enable-commands",
      "calendar",
      "--account",
      input.accountEmail,
      "calendar",
      "events",
      input.externalCalendarId,
      "--from",
      input.from,
      "--to",
      input.to,
      "--all-pages",
      "--json"
    ]);
    return arrayPayload(payload, ["events", "items", "results"])
      .map(eventFromUnknown)
      .filter((event): event is GogCalendarEvent => event !== undefined);
  }

  async getEvent(input: {
    accountEmail: string;
    externalCalendarId: string;
    externalEventId: string;
  }): Promise<GogCalendarEvent> {
    const payload = await this.run([
      "--gmail-no-send",
      "--enable-commands",
      "calendar",
      "--account",
      input.accountEmail,
      "calendar",
      "event",
      input.externalCalendarId,
      input.externalEventId,
      "--json"
    ]);
    const event = eventFromUnknown(asRecord(payload)?.event ?? payload);
    if (!event) throw new Error(`gog returned an invalid calendar event: ${input.externalEventId}`);
    return event;
  }

  async createEvent(input: CalendarEventWriteInput): Promise<GogCalendarEvent> {
    const args = [
      "--gmail-no-send",
      "--enable-commands",
      "calendar",
      "--account",
      input.accountEmail,
      "calendar",
      "create",
      input.externalCalendarId,
      "--summary",
      input.title,
      "--from",
      input.startAt,
      "--to",
      input.endAt,
      "--start-timezone",
      input.timezone,
      "--end-timezone",
      input.timezone,
      "--transparency",
      input.transparency ?? "opaque",
      "--send-updates",
      "none"
    ];
    if (input.description) args.push("--description", input.description);
    if (input.location) args.push("--location", input.location);
    for (const [key, value] of Object.entries(input.privateProperties ?? {})) {
      args.push("--private-prop", `${key}=${value}`);
    }
    args.push("--json");
    const payload = await this.run(args);
    const event = eventFromUnknown(asRecord(payload)?.event ?? payload);
    if (!event) throw new Error("gog created an event but returned an invalid response.");
    return event;
  }

  async updateEvent(
    input: CalendarEventWriteInput & { externalEventId: string }
  ): Promise<GogCalendarEvent> {
    const args = [
      "--gmail-no-send",
      "--enable-commands",
      "calendar",
      "--account",
      input.accountEmail,
      "calendar",
      "update",
      input.externalCalendarId,
      input.externalEventId,
      "--summary",
      input.title,
      "--from",
      input.startAt,
      "--to",
      input.endAt,
      "--start-timezone",
      input.timezone,
      "--end-timezone",
      input.timezone,
      "--transparency",
      input.transparency ?? "opaque",
      "--send-updates",
      "none"
    ];
    if (input.description !== undefined) args.push("--description", input.description);
    if (input.location !== undefined) args.push("--location", input.location);
    for (const [key, value] of Object.entries(input.privateProperties ?? {})) {
      args.push("--private-prop", `${key}=${value}`);
    }
    args.push("--json");
    const payload = await this.run(args);
    const event = eventFromUnknown(asRecord(payload)?.event ?? payload);
    if (!event) throw new Error("gog updated an event but returned an invalid response.");
    return event;
  }

  async deleteEvent(input: {
    accountEmail: string;
    externalCalendarId: string;
    externalEventId: string;
  }): Promise<void> {
    await this.run([
      "--gmail-no-send",
      "--enable-commands",
      "calendar",
      "--account",
      input.accountEmail,
      "calendar",
      "delete",
      input.externalCalendarId,
      input.externalEventId,
      "--send-updates",
      "none",
      "--force",
      "--json"
    ]);
  }
}

export type CalendarClientLike = Pick<
  GogCalendarClient,
  | "listAccounts"
  | "startRemoteAuth"
  | "completeRemoteAuth"
  | "listCalendars"
  | "listEvents"
  | "getEvent"
  | "createEvent"
  | "updateEvent"
  | "deleteEvent"
>;
