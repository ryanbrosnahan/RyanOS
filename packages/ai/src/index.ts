import { z } from "zod";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
export {
  defaultToolOutputTrustPolicy,
  sanitizeToolOutputForModel,
  type SanitizedToolOutput,
  type ToolOutputRiskSignal,
  type ToolOutputTrustPolicy
} from "./trust.js";
export {
  runIntentEvalCase,
  runIntentEvalSuite,
  ScriptedAiProvider,
  type IntentEvalCase,
  type IntentEvalCaseResult,
  type IntentEvalExpectedToolCall,
  type IntentEvalSuiteResult
} from "./evals.js";

export const toolEnvelopeSchema = z.object({
  sourceMessageId: z.string().optional(),
  sourceProvider: z.enum(["telegram", "whatsapp", "web", "system"]).optional(),
  sourceChatId: z.string().optional(),
  sourceUserId: z.string().optional(),
  timezone: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  idempotencyKey: z.string().optional(),
  dryRun: z.boolean().optional(),
  requireConfirmation: z.boolean().optional()
});

export type ToolEnvelope = z.infer<typeof toolEnvelopeSchema>;

export type ToolStatus =
  | "applied"
  | "proposed"
  | "needs_confirmation"
  | "needs_clarification"
  | "replayed"
  | "rejected"
  | "failed";

export type ToolResult<T = unknown> = {
  status: ToolStatus;
  data?: T;
  messageForUser?: string;
  clarificationPrompt?: string;
  confirmationPrompt?: string;
  auditId?: string;
  eventIds?: string[];
  warnings?: string[];
};

export type ToolSideEffect =
  | "read"
  | "state_write"
  | "external_draft"
  | "external_send"
  | "delete"
  | "capability_grant"
  | "system";

export type ToolConfirmationPolicy =
  | "not_required"
  | "low_confidence"
  | "required";

export type ToolRetrySafety =
  | "idempotent"
  | "safe_with_idempotency_key"
  | "unsafe";

export type ToolMetadata = {
  sideEffect: ToolSideEffect;
  confirmation: ToolConfirmationPolicy;
  retrySafety: ToolRetrySafety;
  requiredCapability?: string;
  descriptionForModel?: string;
};

export type ToolDefinition<TInput = unknown> = {
  name: string;
  description: string;
  metadata?: ToolMetadata;
  inputSchema: z.ZodType<TInput>;
  handler: (input: TInput) => Promise<ToolResult>;
};

export type PublicToolDefinition = {
  name: string;
  description: string;
  metadata?: ToolMetadata;
  inputSchema?: unknown;
};

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition<unknown>>();

  register<TInput>(definition: ToolDefinition<TInput>): void {
    if (this.tools.has(definition.name)) {
      throw new Error(`Tool already registered: ${definition.name}`);
    }
    this.tools.set(definition.name, definition as ToolDefinition<unknown>);
  }

  list(): PublicToolDefinition[] {
    return [...this.tools.values()].map(({ name, description, metadata, inputSchema }) => {
      const listed: PublicToolDefinition = { name, description };
      if (metadata !== undefined) listed.metadata = metadata;
      listed.inputSchema = safeInputSchema(inputSchema);
      return listed;
    });
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async execute(name: string, input: unknown): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        status: "failed",
        messageForUser: `Tool not found: ${name}`
      };
    }

    const parsed = tool.inputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        status: "rejected",
        messageForUser: `Invalid input for ${name}`,
        warnings: parsed.error.issues.map((issue) => issue.message)
      };
    }

    return tool.handler(parsed.data);
  }
}

