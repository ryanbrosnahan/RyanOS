import { z } from "zod";

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

export type ToolDefinition<TInput = unknown> = {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  handler: (input: TInput) => Promise<ToolResult>;
};

export type PublicToolDefinition = {
  name: string;
  description: string;
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
    return [...this.tools.values()].map(({ name, description }) => ({
      name,
      description
    }));
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
};

export interface AiProvider {
  readonly name: string;
  interpret(message: IncomingMessage, tools: PublicToolDefinition[]): Promise<AiProviderResult>;
}

export class NoopAiProvider implements AiProvider {
  readonly name = "none";

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
