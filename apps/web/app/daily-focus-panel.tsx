"use client";

import { Check, Loader2, RefreshCw, Target } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type ScopeLabel = {
  id: string;
  name: string;
};

type FocusItem = {
  id: string;
  kind: string;
  title: string;
  status: string;
  priority: string;
  dueAt?: string;
  scope?: {
    area?: ScopeLabel;
    project?: ScopeLabel;
  };
  completion?: {
    completedToday: boolean;
  };
};

type DailyPlanPayload = {
  date: string;
  timezone: string;
  prompt: string;
  plan: {
    id?: string;
    response: string;
    successCriteria: string[];
    selectedItemIds: string[];
    suggestedItemIds: string[];
    suggestionSource: "ai" | "heuristic" | "user";
    status: string;
    updatedAt?: string;
  };
  suggestedItems: FocusItem[];
  selectedItems: FocusItem[];
  dueItems: FocusItem[];
  items: FocusItem[];
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4100";

function formatPlanDate(dateKey: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric"
  }).format(new Date(`${dateKey}T12:00:00.000Z`));
}

function formatDue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

function criteriaFromResponse(response: string): string[] {
  return response
    .split(/\n+/)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 5);
}

function scopeText(item: FocusItem): string {
  return [item.scope?.area?.name, item.scope?.project?.name].filter(Boolean).join(" / ");
}

function itemMeta(item: FocusItem): string {
  return [scopeText(item), item.kind, item.priority].filter(Boolean).join(" / ");
}