function safeInputSchema(schema: z.ZodType<unknown>): unknown {
  try {
    return z.toJSONSchema(schema, { io: "input" });
  } catch (err) {
    return {
      unavailable: true,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

export type IncomingMessage = {
  id: string;
  provider: "telegram" | "whatsapp" | "web" | "system";
  accountId?: string;
  chatId: string;
  userId: string;
  text: string;
  username?: string;
  displayName?: string;
  replyToMessageId?: string;
  timestamp: string;
  attachments: Array<{
    id: string;
    mimeType?: string;
    url?: string;
    metadata?: Record<string, unknown>;
  }>;
  metadata: Record<string, unknown>;
};

export type AiProviderResult = {
  text?: string;
  toolCalls: Array<{
    name: string;
    input: unknown;
  }>;
  setupRequired?: boolean;
  setupActions?: AiSetupAction[];
  warnings?: string[];
};

export const aiProviderModeSchema = z.enum([
  "none",
  "codex-login",
  "openai-responses-api",
  "local-llm"
]);

export type AiProviderMode = z.infer<typeof aiProviderModeSchema>;

export type AiSetupAction = {
  id: string;
  title: string;
  blocking: boolean;
  instructions: string[];
  command?: string;
  docs?: string[];
};

export type AiProviderStatus = {
  name: string;
  mode: AiProviderMode;
  ready: boolean;
  setupRequired: boolean;
  setupActions: AiSetupAction[];
  warnings: string[];
};

const aiProviderStatusSchema = z.object({
  name: z.string(),
  mode: aiProviderModeSchema,
  ready: z.boolean(),
  setupRequired: z.boolean(),
  setupActions: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      blocking: z.boolean(),
      instructions: z.array(z.string()),
      command: z.string().optional(),
      docs: z.array(z.string()).optional()
    })
  ),
  warnings: z.array(z.string())
});

function parseAiProviderStatus(value: unknown): AiProviderStatus {
  const parsed = aiProviderStatusSchema.parse(value);
  return {
    name: parsed.name,
    mode: parsed.mode,
    ready: parsed.ready,
    setupRequired: parsed.setupRequired,
    setupActions: parsed.setupActions.map((action) => {
      const result: AiSetupAction = {
        id: action.id,
        title: action.title,
        blocking: action.blocking,
        instructions: action.instructions
      };
      if (action.command !== undefined) result.command = action.command;
      if (action.docs !== undefined) result.docs = action.docs;
      return result;
    }),
    warnings: parsed.warnings
  };
}

export interface AiProvider {
  readonly name: string;
  readonly mode: AiProviderMode;
  getStatus(): Promise<AiProviderStatus>;
  interpret(message: IncomingMessage, tools: PublicToolDefinition[]): Promise<AiProviderResult>;
}

export class NoopAiProvider implements AiProvider {
  readonly name = "none";
  readonly mode = "none";

  async getStatus(): Promise<AiProviderStatus> {
    return {
      name: this.name,
      mode: this.mode,
      ready: true,
      setupRequired: false,
      setupActions: [],
      warnings: ["AI interpretation is disabled; typed tool calls still work."]
    };
  }

  async interpret(
    _message: IncomingMessage,
    _tools: PublicToolDefinition[]
  ): Promise<AiProviderResult> {
    return {
      text: "No AI provider is configured. Submit a typed tool call directly or enable an AI provider.",
      toolCalls: []
    };
  }
}

type CommandCheck = {
  ok: boolean;
  stdout: string;
  stderr: string;
  message?: string;
};

