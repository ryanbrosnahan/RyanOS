import type {
  AiProvider,
  AiProviderStatus,
  AiProviderResult,
  IncomingMessage,
  PublicToolDefinition
} from "./index.js";

export type IntentEvalExpectedToolCall = {
  name: string;
  inputContains?: Record<string, unknown>;
};

export type IntentEvalCase = {
  id: string;
  message: IncomingMessage;
  expectedToolCalls?: IntentEvalExpectedToolCall[];
  expectedSetupRequired?: boolean;
};

export type IntentEvalCaseResult = {
  id: string;
  passed: boolean;
  errors: string[];
  providerResult: AiProviderResult;
};

export type IntentEvalSuiteResult = {
  passed: boolean;
  cases: IntentEvalCaseResult[];
};

function hasExpectedInput(actual: unknown, expected: Record<string, unknown>): boolean {
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
  const actualRecord = actual as Record<string, unknown>;
  return Object.entries(expected).every(([key, value]) => actualRecord[key] === value);
}

export async function runIntentEvalCase(input: {
  provider: AiProvider;
  tools: PublicToolDefinition[];
  evalCase: IntentEvalCase;
}): Promise<IntentEvalCaseResult> {
  const result = await input.provider.interpret(input.evalCase.message, input.tools);
  const errors: string[] = [];

  if (
    input.evalCase.expectedSetupRequired !== undefined &&
    Boolean(result.setupRequired) !== input.evalCase.expectedSetupRequired
  ) {
    errors.push(
      `Expected setupRequired=${input.evalCase.expectedSetupRequired}, got ${Boolean(result.setupRequired)}`
    );
  }

  const expectedToolCalls = input.evalCase.expectedToolCalls ?? [];
  for (const expected of expectedToolCalls) {
    const actual = result.toolCalls.find((toolCall) => toolCall.name === expected.name);
    if (!actual) {
      errors.push(`Expected tool call ${expected.name}, but it was not returned.`);
      continue;
    }
    if (expected.inputContains && !hasExpectedInput(actual.input, expected.inputContains)) {
      errors.push(`Tool call ${expected.name} did not include expected input fields.`);
    }
  }

  return {
    id: input.evalCase.id,
    passed: errors.length === 0,
    errors,
    providerResult: result
  };
}

export async function runIntentEvalSuite(input: {
  provider: AiProvider;
  tools: PublicToolDefinition[];
  cases: IntentEvalCase[];
}): Promise<IntentEvalSuiteResult> {
  const cases: IntentEvalCaseResult[] = [];
  for (const evalCase of input.cases) {
    cases.push(
      await runIntentEvalCase({
        provider: input.provider,
        tools: input.tools,
        evalCase
      })
    );
  }

  return {
    passed: cases.every((evalCase) => evalCase.passed),
    cases
  };
}

export class ScriptedAiProvider implements AiProvider {
  readonly name = "scripted";
  readonly mode = "none";

  constructor(
    private readonly scripts: Array<{
      matchText: string;
      result: AiProviderResult;
    }>
  ) {}

  async getStatus(): Promise<AiProviderStatus> {
    return {
      name: this.name,
      mode: this.mode,
      ready: true,
      setupRequired: false,
      setupActions: [],
      warnings: ["Scripted provider is for deterministic evals only."]
    };
  }

  async interpret(message: IncomingMessage): Promise<AiProviderResult> {
    const script = this.scripts.find((candidate) => candidate.matchText === message.text);
    return script?.result ?? {
      text: "No scripted result matched this message.",
      toolCalls: []
    };
  }
}
