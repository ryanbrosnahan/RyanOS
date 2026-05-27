# AI Provider Risk Review

Date: 2026-05-27

## Decision Context

RyanOS should be AI-first at the message layer, but not AI-authoritative at the
state layer. The assistant should interpret natural language, choose typed tools,
draft messages, summarize sources, and propose plans. Deterministic code should
own validation, permissions, recurrence, idempotency, audit logging, and external
side effects.

The accepted personal-deployment direction is to use a ChatGPT/Codex-login
bridge as the preferred AI provider, similar in spirit to `dcramer/ash`.

RyanOS should still keep provider modes behind one abstraction so the core app
does not depend on one authentication/runtime trick. That abstraction is a
safety and portability boundary, not a statement that the Codex-login bridge is
temporary.

## Research Summary

OpenAI's current guidance points toward structured tool use, strict tool
descriptions, guardrails, human review for sensitive actions, tracing, state
management, and sandboxing:

- Codex security is based on sandbox mode plus approval policy. Codex CLI/IDE
  defaults restrict writes to the active workspace and disable network access,
  with configurable sandbox and approval settings.
- `codex exec` supports non-interactive runs, JSONL output, and structured
  output schemas, but OpenAI recommends API keys for most automation. ChatGPT
  managed auth in CI/CD is documented as advanced, trusted-private automation.
- For new agentic application systems where the server owns orchestration,
  tools, state, and approvals, OpenAI points to the Agents SDK and Responses API
  patterns.
- OpenAI's tool guidance says tool descriptions should carry operational details
  such as what the tool does, when to use it, required inputs, side effects,
  retry safety, and common error modes.
- OpenAI's guardrail guidance separates automatic checks from human review and
  says side-effecting actions should pause for approval when sensitive.

External security guidance is even more conservative:

- OWASP's LLM Top 10 highlights prompt injection, sensitive information
  disclosure, vector/embedding weaknesses, unbounded consumption, and especially
  excessive agency: excessive functionality, excessive permissions, or excessive
  autonomy.
- OWASP mitigation guidance for excessive agency maps directly to RyanOS:
  minimize tools, minimize tool functionality, avoid open-ended tools, minimize
  permissions, execute in user context, require user approval for high-impact
  actions, enforce downstream authorization, and log/rate-limit tool activity.
- NIST's Generative AI Profile frames risk by lifecycle, use case, and system
  context, and calls out confabulation, data privacy, information security,
  value chain/component integration, and human-AI configuration.
- Joint Five Eyes agentic AI guidance recommends never granting broad or
  unrestricted access, focusing on low-risk/non-sensitive tasks, least privilege,
  controlled context, human control points, identity management, defense in
  depth, red teaming, rollback, audit logs, and continuous monitoring.

`dcramer/ash` is useful inspiration, especially for:

- provider-normalized incoming messages;
- an agent loop that passes raw user text plus gathered context to the model;
- typed tool definitions and a tool executor;
- sanitized tool output before feeding it back to the model;
- memory extraction in a separate postprocess flow with secret detection;
- Telegram passive/active routing;
- sandboxed tool execution;
- isolated skills/subagents with explicit allowed tools and capability preflight.

RyanOS should borrow these patterns but keep its own stricter domain boundary:
task state, recurrence, permissions, and external actions should remain in
typed domain tools, not open-ended shell skills.

## Recommendation

Use a provider abstraction with explicit modes:

1. `none`: deterministic tool handlers and canned responses only. This remains
   the safe boot mode and test mode.
2. `codex-login`: preferred personal/local provider. Use ChatGPT/Codex-managed
   auth where feasible to avoid separate API billing, while constraining it
   behind the same schema, permission, timeout, and audit boundaries as any
   other provider.
3. `openai-responses-api`: optional production-grade provider only when the user
   explicitly approves API billing. Prefer Responses API/Agents SDK patterns for
   structured output, tool calling, guardrails, tracing, and resumable state.
4. `local-llm`: future provider for privacy/cost experiments, expected to have
   lower reasoning/tool reliability until evaluated.

Do not make the Codex bridge the core application trust root. It may be the
long-term default provider for this deployment, but RyanOS should behave as if
providers are untrusted intent interpreters. The trusted boundary is the typed
tool contract plus deterministic handlers.

## Codex Bridge Guardrails

The Codex-login provider should be constrained as follows:

- Run only from a dedicated empty workspace or read-only workspace.
- Use the least sandbox permissions possible.
- Disable network unless the provider cannot function without it.
- Do not mount RyanOS secrets, database sockets, Docker sockets, SSH keys,
  browser profiles, or private project directories.