async function runCommand(
  command: string,
  args: string[],
  timeoutMs: number,
  cwd?: string
): Promise<CommandCheck> {
  return new Promise((resolve) => {
    const maxBufferBytes = 10 * 1024 * 1024;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let maxBufferExceeded = false;
    let settled = false;

    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const finish = (check: CommandCheck) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ...check,
        stdout: check.stdout.trim(),
        stderr: check.stderr.trim()
      });
    };

    const appendOutput = (kind: "stdout" | "stderr", chunk: Buffer) => {
      const currentBytes = Buffer.byteLength(stdout) + Buffer.byteLength(stderr);
      if (currentBytes + chunk.byteLength > maxBufferBytes) {
        maxBufferExceeded = true;
        child.kill("SIGTERM");
        return;
      }
      if (kind === "stdout") {
        stdout += chunk.toString("utf8");
      } else {
        stderr += chunk.toString("utf8");
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => appendOutput("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => appendOutput("stderr", chunk));
    child.on("error", (error) => {
      finish({
        ok: false,
        stdout,
        stderr,
        message: error.message
      });
    });
    child.on("close", (code, signal) => {
      if (maxBufferExceeded) {
        finish({
          ok: false,
          stdout,
          stderr,
          message: `Command output exceeded ${maxBufferBytes} bytes.`
        });
        return;
      }
      if (timedOut) {
        finish({
          ok: false,
          stdout,
          stderr,
          message: `Command timed out after ${timeoutMs}ms.`
        });
        return;
      }
      const message =
        code === 0 ? undefined : `Command exited with code ${code ?? "unknown"}${
          signal ? ` and signal ${signal}` : ""
        }.`;
      finish({
        ok: code === 0,
        stdout,
        stderr,
        ...(message ? { message } : {})
      });
    });
  });
}

function setupMessage(status: AiProviderStatus): string {
  if (!status.setupRequired) {
    return status.warnings[0] ?? `${status.name} is not ready to interpret messages yet.`;
  }

  const firstAction = status.setupActions[0];
  if (!firstAction) return `${status.name} needs setup before it can interpret messages.`;
  const firstInstruction = firstAction.instructions[0];
  return firstInstruction
    ? `${firstAction.title}: ${firstInstruction}`
    : `${firstAction.title}.`;
}