export function DailyFocusPanel() {
  const [payload, setPayload] = useState<DailyPlanPayload | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const suggestionAttemptedRef = useRef(false);
  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago",
    []
  );

  function applyPayload(nextPayload: DailyPlanPayload) {
    setPayload(nextPayload);
    setSelectedItemIds(
      nextPayload.plan.selectedItemIds.length > 0
        ? nextPayload.plan.selectedItemIds.slice(0, 3)
        : nextPayload.suggestedItems.map((item) => item.id).slice(0, 3)
    );
    setResponse(nextPayload.plan.response ?? "");
  }

  async function loadPlan(options?: { background?: boolean }) {
    if (!options?.background) setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        userId: "local-owner",
        timezone
      });
      const response = await fetch(`${apiUrl}/v1/daily-plan?${params.toString()}`, {
        cache: "no-store"
      });
      if (!response.ok) throw new Error(`Daily plan returned ${response.status}`);
      applyPayload((await response.json()) as DailyPlanPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function refreshSuggestion(options?: { background?: boolean }) {
    if (!options?.background) setSuggesting(true);
    setError(null);
    try {
      const response = await fetch(`${apiUrl}/v1/daily-plan/suggest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          userId: "local-owner",
          timezone
        })
      });
      if (!response.ok) throw new Error(`Daily suggestion returned ${response.status}`);
      applyPayload((await response.json()) as DailyPlanPayload);
    } catch (err) {
      if (!options?.background) setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSuggesting(false);
    }
  }

  async function savePlan() {
    if (!payload || saving) return;
    setSaving(true);
    setError(null);
    try {
      const saveResponse = await fetch(`${apiUrl}/v1/daily-plan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          userId: "local-owner",
          timezone,
          date: payload.date,
          response,
          successCriteria: criteriaFromResponse(response),
          selectedItemIds
        })
      });
      if (!saveResponse.ok) throw new Error(`Daily plan save returned ${saveResponse.status}`);
      applyPayload((await saveResponse.json()) as DailyPlanPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function toggleItem(itemId: string) {
    setSelectedItemIds((current) => {
      if (current.includes(itemId)) return current.filter((id) => id !== itemId);
      if (current.length >= 3) {
        setError("Pick up to 3 focus items.");
        return current;
      }
      setError(null);
      return [...current, itemId];
    });
  }

  useEffect(() => {
    void loadPlan();
  }, []);

  useEffect(() => {
    if (!payload || suggestionAttemptedRef.current) return;
    if (payload.plan.suggestionSource === "ai" || payload.plan.suggestionSource === "user") return;
    const storageKey = `ryanos:daily-plan-suggested:${payload.date}`;
    if (window.sessionStorage.getItem(storageKey)) return;
    window.sessionStorage.setItem(storageKey, "true");
    suggestionAttemptedRef.current = true;
    void refreshSuggestion({ background: true });
  }, [payload?.date, payload?.plan.suggestionSource]);

  const focusItems = useMemo(() => {
    if (!payload) return [];
    const byId = new Map(payload.items.map((item) => [item.id, item]));
    return selectedItemIds.map((id) => byId.get(id)).filter((item): item is FocusItem => item !== undefined);
  }, [payload, selectedItemIds]);

  const candidateItems = useMemo(() => {
    if (!payload) return [];
    const ids = new Set([...selectedItemIds, ...payload.plan.suggestedItemIds]);
    return payload.items.filter((item) => ids.has(item.id)).slice(0, 6);
  }, [payload, selectedItemIds]);

  if (loading && !payload) {
    return (
      <section className="rounded-md border border-stone-300 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 text-sm text-stone-600">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading today...
        </div>
      </section>
    );
  }

  if (!payload) return null;

  return (
    <section className="rounded-md border border-stone-300 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5 text-sky-700" aria-hidden="true" />
            <p className="text-sm font-medium text-stone-600">{formatPlanDate(payload.date)}</p>
          </div>
          <h2 className="mt-2 max-w-3xl text-2xl font-semibold tracking-normal text-stone-950">
            {payload.prompt}
          </h2>
        </div>
        <button
          type="button"
          onClick={() => void refreshSuggestion()}
          disabled={suggesting}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-stone-300 text-stone-700 hover:bg-stone-100 disabled:cursor-wait disabled:opacity-60"
          aria-label="Refresh focus suggestions"
          title="Refresh focus suggestions"
        >
          <RefreshCw className={`h-4 w-4 ${suggesting ? "animate-spin" : ""}`} aria-hidden="true" />
        </button>
      </div>

      {error ? <p className="mt-3 text-sm leading-6 text-rose-700">{error}</p> : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_0.9fr]">
        <div>
          <h3 className="text-sm font-semibold text-stone-950">Today's focus</h3>
          <div className="mt-2 divide-y divide-sky-100 rounded-md bg-sky-50">
            {focusItems.length > 0 ? (
              focusItems.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggleItem(item.id)}
                  className="flex w-full items-start gap-3 px-3 py-3 text-left hover:bg-sky-100"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-sky-900 ring-1 ring-sky-200">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-stone-950">{item.title}</span>
                    <span className="mt-1 block text-xs text-stone-600">{itemMeta(item)}</span>
                  </span>
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
                </button>
              ))
            ) : (
              <p className="px-3 py-3 text-sm leading-6 text-stone-600">No focus items selected.</p>
            )}
          </div>

          {candidateItems.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {candidateItems.map((item) => {
                const selected = selectedItemIds.includes(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggleItem(item.id)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium ring-1 ${
                      selected
                        ? "bg-sky-100 text-sky-900 ring-sky-200"
                        : "bg-white text-stone-700 ring-stone-200 hover:bg-stone-50"
                    }`}
                  >
                    {item.title}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        <div>
          <label htmlFor="daily-focus-response" className="text-sm font-semibold text-stone-950">
            Your answer
          </label>
          <textarea
            id="daily-focus-response"
            value={response}
            onChange={(event) => setResponse(event.target.value)}
            className="mt-2 min-h-32 w-full resize-y rounded-md border border-stone-300 bg-white px-3 py-2 text-sm leading-6 text-stone-950 outline-none focus:border-sky-700 focus:ring-2 focus:ring-sky-100"
            placeholder="Write 1-3 outcomes..."
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={() => void savePlan()}
              disabled={saving}
              className="inline-flex h-9 items-center justify-center rounded-md border border-sky-700 bg-sky-700 px-3 text-sm font-medium text-white hover:bg-sky-800 disabled:cursor-wait disabled:border-stone-300 disabled:bg-stone-200 disabled:text-stone-500"
            >
              {saving ? "Saving..." : "Save focus"}
            </button>
          </div>
        </div>
      </div>

      {payload.dueItems.length > 0 ? (
        <div className="mt-5 border-t border-stone-200 pt-4">
          <h3 className="text-sm font-semibold text-stone-950">Due or active today</h3>
          <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {payload.dueItems.slice(0, 9).map((item) => {
              const selected = selectedItemIds.includes(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggleItem(item.id)}
                  className={`flex min-h-16 items-start justify-between gap-3 rounded-md px-3 py-2 text-left ring-1 ${
                    selected
                      ? "bg-sky-50 ring-sky-200"
                      : "bg-stone-50 ring-stone-200 hover:bg-stone-100"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-stone-950">{item.title}</span>
                    <span className="mt-1 block truncate text-xs text-stone-600">{itemMeta(item)}</span>
                  </span>
                  <span className="shrink-0 text-xs font-medium text-stone-500">
                    {item.completion?.completedToday ? "Done" : formatDue(item.dueAt) ?? "Today"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