- Require strict JSON final output matching RyanOS's tool-call schema.
- Validate all output through JSON schema before any handler sees it.
- Never let the bridge mutate the database, send external messages, write skills,
  run shell commands against RyanOS, or grant itself capabilities.
- Apply timeouts, retry limits, max tool-call limits, and provider health checks.
- Log provider prompts, schema outputs, rejected outputs, and latency in the
  audit trail, subject to retention policy.
- Fall back to `none` mode when the bridge fails or returns invalid output.

## Required Controls

These controls should exist before enabling any real AI provider:

- Human setup boundaries are explicit. If RyanOS needs Codex login, connector
  auth, a bot token, API billing approval, or an OAuth callback/code, it asks
  the user for that specific action and waits.
- Tool metadata includes side-effect class, confirmation default, retry safety,
  idempotency behavior, required capability, and allowed account scope.
- Every mutating tool validates schema, resolves references, checks permissions,
  enforces recurrence/minimum intervals, derives idempotency, writes domain
  events, and writes audit logs.
- Prompt-injection defenses treat email, web pages, Slack, RFPs, documents, and
  tool output as untrusted data.
- Tool results passed back to AI are wrapped with provenance and can be
  redacted, truncated, or blocked.
- Sensitive actions require confirmation outside the model: send, delete,
  purchase, pay, commit, deploy, publish, grant capability, connect account,
  override health/finance safety rules.
- Generated skills are proposals until approved. Skills cannot request raw
  secrets by environment name; they must use host capabilities.
- All external account access is modeled through provider accounts and grants,
  not global credentials.
- Evals cover common user utterances, adversarial source content, ambiguity,
  duplicate message delivery, and safety refusals.

## Top Risks For RyanOS

- Prompt injection from email, web pages, documents, Slack, and RFP text.
- Excessive agency from broad Gmail, calendar, shell, browser, database, or
  notification powers.
- Multi-account mistakes, such as reading or drafting against the wrong Google
  account.
- Silent state corruption from fuzzy entity resolution.
- Duplicate nags or duplicated completion events from retries.
- Health/medication interval mistakes.
- Leaking secrets or private content into logs, memory, prompts, or skill files.
- Runaway loops, cost spikes, and unbounded tool/API consumption.
- Generated skills introducing supply-chain or command-execution risk.
- Lost accountability if AI reasoning, tool calls, and state mutations cannot be
  reconstructed later.

## Next Implementation Steps

1. Add provider mode configuration and keep `none` as the default.
2. Add setup-status plumbing for Codex login and connector readiness.
3. Add an AI intent eval harness before enabling live autonomous use.
4. Extend tool contracts with side-effect, confirmation, and retry-safety
   metadata.
5. Add a tool-output trust wrapper inspired by Ash before using source text in
   iterative agent loops.
6. Add the Codex-login provider as the first real AI provider, but keep it behind
   the same schema validation, audit, and permission boundary from day one.

## Sources

- OpenAI Codex sandbox and approvals:
  https://developers.openai.com/codex/agent-approvals-security#sandbox-and-approvals
- OpenAI Codex non-interactive mode:
  https://developers.openai.com/codex/noninteractive
- OpenAI Codex authentication:
  https://developers.openai.com/codex/auth#openai-authentication
- OpenAI Codex account auth in CI/CD:
  https://developers.openai.com/codex/auth/ci-cd-auth
- OpenAI tools guide:
  https://developers.openai.com/api/docs/guides/tools
- OpenAI latest-model guidance:
  https://developers.openai.com/api/docs/guides/latest-model#using-reasoning-models
- OpenAI Agents SDK:
  https://developers.openai.com/api/docs/guides/agents
- OpenAI guardrails and human review:
  https://developers.openai.com/api/docs/guides/agents/guardrails-approvals
- OWASP LLM Top 10 2025:
  https://genai.owasp.org/llm-top-10/
- OWASP LLM01 prompt injection:
  https://genai.owasp.org/llmrisk/llm01-prompt-injection/
- OWASP LLM06 excessive agency:
  https://genai.owasp.org/llmrisk/llm062025-excessive-agency/
- NIST AI RMF:
  https://www.nist.gov/itl/ai-risk-management-framework
- NIST Generative AI Profile:
  https://doi.org/10.6028/NIST.AI.600-1
- Five Eyes careful adoption of agentic AI services:
  https://www.ncsc.govt.nz/protect-your-organisation/careful-adoption-of-agentic-ai-services/
- `dcramer/ash`:
  https://github.com/dcramer/ash