function conciseBridgeError(value: string | undefined, fallback = "unknown error"): string {
  const normalized = (value ?? fallback).replace(/\s+/g, " ").trim();
  if (normalized.length === 0) return fallback;
  const maxLength = 900;
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1)}...`
    : normalized;
}

export class CodexLoginAiProvider implements AiProvider {
  readonly name = "codex-login";
  readonly mode = "codex-login";
  private cachedStatus: AiProviderStatus | undefined;
  private cachedAt = 0;

  constructor(
    private readonly options: {
      codexCommand?: string;
      workdir?: string;
      statusCacheMs?: number;
      timeoutMs?: number;
    } = {}
  ) {}

  async getStatus(): Promise<AiProviderStatus> {
    const now = Date.now();
    const cacheMs = this.options.statusCacheMs ?? 30_000;
    if (this.cachedStatus && now - this.cachedAt < cacheMs) {
      return this.cachedStatus;
    }

    const codexCommand = this.options.codexCommand ?? "codex";
    const timeoutMs = this.options.timeoutMs ?? 5_000;
    const setupActions: AiSetupAction[] = [];
    const warnings: string[] = [];

    const version = await runCommand(codexCommand, ["--version"], timeoutMs);
    if (!version.ok) {
      setupActions.push({
        id: "codex-cli-install",
        title: "Install or expose Codex CLI",
        blocking: true,
        instructions: [
          "Codex CLI is not available to the RyanOS API runtime. Install it there, or configure a host-side Codex bridge command that RyanOS can call.",
          "After it is installed, run the setup status check again."
        ],
        docs: ["https://developers.openai.com/codex/cli"]
      });
    } else {
      const login = await runCommand(codexCommand, ["login", "status"], timeoutMs);
      if (!login.ok) {
        setupActions.push({
          id: "codex-login",
          title: "Log in to Codex",
          blocking: true,
          instructions: [
            "Run `codex login` in the same runtime RyanOS will use for the bridge, then complete the browser login.",
            "Run `codex login status` afterward to confirm the session is available."
          ],
          command: "codex login",
          docs: ["https://developers.openai.com/codex/auth#openai-authentication"]
        });
      }
    }

    if (setupActions.length === 0) {
      warnings.push(
        "Codex CLI and login appear available. RyanOS will constrain Codex output to the typed tool-call schema."
      );
    }

    const status: AiProviderStatus = {
      name: this.name,
      mode: this.mode,
      ready: setupActions.length === 0,
      setupRequired: setupActions.length > 0,
      setupActions,
      warnings
    };
    this.cachedStatus = status;
    this.cachedAt = now;
    return status;
  }

  async interpret(
    message: IncomingMessage,
    tools: PublicToolDefinition[]
  ): Promise<AiProviderResult> {
    const status = await this.getStatus();
    if (!status.ready) {
      return {
        text: setupMessage(status),
        toolCalls: [],
        setupRequired: status.setupRequired,
        setupActions: status.setupActions,
        warnings: status.warnings
      };
    }

    const bridgeResult = await this.runCodexBridge(message, tools);
    return {
      ...bridgeResult,
      warnings: [...(bridgeResult.warnings ?? []), ...status.warnings]
    };
  }

  private async runCodexBridge(
    message: IncomingMessage,
    tools: PublicToolDefinition[]
  ): Promise<AiProviderResult> {
    const codexCommand = this.options.codexCommand ?? "codex";
    const timeoutMs = this.options.timeoutMs ?? 60_000;
    const tempDir = await mkdtemp(join(tmpdir(), "ryanos-codex-"));
    const schemaPath = join(tempDir, "tool-call-output.schema.json");
    const outputPath = join(tempDir, "codex-last-message.json");
    const schema = buildCodexOutputSchema(tools);
    await writeFile(schemaPath, JSON.stringify(schema, null, 2));

    try {
      const result = await runCommand(
        codexCommand,
        [
          "exec",
          "--sandbox",
          "read-only",
          "--skip-git-repo-check",
          "--output-schema",
          schemaPath,
          "--output-last-message",
          outputPath,
          buildCodexPrompt(message, tools)
        ],
        timeoutMs,
        this.options.workdir
      );

      if (!result.ok) {
        return {
          text: "Codex bridge failed before returning structured intent.",
          toolCalls: [],
          warnings: [
            `Codex bridge command returned a non-zero exit status: ${conciseBridgeError(
              result.stderr || result.message
            )}`
          ]
        };
      }

      return parseCodexBridgeOutput(await readCodexBridgeOutput(outputPath, result.stdout));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

export class CodexLoginBridgeAiProvider implements AiProvider {
  readonly name = "codex-login-bridge";
  readonly mode = "codex-login";
  private cachedStatus: AiProviderStatus | undefined;
  private cachedAt = 0;

  constructor(
    private readonly options: {
      bridgeUrl: string;
      bridgeToken?: string;
      statusCacheMs?: number;
      timeoutMs?: number;
    }
  ) {}

  async getStatus(): Promise<AiProviderStatus> {
    const now = Date.now();
    const cacheMs = this.options.statusCacheMs ?? 30_000;
    if (this.cachedStatus && now - this.cachedAt < cacheMs) {
      return this.cachedStatus;
    }

    try {
      const response = await fetchWithTimeout(
        `${this.normalizedBridgeUrl()}/status`,
        {
          method: "GET",
          headers: this.authHeaders()
        },
        this.options.timeoutMs ?? 5_000
      );
      if (!response.ok) {
        throw new Error(`Codex bridge returned HTTP ${response.status}`);
      }
      const status = parseAiProviderStatus(await response.json());
      this.cachedStatus = status;
      this.cachedAt = now;
      return status;
    } catch (err) {
      const status: AiProviderStatus = {
        name: this.name,
        mode: this.mode,
        ready: false,
        setupRequired: true,
        setupActions: [
          {
            id: "codex-host-bridge",
            title: "Start Codex host bridge",
            blocking: true,
            instructions: [
              "Docker cannot run the macOS Codex app binary directly. Start the local host bridge so RyanOS can use your logged-in Codex app account.",
              "Keep this bridge bound to localhost; it should not be exposed publicly."
            ],
            command: "pnpm codex:bridge"
          }
        ],
        warnings: [
          `Codex bridge is unavailable at ${this.normalizedBridgeUrl()}: ${
            err instanceof Error ? err.message : String(err)
          }`
        ]
      };
      this.cachedStatus = status;
      this.cachedAt = now;
      return status;
    }
  }

  async interpret(
    message: IncomingMessage,
    tools: PublicToolDefinition[]
  ): Promise<AiProviderResult> {
    const status = await this.getStatus();
    if (!status.ready) {
      return {
        text: setupMessage(status),
        toolCalls: [],
        setupRequired: status.setupRequired,
        setupActions: status.setupActions,
        warnings: status.warnings
      };
    }

    try {
      const response = await fetchWithTimeout(
        `${this.normalizedBridgeUrl()}/interpret`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...this.authHeaders()
          },
          body: JSON.stringify({ message, tools })
        },
        this.options.timeoutMs ?? 60_000
      );
      if (!response.ok) {
        throw new Error(`Codex bridge returned HTTP ${response.status}`);
      }
      return normalizeAiProviderResult(codexBridgeOutputSchema.parse(await response.json()));
    } catch (err) {
      const warning = conciseBridgeError(err instanceof Error ? err.message : String(err));
      return {
        text: "Codex bridge failed before returning structured intent.",
        toolCalls: [],
        warnings: [warning]
      };
    }
  }

  private normalizedBridgeUrl(): string {
    return this.options.bridgeUrl.replace(/\/+$/, "");
  }

  private authHeaders(): Record<string, string> {
    return this.options.bridgeToken
      ? { authorization: `Bearer ${this.options.bridgeToken}` }
      : {};
  }
}

function buildCodexOutputSchema(tools: PublicToolDefinition[]): Record<string, unknown> {
  const toolNames = tools.map((tool) => tool.name).sort();
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      text: { type: "string" },
      toolCalls: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: toolNames.length > 0 ? { type: "string", enum: toolNames } : { type: "string" },
            inputJson: { type: "string" }
          },
          required: ["name", "inputJson"]
        }
      },
      warnings: {
        type: "array",
        items: { type: "string" }
      }
    },
    required: ["text", "toolCalls", "warnings"]
  };
}

const toolEnvelopeFieldsForRuntimeOnly = new Set([
  "sourceMessageId",
  "sourceProvider",
  "sourceChatId",
  "sourceUserId",
  "idempotencyKey",
  "dryRun",
  "requireConfirmation"
]);

function inputSchemaForPrompt(inputSchema: unknown): unknown {
  if (!inputSchema || typeof inputSchema !== "object" || Array.isArray(inputSchema)) {
    return inputSchema;
  }
  const schema = JSON.parse(JSON.stringify(inputSchema)) as Record<string, unknown>;
  if (!schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties)) {
    return schema;
  }

  const properties = schema.properties as Record<string, unknown>;
  for (const field of toolEnvelopeFieldsForRuntimeOnly) {
    delete properties[field];
  }
  if (Array.isArray(schema.required)) {
    schema.required = schema.required.filter(
      (field) => typeof field !== "string" || !toolEnvelopeFieldsForRuntimeOnly.has(field)
    );
  }
  return schema;
}

export function buildCodexPrompt(message: IncomingMessage, tools: PublicToolDefinition[]): string {
  return [
    "You are the RyanOS intent interpreter.",
    "Convert the user message into zero or more typed RyanOS tool calls.",
    "Return only data that satisfies the provided output schema.",
    "For each tool call, put the tool input object in inputJson as a compact JSON string.",
    "Use an empty object string ({}) for inputJson when a tool needs no input.",
    "Every inputJson object must validate against that tool's inputSchema.",
    "Use the exact inputSchema property names. Do not invent aliases such as type, target, status, or cadence unless they appear in the schema.",
    "Do not include runtime envelope fields such as sourceMessageId, sourceProvider, sourceChatId, sourceUserId, idempotencyKey, dryRun, or requireConfirmation; RyanOS fills those.",
    "For a habit or recurring preference, create the item, then set its recurrence policy, then record any stated completions with the recurring item title as recurrenceRef.",
    "Do not execute tools, mutate files, contact external services, or invent connector setup.",
    "If a setup/login/connector/token action is needed, return no tool calls and explain it in text.",
    "",
    "Current message:",
    JSON.stringify(
      {
        id: message.id,
        provider: message.provider,
        chatId: message.chatId,
        userId: message.userId,
        text: message.text,
        timestamp: message.timestamp,
        metadata: message.metadata
      },
      null,
      2
    ),
    "",
    "Available tools:",
    JSON.stringify(
      tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        metadata: tool.metadata,
        inputSchema: inputSchemaForPrompt(tool.inputSchema)
      })),
      null,
      2
    )
  ].join("\n");
}

const codexBridgeOutputSchema = z.object({
  text: z.string().optional(),
  toolCalls: z.array(
    z.object({
      name: z.string(),
      input: z.unknown()
    })
  ),
  warnings: z.array(z.string()).optional()
});

const codexCliOutputSchema = z.object({
  text: z.string(),
  toolCalls: z.array(
    z.object({
      name: z.string(),
      inputJson: z.string()
    })
  ),
  warnings: z.array(z.string())
});

function parseCodexBridgeOutput(stdout: string): AiProviderResult {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return {
      text: "Codex bridge returned no output.",
      toolCalls: [],
      warnings: ["Codex bridge stdout was empty."]
    };
  }

  const parsed = parseCodexBridgeJson(trimmed) ?? parseCodexBridgeJson(stripJsonFence(trimmed));
  if (parsed) return parsed;

  const embeddedJson = extractLastJsonObject(trimmed);
  if (embeddedJson) {
    const embedded = parseCodexBridgeJson(embeddedJson);
    if (embedded) return embedded;
  }

  return {
    text: "Codex bridge returned invalid structured output.",
    toolCalls: [],
    warnings: ["Codex bridge output did not match the expected JSON tool-call schema."]
  };
}

async function readCodexBridgeOutput(outputPath: string, stdout: string): Promise<string> {
  try {
    const fileOutput = (await readFile(outputPath, "utf8")).trim();
    if (fileOutput) return fileOutput;
  } catch {
    // Fall back to stdout; older or failing Codex CLI builds may not write the file.
  }
  return stdout;
}

function parseCodexBridgeJson(value: string): AiProviderResult | undefined {
  if (!value.trim()) return undefined;
  try {
    const parsedJson = JSON.parse(value);
    const bridgeParsed = codexBridgeOutputSchema.safeParse(parsedJson);
    if (bridgeParsed.success) {
      return normalizeAiProviderResult(bridgeParsed.data);
    }
    const cliParsed = codexCliOutputSchema.safeParse(parsedJson);
    if (cliParsed.success) {
      return normalizeCodexCliResult(cliParsed.data);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function stripJsonFence(value: string): string {
  const match = value.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() ?? value;
}

function extractLastJsonObject(value: string): string | undefined {
  let last: string | undefined;
  for (let start = 0; start < value.length; start += 1) {
    if (value[start] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let end = start; end < value.length; end += 1) {
      const char = value[end];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
      } else if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          last = value.slice(start, end + 1);
          break;
        }
      }
    }
  }
  return last;
}

function normalizeAiProviderResult(parsed: z.infer<typeof codexBridgeOutputSchema>): AiProviderResult {
  const result: AiProviderResult = {
    toolCalls: parsed.toolCalls
  };
  if (parsed.text !== undefined) result.text = parsed.text;
  if (parsed.warnings !== undefined) result.warnings = parsed.warnings;
  return result;
}

function normalizeCodexCliResult(parsed: z.infer<typeof codexCliOutputSchema>): AiProviderResult {
  const warnings = [...parsed.warnings];
  const toolCalls = parsed.toolCalls.map((toolCall) => {
    try {
      return {
        name: toolCall.name,
        input: JSON.parse(toolCall.inputJson)
      };
    } catch {
      warnings.push(`Codex returned invalid inputJson for ${toolCall.name}; using an empty input object.`);
      return {
        name: toolCall.name,
        input: {}
      };
    }
  });
  return {
    text: parsed.text,
    toolCalls,
    ...(warnings.length > 0 ? { warnings } : {})
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

class SetupRequiredAiProvider implements AiProvider {
  readonly name: string;

  constructor(
    readonly mode: AiProviderMode,
    private readonly action: AiSetupAction,
    private readonly warning?: string
  ) {
    this.name = mode;
  }

  async getStatus(): Promise<AiProviderStatus> {
    return {
      name: this.name,
      mode: this.mode,
      ready: false,
      setupRequired: true,
      setupActions: [this.action],
      warnings: this.warning ? [this.warning] : []
    };
  }

  async interpret(
    _message: IncomingMessage,
    _tools: PublicToolDefinition[]
  ): Promise<AiProviderResult> {
    const status = await this.getStatus();
    return {
      text: setupMessage(status),
      toolCalls: [],
      setupRequired: true,
      setupActions: status.setupActions,
      warnings: status.warnings
    };
  }
}

function parseAiProviderMode(value: string | undefined): AiProviderMode {
  const parsed = aiProviderModeSchema.safeParse(value ?? "none");
  return parsed.success ? parsed.data : "none";
}

export function createAiProviderFromEnv(
  env: Record<string, string | undefined> = process.env
): AiProvider {
  const mode = parseAiProviderMode(env.RYANOS_AI_PROVIDER);
  if (mode === "codex-login") {
    if (env.RYANOS_CODEX_BRIDGE_URL) {
      const bridgeOptions: ConstructorParameters<typeof CodexLoginBridgeAiProvider>[0] = {
        bridgeUrl: env.RYANOS_CODEX_BRIDGE_URL
      };
      if (env.RYANOS_CODEX_BRIDGE_TOKEN) {
        bridgeOptions.bridgeToken = env.RYANOS_CODEX_BRIDGE_TOKEN;
      }
      if (env.RYANOS_CODEX_TIMEOUT_MS) {
        bridgeOptions.timeoutMs = Number.parseInt(env.RYANOS_CODEX_TIMEOUT_MS, 10);
      }
      return new CodexLoginBridgeAiProvider(bridgeOptions);
    }
    const options: ConstructorParameters<typeof CodexLoginAiProvider>[0] = {
      codexCommand: env.RYANOS_CODEX_COMMAND || "codex"
    };
    if (env.RYANOS_CODEX_WORKDIR) {
      options.workdir = env.RYANOS_CODEX_WORKDIR;
    }
    if (env.RYANOS_CODEX_TIMEOUT_MS) {
      options.timeoutMs = Number.parseInt(env.RYANOS_CODEX_TIMEOUT_MS, 10);
    }
    return new CodexLoginAiProvider(options);
  }
  if (mode === "openai-responses-api") {
    return new SetupRequiredAiProvider(
      mode,
      {
        id: "openai-api-approval",
        title: "Approve OpenAI API provider setup",
        blocking: true,
        instructions: [
          "RyanOS will not use OpenAI API billing unless you explicitly approve it and provide an API key.",
          "If you want this provider, set `OPENAI_API_KEY` in the runtime environment and confirm API usage is acceptable."
        ],
        docs: ["https://developers.openai.com/api/docs/libraries"]
      },
      "OpenAI API mode is intentionally opt-in because the preferred provider is Codex login."
    );
  }
  if (mode === "local-llm") {
    return new SetupRequiredAiProvider(mode, {
      id: "local-llm-provider",
      title: "Configure local LLM provider",
      blocking: true,
      instructions: [
        "Choose the local model runtime and endpoint before enabling `local-llm`.",
        "RyanOS needs a structured-output compatible endpoint before this provider can interpret messages."
      ]
    });
  }
  return new NoopAiProvider();
}
