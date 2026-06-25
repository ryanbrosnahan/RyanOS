"use client";

import {
  Brain,
  EyeOff,
  Gauge,
  Loader2,
  RefreshCw
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { apiFetch, apiPath } from "./api-client";

type AiSmokeResponse = {
  ok: boolean;
  latencyMs: number;
  status: {
    name: string;
    ready: boolean;
    warnings: string[];
  };
  interpreted: {
    text?: string;
    toolCalls: Array<{ name: string }>;
    warnings?: string[];
  };
};

type DebugItem = {
  id: string;
  title: string;
  status: string;
  kind: string;
  priority: string;
  priorityScore: number;
  prioritySignals: string[];
  hiddenUntil?: string;
  dueAt?: string;
  recurrence?: {
    state?: {
      nextDueAt?: string;
      lastCompletedAt?: string;
    };
  };
};

type ItemsResponse = {
  date: string;
  timezone: string;
  items: DebugItem[];
};

function formatShortDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

function smokeWarnings(smoke: AiSmokeResponse): string[] {
  return [...new Set([...smoke.status.warnings, ...(smoke.interpreted.warnings ?? [])])];
}

function ItemScoreRow({ item }: { item: DebugItem }) {
  const nextDue = formatShortDate(item.recurrence?.state?.nextDueAt ?? item.dueAt);
  return (
    <div className="grid gap-2 border-t border-stone-200 py-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="truncate text-sm font-semibold text-stone-950">{item.title}</p>
          {item.hiddenUntil ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">
              <EyeOff className="h-3 w-3" aria-hidden="true" />
              Hidden until {item.hiddenUntil}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-stone-600">
          {[item.kind, item.priority, item.status, nextDue ? `next ${nextDue}` : undefined]
            .filter(Boolean)
            .join(" / ")}
        </p>
        {item.prioritySignals.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {item.prioritySignals.map((signal) => (
              <span
                key={signal}
                className="rounded-md bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700"
              >
                {signal}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="inline-flex h-8 items-center gap-1 rounded-md bg-stone-100 px-2 text-sm font-semibold text-stone-800 sm:justify-self-end">
        <Gauge className="h-4 w-4" aria-hidden="true" />
        {item.priorityScore}
      </div>
    </div>
  );
}

export function AiDiagnosticsPanel() {
  const [smoke, setSmoke] = useState<AiSmokeResponse | null>(null);
  const [loadingSmoke, setLoadingSmoke] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runSmoke() {
    setLoadingSmoke(true);
    setError(null);
    try {
      const response = await apiFetch(apiPath("/v1/ai/smoke"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({})
      });
      const payload = (await response.json()) as AiSmokeResponse;
      setSmoke(payload);
      if (!response.ok) throw new Error(payload.interpreted.text ?? `AI smoke returned ${response.status}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingSmoke(false);
    }
  }

  return (
    <div className="rounded-md border border-stone-300 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-sky-700" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-stone-950">Assistant diagnostics</h2>
        </div>
        <button
          type="button"
          onClick={runSmoke}
          disabled={loadingSmoke}
          className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-stone-300 px-2 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:cursor-wait disabled:opacity-60"
        >
          {loadingSmoke ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
          Smoke
        </button>
      </div>

      {error ? <p className="mt-3 text-sm leading-6 text-rose-700">{error}</p> : null}

      {smoke ? (
        <div className="mt-4 border-t border-stone-200 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-md px-2 py-1 text-xs font-semibold ${smoke.ok ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
              {smoke.ok ? "Bridge OK" : "Needs attention"}
            </span>
            <span className="text-xs font-medium text-stone-500">{smoke.status.name}</span>
            <span className="text-xs font-medium text-stone-500">{smoke.latencyMs}ms</span>
          </div>
          {smoke.interpreted.text ? (
            <p className="mt-2 text-sm leading-6 text-stone-700">{smoke.interpreted.text}</p>
          ) : null}
          {smokeWarnings(smoke).length > 0 ? (
            <ul className="mt-2 space-y-1 text-xs leading-5 text-stone-600">
              {smokeWarnings(smoke).map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

    </div>
  );
}

export function AttentionDebugPanel() {
  const [payload, setPayload] = useState<ItemsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago",
    []
  );

  async function loadItems(options?: { background?: boolean }) {
    if (!options?.background) setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        status: "open,active,waiting",
        includeDoneToday: "true",
        includeHidden: "true",
        timezone,
        limit: "100"
      });
      const response = await apiFetch(apiPath(`/v1/items?${params.toString()}`), {
        cache: "no-store"
      });
      if (!response.ok) throw new Error(`Attention debug returned ${response.status}`);
      setPayload((await response.json()) as ItemsResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadItems();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadItems({ background: true });
      }
    }, 30000);
    return () => window.clearInterval(interval);
  }, []);

  const hiddenItems = payload?.items.filter((item) => item.hiddenUntil) ?? [];
  const scoredItems = payload?.items ?? [];

  return (
    <div className="rounded-md border border-stone-300 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Gauge className="h-5 w-5 text-sky-700" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-stone-950">Attention scoring</h2>
        </div>
        <button
          type="button"
          onClick={() => void loadItems()}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-stone-300 text-stone-700 hover:bg-stone-100"
          aria-label="Refresh attention scoring"
          title="Refresh attention scoring"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
        </button>
      </div>

      {error ? <p className="mt-3 text-sm leading-6 text-rose-700">{error}</p> : null}
      {!error && loading && !payload ? (
        <p className="mt-3 text-sm leading-6 text-stone-600">Loading scored items...</p>
      ) : null}

      {payload ? (
        <div className="mt-4 space-y-5">
          <section>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-stone-950">Hidden from open items</h3>
              <span className="rounded-md bg-stone-100 px-2 py-1 text-xs font-medium text-stone-700">
                {hiddenItems.length}
              </span>
            </div>
            <div className="mt-2">
              {hiddenItems.length > 0 ? (
                hiddenItems.map((item) => <ItemScoreRow key={item.id} item={item} />)
              ) : (
                <p className="text-sm leading-6 text-stone-600">No hidden recurrence items right now.</p>
              )}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-stone-950">Scored queue</h3>
              <span className="rounded-md bg-stone-100 px-2 py-1 text-xs font-medium text-stone-700">
                {scoredItems.length}
              </span>
            </div>
            <div className="mt-2">
              {scoredItems.slice(0, 12).map((item) => (
                <ItemScoreRow key={item.id} item={item} />
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
