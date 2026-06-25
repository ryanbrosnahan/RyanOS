"use client";

import { Check, CheckCircle2, ChevronDown, Loader2, RefreshCw, Star, Target } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, apiPath } from "./api-client";
import { ItemProgressDetails, ItemProgressSummaryLine } from "./item-progress-details";

type ScopeLabel = {
  id: string;
  name: string;
};

type RecurrenceDay = {
  date: string;
  status: "completed" | "uncompleted" | "skipped" | "missed" | "deferred" | "none";
};

type RecurrenceProgress = {
  policy: {
    minimumIntervalDays?: number;
  };
  week: {
    days: RecurrenceDay[];
  };
  state?: {
    nextEligibleAt?: string;
  };
};

type FocusItem = {
  id: string;
  kind: string;
  title: string;
  status: string;
  starred: boolean;
  starredAt?: string;
  priority: string;
  priorityScore: number;
  prioritySignals: string[];
  progress?: {
    count: number;
    latest?: {
      id: string;
      body: string;
      occurredAt: string;
      createdAt: string;
      updatedAt: string;
    };
  };
  checklist?: {
    total: number;
    completed: number;
  };
  dueAt?: string;
  scope?: {
    area?: ScopeLabel;
    project?: ScopeLabel;
  };
  completion?: {
    completedToday: boolean;
  };
  recurrence?: RecurrenceProgress;
};

type DailyPlanPayload = {
  date: string;
  timezone: string;
  plan: {
    id?: string;
    selectedItemIds: string[];
    suggestedItemIds: string[];
    suggestionSource: "ai" | "heuristic" | "user";
    status: string;
    updatedAt?: string;
  };
  starredItems: FocusItem[];
  suggestedItems: FocusItem[];
  selectedItems: FocusItem[];
  dueItems: FocusItem[];
  items: FocusItem[];
};

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

function candidateTone(item: FocusItem, starred: boolean): string {
  if (starred) return "bg-amber-50 text-amber-950 ring-amber-300 hover:bg-amber-100";
  if (item.priorityScore >= 60) return "bg-amber-50 text-amber-950 ring-amber-200 hover:bg-amber-100";
  if (item.priorityScore >= 30) return "bg-sky-50 text-sky-950 ring-sky-200 hover:bg-sky-100";
  return "bg-white text-stone-700 ring-stone-200 hover:bg-stone-50";
}

