import { spawn } from "node:child_process";

export type GogCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type GogRunner = (
  args: string[],
  options: { command: string; env: NodeJS.ProcessEnv; timeoutMs: number }
) => Promise<GogCommandResult>;

export type GogAccount = {
  email: string;
  externalAccountId: string;
  displayName?: string;
  scopes: string[];
  status: string;
  raw: unknown;
};

export type GogSearchMessage = {
  id: string;
  threadId?: string;
  subject?: string;
  from?: string;
  date?: string;
  snippet?: string;
  raw: unknown;
};

export type GogEmailMessage = GogSearchMessage & {
  to?: string;
  cc?: string;
  bodyText?: string;
  bodyHtml?: string;
};

export type GogDoctorStatus = {
  installed: boolean;
  ok: boolean;
  version?: string;
  raw?: unknown;
  error?: string;
  stderr?: string;
};

export type GogGmailClientOptions = {
  command?: string;
  runner?: GogRunner;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
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
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        exitCode: exitCode ?? 1
      });
    });
  });
}

function parseJson(stdout: string, command: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    throw new Error(
      `gog ${command} returned non-JSON output: ${err instanceof Error ? err.message : String(err)}`
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
    ? (value as Record<string, unknown>)
    : undefined;
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.map(asRecord).filter((record): record is Record<string, unknown> => record !== undefined);
}

function textField(record: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function nestedRecord(record: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  return asRecord(record?.[key]);
}

function arrayPayload(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  if (!record) return [];
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function headerValue(raw: unknown, name: string): string | undefined {
  const headers = asRecord(raw)?.headers ?? nestedRecord(asRecord(raw), "payload")?.headers;
  if (Array.isArray(headers)) {
    const match = headers
      .map(asRecord)
      .find((header) => textField(header, ["name"])?.toLowerCase() === name.toLowerCase());
    return textField(match, ["value"]);
  }
  const headerRecord = asRecord(headers);
  if (!headerRecord) return undefined;
  const direct = headerRecord[name] ?? headerRecord[name.toLowerCase()] ?? headerRecord[name.toUpperCase()];
  return typeof direct === "string" ? direct : undefined;
}

function messageIdFromRecord(record: Record<string, unknown>): string | undefined {
  return textField(record, ["id", "messageId", "message_id", "externalId", "external_id"]);
}

function searchMessageFromUnknown(value: unknown): GogSearchMessage | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return {
      id: value,
      raw: value
    };
  }
  const record = asRecord(value);
  const id = record ? messageIdFromRecord(record) : undefined;
  if (!record || !id) return undefined;
  const message: GogSearchMessage = {
    id,
    raw: value
  };
  const threadId = textField(record, ["threadId", "thread_id"]);
  if (threadId) message.threadId = threadId;
  const subject = textField(record, ["subject", "title"]) ?? headerValue(value, "Subject");
  if (subject) message.subject = subject;
  const from = textField(record, ["from", "sender"]) ?? headerValue(value, "From");
  if (from) message.from = from;
  const date = textField(record, ["date", "internalDate", "receivedAt", "received_at"]) ?? headerValue(value, "Date");
  if (date) message.date = date;
  const snippet = textField(record, ["snippet", "summary", "preview"]);
  if (snippet) message.snippet = snippet;
  return message;
}

function emailMessageFromUnknown(value: unknown, fallbackId: string): GogEmailMessage {
  const record = asRecord(value);
  const search = record ? searchMessageFromUnknown(record) : undefined;
  const message: GogEmailMessage = {
    id: search?.id ?? fallbackId,
    raw: value
  };
  if (search?.threadId) message.threadId = search.threadId;
  const subject = search?.subject ?? headerValue(value, "Subject");
  if (subject) message.subject = subject;
  const from = search?.from ?? headerValue(value, "From");
  if (from) message.from = from;
  const to = textField(record, ["to"]) ?? headerValue(value, "To");
  if (to) message.to = to;
  const cc = textField(record, ["cc"]) ?? headerValue(value, "Cc");
  if (cc) message.cc = cc;
  const date = search?.date ?? headerValue(value, "Date");
  if (date) message.date = date;
  const snippet = search?.snippet ?? textField(record, ["snippet", "summary", "preview"]);
  if (snippet) message.snippet = snippet;
  const bodyText = textField(record, ["bodyText", "body_text", "text", "plain", "content", "sanitizedContent"]);
  if (bodyText) message.bodyText = bodyText;
  const bodyHtml = textField(record, ["bodyHtml", "body_html", "html"]);
  if (bodyHtml) message.bodyHtml = bodyHtml;
  return message;
}

function accountFromUnknown(value: unknown): GogAccount | undefined {
  if (typeof value === "string" && value.includes("@")) {
    return {
      email: value,
      externalAccountId: value,
      scopes: ["gmail"],
      status: "active",
      raw: value
    };
  }
  const record = asRecord(value);
  const email = textField(record, ["email", "account", "accountEmail", "user", "id"]);
  if (!record || !email || !email.includes("@")) return undefined;
  const displayName = textField(record, ["displayName", "display_name", "name"]);
  const services = stringList(record.services ?? record.scopes ?? record.enabledServices);
  return {
    email,
    externalAccountId: textField(record, ["externalAccountId", "external_account_id", "id"]) ?? email,
    ...(displayName ? { displayName } : {}),
    scopes: services.length > 0 ? services : ["gmail"],
    status: textField(record, ["status"]) ?? "active",
    raw: value
  };
}

export class GogGmailClient {
  private readonly command: string;
  private readonly runner: GogRunner;
  private readonly env: NodeJS.ProcessEnv;
  private readonly timeoutMs: number;

  constructor(options: GogGmailClientOptions = {}) {
    this.command = options.command ?? "gog";
    this.runner = options.runner ?? defaultRunner;
    this.env = options.env ?? process.env;
    this.timeoutMs = options.timeoutMs ?? 60000;
  }

  private async run(args: string[], timeoutMs = this.timeoutMs): Promise<GogCommandResult> {
    return this.runner(args, {
      command: this.command,
      env: {
        ...process.env,
        ...this.env
      },
      timeoutMs
    });
  }

  async doctor(): Promise<GogDoctorStatus> {
    let version: string | undefined;
    try {
      const versionResult = await this.run(["--version"], 10000);
      if (versionResult.exitCode !== 0) {
        return {
          installed: false,
          ok: false,
          stderr: versionResult.stderr.trim(),
          error: versionResult.stderr.trim() || `gog --version exited ${versionResult.exitCode}`
        };
      }
      version = versionResult.stdout.trim() || versionResult.stderr.trim();
    } catch (err) {
      return {
        installed: false,
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      };
    }

    try {
      const result = await this.run(["auth", "doctor", "--check", "--json"], 30000);
      const raw = parseJson(result.stdout, "auth doctor --check --json");
      const status: GogDoctorStatus = {
        installed: true,
        ok: result.exitCode === 0,
        raw
      };
      if (version) status.version = version;
      const stderr = result.stderr.trim();
      if (stderr) status.stderr = stderr;
      if (result.exitCode !== 0) status.error = stderr || `gog auth doctor exited ${result.exitCode}`;
      return status;
    } catch (err) {
      const status: GogDoctorStatus = {
        installed: true,
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      };
      if (version) status.version = version;
      return status;
    }
  }

  async listAccounts(): Promise<GogAccount[]> {
    const args = ["auth", "list", "--check", "--json"];
    const result = await this.run(args, 30000);
    ensureSuccess(result, args.join(" "));
    const payload = parseJson(result.stdout, args.join(" "));
    return arrayPayload(payload, ["accounts", "items", "results"])
      .map(accountFromUnknown)
      .filter((account): account is GogAccount => account !== undefined);
  }

  async searchMessages(input: {
    accountEmail: string;
    query: string;
    max: number;
  }): Promise<GogSearchMessage[]> {
    const args = [
      "--gmail-no-send",
      "--account",
      input.accountEmail,
      "gmail",
      "search",
      input.query,
      "--max",
      String(input.max),
      "--json"
    ];
    const result = await this.run(args);
    ensureSuccess(result, args.join(" "));
    const payload = parseJson(result.stdout, args.join(" "));
    return arrayPayload(payload, ["messages", "items", "results"])
      .map(searchMessageFromUnknown)
      .filter((message): message is GogSearchMessage => message !== undefined);
  }

  async getMessage(input: {
    accountEmail: string;
    messageId: string;
  }): Promise<GogEmailMessage> {
    const args = [
      "--gmail-no-send",
      "--account",
      input.accountEmail,
      "gmail",
      "get",
      input.messageId,
      "--sanitize-content",
      "--json"
    ];
    const result = await this.run(args);
    ensureSuccess(result, args.join(" "));
    const payload = parseJson(result.stdout, args.join(" "));
    return emailMessageFromUnknown(payload, input.messageId);
  }
}
