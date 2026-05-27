#!/usr/bin/env node
import { existsSync } from "node:fs";
import http from "node:http";
import {
  CodexLoginAiProvider,
  type IncomingMessage,
  type PublicToolDefinition
} from "./index.js";

const defaultAppCodex = "/Applications/Codex.app/Contents/Resources/codex";

function defaultCodexCommand(): string {
  if (existsSync(defaultAppCodex)) return defaultAppCodex;
  return "codex";
}

function readJsonBody(request: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw.trim().length === 0 ? {} : JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response: http.ServerResponse, statusCode: number, body: unknown) {
  response.writeHead(statusCode, {
    "content-type": "application/json"
  });
  response.end(JSON.stringify(body));
}

function asInterpretInput(body: unknown): {
  message: IncomingMessage;
  tools: PublicToolDefinition[];
} {
  if (!body || typeof body !== "object") {
    throw new Error("Expected JSON object body.");
  }
  const record = body as Record<string, unknown>;
  if (!record.message || typeof record.message !== "object") {
    throw new Error("Expected `message` object.");
  }
  if (!Array.isArray(record.tools)) {
    throw new Error("Expected `tools` array.");
  }
  return {
    message: record.message as IncomingMessage,
    tools: record.tools as PublicToolDefinition[]
  };
}

const host = process.env.RYANOS_CODEX_BRIDGE_HOST || "127.0.0.1";
const port = Number(process.env.RYANOS_CODEX_BRIDGE_PORT || "4111");
const bridgeToken = process.env.RYANOS_CODEX_BRIDGE_TOKEN?.trim();
const provider = new CodexLoginAiProvider({
  codexCommand: process.env.RYANOS_CODEX_COMMAND || defaultCodexCommand(),
  workdir: process.env.RYANOS_CODEX_WORKDIR || process.cwd(),
  timeoutMs: Number(process.env.RYANOS_CODEX_TIMEOUT_MS || "60000")
});

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, { status: "ok" });
      return;
    }
    if (bridgeToken) {
      const expected = `Bearer ${bridgeToken}`;
      if (request.headers.authorization !== expected) {
        sendJson(response, 401, { error: "unauthorized" });
        return;
      }
    }
    if (request.method === "GET" && request.url === "/status") {
      sendJson(response, 200, await provider.getStatus());
      return;
    }
    if (request.method === "POST" && request.url === "/interpret") {
      const input = asInterpretInput(await readJsonBody(request));
      sendJson(response, 200, await provider.interpret(input.message, input.tools));
      return;
    }
    sendJson(response, 404, { error: "not_found" });
  } catch (err) {
    sendJson(response, 500, {
      error: err instanceof Error ? err.message : String(err)
    });
  }
});

server.listen(port, host, () => {
  console.log(`RyanOS Codex bridge listening on http://${host}:${port}`);
  if (!bridgeToken) {
    console.warn("RYANOS_CODEX_BRIDGE_TOKEN is not set; bridge status/interpret endpoints are unauthenticated.");
  }
});
