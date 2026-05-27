"use client";

import { Check, CheckCircle2, ChevronDown, Loader2, MessageSquare, RefreshCw, Target } from "lucide-react";
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

function scopeText(item: FocusItem): string {
  return [item.scope?.area?.name, item.scope?.project?.name].filter(Boolean).join(" / ");
}

function itemMeta(item: FocusItem): string {
  return [scopeText(item), item.kind, item.priority].filter(Boolean).join(" / ");
}

function focusStatus(item: FocusItem): string {
  if (item.completion?.completedToday) return "Done";
  return formatDue(item.dueAt) ?? (item.status === "waiting" ? "Waiting" : "Open");
}

export function DailyFocusPanel() {
  const [payload, setPayload] = useState<DailyPlanPayload | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingSelection, setSavingSelection] = useState(false);
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
      if (!options?.background) setError(err instanceof Error ? err.message : String(err));
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

  async function saveSelection(nextSelectedItemIds: string[]) {
    if (!payload || savingSelection) return;
    setSavingSelection(true);
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
          response: payload.plan.response,
          successCriteria: payload.plan.successCriteria,
          selectedItemIds: nextSelectedItemIds
        })
      });
      if (!saveResponse.ok) throw new Error(`Daily plan save returned ${saveResponse.status}`);
      applyPayload((await saveResponse.json()) as DailyPlanPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingSelection(false);
    }
  }

  function toggleItem(itemId: string) {
    const nextSelectedItemIds = selectedItemIds.includes(itemId)
      ? selectedItemIds.filter((id) => id !== itemId)
      : selectedItemIds.length >= 3
        ? selectedItemIds
        : [...selectedItemIds, itemId];

    if (nextSelectedItemIds === selectedItemIds) {
      setError("Pick up to 3 focus items.");
      return;
    }

    setError(null);
    setSelectedItemIds(nextSelectedItemIds);
    void saveSelection(nextSelectedItemIds);
  }

  function startChatAnswer() {
    window.dispatchEvent(
      new CustomEvent("ryanos:chat-prefill", {
        detail: { text: "For today's focus: " }
      })
    );
    document.getElementById("assistant-intake")?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }

  useEffect(() => {
    void loadPlan();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadPlan({ background: true });
      }
    }, 30000);
    return () => window.clearInterval(interval);
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
    const ids = new Set([
      ...selectedItemIds,
      ...payload.plan.suggestedItemIds,
      ...payload.dueItems.map((item) => item.id)
    ]);
    return payload.items.filter((item) => ids.has(item.id)).slice(0, 8);
  }, [payload, selectedItemIds]);

  const remainingDueItems = useMemo(() => {
    if (!payload) return [];
    return payload.dueItems.filter((item) => !selectedItemIds.includes(item.id)).slice(0, 6);
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
    <section className="overflow-hidden rounded-md border border-stone-300 bg-white shadow-sm">
      <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-stone-600">
            <Target className="h-4 w-4 text-sky-700" aria-hidden="true" />
            <span>{formatPlanDate(payload.date)}</span>
          </div>
          <h2 className="mt-1 text-2xl font-semibold tracking-normal text-stone-950">
            Today's focus
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-stone-700">{payload.prompt}</p>

          {payload.plan.response.trim().length > 0 ? (
            <div className="mt-3 max-w-3xl border-l-2 border-sky-700 pl-3">
              <p className="text-xs font-medium text-stone-500">Today's answer</p>
              <p className="mt-1 text-sm leading-6 text-stone-700">{payload.plan.response}</p>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2 lg:justify-end">
          <button
            type="button"
            onClick={startChatAnswer}
            className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-md border border-sky-700 bg-sky-700 px-3 text-sm font-medium text-white hover:bg-sky-800 sm:flex-none"
          >
            <MessageSquare className="h-4 w-4" aria-hidden="true" />
            Answer in chat
          </button>
          <button
            type="button"
            onClick={() => void refreshSuggestion()}
            disabled={suggesting}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-stone-300 text-stone-700 hover:bg-stone-100 disabled:cursor-wait disabled:opacity-60"
            aria-label="Refresh focus suggestions"
            title="Refresh focus suggestions"
          >
            <RefreshCw
              className={`h-4 w-4 ${suggesting ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
          </button>
        </div>
      </div>

      {error ? <p className="px-4 pb-3 text-sm leading-6 text-rose-700 sm:px-5">{error}</p> : null}

      <div className="border-t border-stone-200 px-4 py-4 sm:px-5">
        <div className="grid gap-3 lg:grid-cols-3">
          {focusItems.length > 0 ? (
            focusItems.map((item, index) => {
              const completed = item.completion?.completedToday;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggleItem(item.id)}
                  disabled={savingSelection}
                  className={`flex min-h-28 flex-col rounded-md p-3 text-left ring-1 transition disabled:cursor-wait disabled:opacity-70 ${
                    completed
                      ? "bg-emerald-50 ring-emerald-200"
                      : "bg-sky-50 ring-sky-200 hover:bg-sky-100"
                  }`}
                >
                  <span className="flex items-start gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-sky-900 ring-1 ring-sky-200">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold leading-5 text-stone-950">
                        {item.title}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-stone-600">
                        {itemMeta(item)}
                      </span>
                    </span>
                    {completed ? (
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
                    ) : (
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-sky-800 ring-1 ring-sky-300">
                        <Check className="h-3 w-3" aria-hidden="true" />
                      </span>
                    )}
                  </span>
                  <span className="mt-auto pt-3">
                    <span
                      className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ring-1 ${
                        completed
                          ? "bg-emerald-100 text-emerald-800 ring-emerald-200"
                          : "bg-white text-stone-700 ring-stone-200"
                      }`}
                    >
                      {focusStatus(item)}
                    </span>
                  </span>
                </button>
              );
            })
          ) : (
            <div className="rounded-md border border-dashed border-stone-300 bg-stone-50 p-3 text-sm leading-6 text-stone-600 lg:col-span-3">
              No focus items selected yet.
            </div>
          )}
        </div>

        {candidateItems.length > 0 ? (
          <details className="group mt-4">
            <summary className="inline-flex h-8 cursor-pointer list-none items-center gap-1 rounded-md border border-stone-300 bg-white px-2.5 text-xs font-medium text-stone-700 hover:bg-stone-50">
              Adjust focus
              <ChevronDown
                className="h-3.5 w-3.5 transition group-open:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <div className="mt-2 flex flex-wrap gap-2">
              {candidateItems.map((item) => {
                const selected = selectedItemIds.includes(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggleItem(item.id)}
                    disabled={savingSelection}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium ring-1 transition disabled:cursor-wait disabled:opacity-70 ${
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
          </details>
        ) : null}
      </div>

      {remainingDueItems.length > 0 ? (
        <div className="border-t border-stone-200 px-4 py-4 sm:px-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-stone-950">Still on deck today</h3>
            <span className="text-xs font-medium text-stone-500">{remainingDueItems.length}</span>
          </div>
          <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {remainingDueItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => toggleItem(item.id)}
                disabled={savingSelection}
                className="flex min-h-14 items-start justify-between gap-3 rounded-md bg-stone-50 px-3 py-2 text-left ring-1 ring-stone-200 transition hover:bg-stone-100 disabled:cursor-wait disabled:opacity-70"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-stone-950">{item.title}</span>
                  <span className="mt-1 block truncate text-xs text-stone-600">{itemMeta(item)}</span>
                </span>
                <span className="shrink-0 text-xs font-medium text-stone-500">{focusStatus(item)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