function dateKeyInTimeZone(value: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function isEarlyMinimumRecurrenceDate(
  item: FocusItem,
  dateKey: string,
  timeZone: string
): boolean {
  if (item.recurrence?.policy.minimumIntervalDays === undefined) return false;
  const nextEligibleAt = item.recurrence.state?.nextEligibleAt;
  if (nextEligibleAt === undefined) return false;
  return dateKey < dateKeyInTimeZone(nextEligibleAt, timeZone);
}

function completedForDate(item: FocusItem, dateKey: string): boolean {
  if (item.completion?.completedToday) return true;
  return item.recurrence?.week.days.some((day) => day.date === dateKey && day.status === "completed") ?? false;
}

export function DailyFocusPanel() {
  const [payload, setPayload] = useState<DailyPlanPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [suggesting, setSuggesting] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedDetailItemIds, setExpandedDetailItemIds] = useState<Set<string>>(new Set());
  const suggestionAttemptedRef = useRef(false);
  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago",
    []
  );

  function applyPayload(nextPayload: DailyPlanPayload) {
    setPayload(nextPayload);
  }

  function mergeItemIntoPayload(updatedItem: FocusItem) {
    setPayload((current) => {
      if (!current) return current;
      const updateItems = (items: FocusItem[]) =>
        items.map((item) => (item.id === updatedItem.id ? updatedItem : item));
      return {
        ...current,
        starredItems: updateItems(current.starredItems),
        suggestedItems: updateItems(current.suggestedItems),
        selectedItems: updateItems(current.selectedItems),
        dueItems: updateItems(current.dueItems),
        items: updateItems(current.items)
      };
    });
  }

  async function loadPlan(options?: { background?: boolean }) {
    if (!options?.background) setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        timezone
      });
      const response = await apiFetch(apiPath(`/v1/daily-plan?${params.toString()}`), {
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
      const response = await apiFetch(apiPath("/v1/daily-plan/suggest"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
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

  async function toggleStar(item: FocusItem) {
    const key = `${item.id}:star`;
    setPendingKey(key);
    setError(null);
    try {
      const response = await apiFetch(apiPath(`/v1/items/${encodeURIComponent(item.id)}/star`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          timezone,
          starred: !item.starred
        })
      });
      if (!response.ok) throw new Error(`Star update returned ${response.status}`);
      await loadPlan({ background: true });
      window.dispatchEvent(new Event("ryanos-items-refresh"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingKey(null);
    }
  }

  async function completeItem(item: FocusItem) {
    if (!payload || completedForDate(item, payload.date)) return;
    const key = `${item.id}:complete`;
    setPendingKey(key);
    setError(null);
    try {
      const response = item.recurrence
        ? await apiFetch(apiPath(`/v1/items/${encodeURIComponent(item.id)}/recurrence-days/${payload.date}`), {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              completed: true,
              allowEarly: isEarlyMinimumRecurrenceDate(item, payload.date, timezone),
              timezone,
              referenceDate: payload.date
            })
          })
        : await apiFetch(apiPath(`/v1/items/${encodeURIComponent(item.id)}/complete`), {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              completed: true,
              timezone
            })
          });
      if (!response.ok) throw new Error(`Completion returned ${response.status}`);
      await loadPlan({ background: true });
      window.dispatchEvent(new Event("ryanos-items-refresh"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingKey(null);
    }
  }

  useEffect(() => {
    void loadPlan();
    const handleExternalRefresh = () => {
      void loadPlan({ background: true });
    };
    window.addEventListener("ryanos-focus-refresh", handleExternalRefresh);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadPlan({ background: true });
      }
    }, 30000);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("ryanos-focus-refresh", handleExternalRefresh);
    };
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
    return payload?.starredItems ?? [];
  }, [payload]);

  const candidateItems = useMemo(() => {
    if (!payload) return [];
    const ids = new Set<string>();
    const candidates: FocusItem[] = [];
    const include = (item: FocusItem | undefined) => {
      if (!item || ids.has(item.id)) return;
      if (completedForDate(item, payload.date)) return;
      ids.add(item.id);
      candidates.push(item);
    };
    const byId = new Map(payload.items.map((item) => [item.id, item]));
    for (const item of payload.starredItems) include(item);
    for (const itemId of payload.plan.suggestedItemIds) include(byId.get(itemId));
    for (const item of payload.dueItems) include(byId.get(item.id));
    for (const item of payload.items) {
      if (item.status !== "done") include(item);
      if (candidates.length >= 12) break;
    }
    return candidates;
  }, [payload]);

  const remainingDueItems = useMemo(() => {
    if (!payload) return [];
    return payload.dueItems.filter((item) => !item.starred && !completedForDate(item, payload.date)).slice(0, 6);
  }, [payload]);

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
        </div>

        <div className="flex flex-wrap gap-2 lg:justify-end">
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
            focusItems.map((item) => {
              const completed = completedForDate(item, payload.date);
              const completeKey = `${item.id}:complete`;
              const starKey = `${item.id}:star`;
              const detailsExpanded = expandedDetailItemIds.has(item.id);
              return (
                <article
                  key={item.id}
                  className={`flex min-h-28 flex-col rounded-md p-3 text-left ring-1 transition ${
                    completed
                      ? "bg-emerald-50 ring-emerald-200"
                      : "bg-sky-50 ring-sky-200"
                  }`}
                >
                  <span className="flex items-start gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-amber-700 ring-1 ring-amber-200">
                      <Star className="h-4 w-4 fill-current" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold leading-5 text-stone-950">
                        {item.title}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-stone-600">
                        {itemMeta(item)}
                      </span>
                      <span className="mt-1 block">
                        <ItemProgressSummaryLine item={item} />
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void completeItem(item)}
                        disabled={completed || pendingKey === completeKey}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-white text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-50 disabled:cursor-wait disabled:opacity-60"
                        aria-label={`Complete ${item.title}`}
                        title="Complete"
                      >
                        {completed ? (
                          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <Check className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => void toggleStar(item)}
                        disabled={pendingKey === starKey}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-white text-amber-700 ring-1 ring-amber-200 hover:bg-amber-50 disabled:cursor-wait disabled:opacity-60"
                        aria-label={`Unstar ${item.title}`}
                        title="Unstar"
                      >
                        <Star className="h-4 w-4 fill-current" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedDetailItemIds((current) => {
                            const next = new Set(current);
                            if (next.has(item.id)) next.delete(item.id);
                            else next.add(item.id);
                            return next;
                          })
                        }
                        className={`inline-flex h-7 w-7 items-center justify-center rounded-md bg-white text-stone-700 ring-1 ring-stone-200 hover:bg-stone-50 ${
                          detailsExpanded ? "bg-stone-100" : ""
                        }`}
                        aria-label={`${detailsExpanded ? "Hide" : "Show"} progress and checklist for ${item.title}`}
                        aria-expanded={detailsExpanded}
                        title={detailsExpanded ? "Hide details" : "Details"}
                      >
                        <ChevronDown
                          className={`h-4 w-4 transition ${detailsExpanded ? "rotate-180" : ""}`}
                          aria-hidden="true"
                        />
                      </button>
                    </span>
                  </span>
                  {detailsExpanded ? (
                    <ItemProgressDetails
                      item={item}
                      timezone={timezone}
                      onChanged={(updatedItem) => {
                        mergeItemIntoPayload(updatedItem);
                        void loadPlan({ background: true });
                      }}
                    />
                  ) : null}
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
                </article>
              );
            })
          ) : (
            <div className="rounded-md border border-dashed border-stone-300 bg-stone-50 p-3 text-sm leading-6 text-stone-600 lg:col-span-3">
              No starred focus items yet.
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
                const starKey = `${item.id}:star`;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => void toggleStar(item)}
                    disabled={pendingKey === starKey}
                    className={`inline-flex max-w-full items-center gap-2 rounded-md px-2.5 py-1 text-xs font-medium ring-1 transition disabled:cursor-wait disabled:opacity-70 ${candidateTone(item, item.starred)}`}
                    title={`Priority score ${item.priorityScore}: ${item.prioritySignals.join(", ")}`}
                    aria-pressed={item.starred}
                  >
                    <Star className={`h-3.5 w-3.5 shrink-0 ${item.starred ? "fill-current" : ""}`} aria-hidden="true" />
                    <span className="truncate">{item.title}</span>
                    <span className="shrink-0 text-[11px] opacity-75">{focusStatus(item)}</span>
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
                onClick={() => void toggleStar(item)}
                disabled={pendingKey === `${item.id}:star`}
                className="flex min-h-14 items-start justify-between gap-3 rounded-md bg-stone-50 px-3 py-2 text-left ring-1 ring-stone-200 transition hover:bg-stone-100 disabled:cursor-wait disabled:opacity-70"
                aria-label={`Star ${item.title}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-stone-950">{item.title}</span>
                  <span className="mt-1 block truncate text-xs text-stone-600">{itemMeta(item)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-xs font-medium text-stone-500">{focusStatus(item)}</span>
                  <Star className="h-4 w-4 text-stone-500" aria-hidden="true" />
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
