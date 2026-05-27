"use client";

import { Check, CheckCircle2, Circle, RefreshCw, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type RecurrenceDay = {
  date: string;
  weekday: string;
  status: "completed" | "uncompleted" | "skipped" | "missed" | "deferred" | "none";
  eventId?: string;
  occurredAt?: string;
};

type RecurrenceProgress = {
  policy: {
    id: string;
    type: string;
    intervalDays?: number;
    minimumIntervalDays?: number;
    targetCount?: number;
    targetWindowDays?: number;
    preferredDays: string[];
  };
  week: {
    startDate: string;
    endDate: string;
    days: RecurrenceDay[];
    completedCount: number;
    targetCount?: number;
    targetWindowDays: number;
  };
};

type Item = {
  id: string;
  kind: string;
  title: string;
  status: string;
  priority: string;
  dueAt?: string;
  completedAt?: string;
  completion?: {
    completedToday: boolean;
    completedAt?: string;
  };
  recurrence?: RecurrenceProgress;
};

type ItemsResponse = {
  date: string;
  timezone: string;
  items: Item[];
};

type ToggleResponse = {
  item?: Item;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4100";

function formatDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

function dayTone(day: RecurrenceDay, isToday: boolean): string {
  const base = "h-8 w-8 shrink-0 rounded-full border text-[11px] font-semibold transition";
  const todayRing = isToday ? " ring-2 ring-sky-300 ring-offset-1" : "";
  if (day.status === "completed") {
    return `${base}${todayRing} border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800`;
  }
  if (day.status === "missed") {
    return `${base}${todayRing} border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100`;
  }
  if (day.status === "skipped" || day.status === "deferred") {
    return `${base}${todayRing} border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100`;
  }
  if (day.status === "uncompleted") {
    return `${base}${todayRing} border-stone-300 bg-stone-100 text-stone-500 hover:bg-stone-200`;
  }
  return `${base}${todayRing} border-stone-300 bg-white text-stone-600 hover:bg-stone-100`;
}

function recurrenceSummary(recurrence: RecurrenceProgress): string {
  const target = recurrence.week.targetCount;
  if (target) return `${recurrence.week.completedCount}/${target}`;
  return `${recurrence.week.completedCount}`;
}

export function ItemsPanel() {
  const [items, setItems] = useState<Item[]>([]);
  const [dashboardDate, setDashboardDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago",
    []
  );

  async function loadItems() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        userId: "local-owner",
        status: "open,active,waiting",
        includeDoneToday: "true",
        timezone,
        limit: "20"
      });
      const response = await fetch(`${apiUrl}/v1/items?${params.toString()}`, {
        cache: "no-store"
      });
      if (!response.ok) throw new Error(`Items returned ${response.status}`);
      const payload = (await response.json()) as ItemsResponse;
      setItems(payload.items);
      setDashboardDate(payload.date);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function toggleTask(item: Item) {
    const nextCompleted = item.status !== "done";
    const key = `${item.id}:task`;
    setPendingKey(key);
    setError(null);
    try {
      const response = await fetch(`${apiUrl}/v1/items/${encodeURIComponent(item.id)}/complete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          userId: "local-owner",
          completed: nextCompleted,
          timezone
        })
      });
      if (!response.ok) throw new Error(`Task update returned ${response.status}`);
      const payload = (await response.json()) as ToggleResponse;
      if (payload.item) {
        setItems((current) => current.map((candidate) => (candidate.id === item.id ? payload.item! : candidate)));
      } else {
        await loadItems();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingKey(null);
    }
  }

  async function toggleRecurrenceDay(item: Item, day: RecurrenceDay) {
    const key = `${item.id}:${day.date}`;
    setPendingKey(key);
    setError(null);
    try {
      const response = await fetch(
        `${apiUrl}/v1/items/${encodeURIComponent(item.id)}/recurrence-days/${day.date}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            userId: "local-owner",
            completed: day.status !== "completed",
            timezone
          })
        }
      );
      if (!response.ok) throw new Error(`Recurrence update returned ${response.status}`);
      const payload = (await response.json()) as ToggleResponse;
      if (payload.item) {
        setItems((current) => current.map((candidate) => (candidate.id === item.id ? payload.item! : candidate)));
      } else {
        await loadItems();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingKey(null);
    }
  }

  useEffect(() => {
    void loadItems();
  }, []);

  return (
    <div className="rounded-md border border-stone-300 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-emerald-700" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-stone-950">Open items</h2>
        </div>
        <button
          type="button"
          onClick={() => void loadItems()}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-stone-300 text-stone-700 hover:bg-stone-100"
          aria-label="Refresh open items"
          title="Refresh open items"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
        </button>
      </div>

      {error ? <p className="mt-3 text-sm leading-6 text-rose-700">{error}</p> : null}

      {!error && loading && items.length === 0 ? (
        <p className="mt-3 text-sm leading-6 text-stone-600">Loading items...</p>
      ) : null}

      {!error && !loading && items.length === 0 ? (
        <p className="mt-3 text-sm leading-6 text-stone-600">No open items.</p>
      ) : null}

      {items.length > 0 ? (
        <div className="mt-4 divide-y divide-stone-200">
          {items.map((item) => {
            const due = formatDate(item.dueAt);
            const completed = item.status === "done";
            const hasRecurrence = item.recurrence !== undefined;
            return (
              <div key={item.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-3">
                    {hasRecurrence ? (
                      <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-stone-300 bg-stone-50 text-stone-500">
                        <RotateCcw className="h-4 w-4" aria-hidden="true" />
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={pendingKey === `${item.id}:task`}
                        onClick={() => void toggleTask(item)}
                        className={`mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition ${
                          completed
                            ? "border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800"
                            : "border-stone-300 bg-white text-stone-500 hover:bg-stone-100"
                        } disabled:cursor-wait disabled:opacity-60`}
                        aria-label={completed ? `Reopen ${item.title}` : `Complete ${item.title}`}
                        title={completed ? "Reopen" : "Complete"}
                      >
                        {completed ? (
                          <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
                        ) : (
                          <Circle className="h-5 w-5" aria-hidden="true" />
                        )}
                      </button>
                    )}
                    <div className="min-w-0">
                      <p className={`truncate text-sm font-medium ${completed ? "text-stone-500 line-through" : "text-stone-950"}`}>
                        {item.title}
                      </p>
                      <p className="mt-1 text-xs text-stone-600">
                        {item.kind} / {item.priority} / {completed ? "done today" : item.status}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {item.recurrence ? (
                      <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-900">
                        {recurrenceSummary(item.recurrence)}
                      </span>
                    ) : null}
                    {due ? (
                      <span className="rounded-md bg-stone-100 px-2 py-1 text-xs font-medium text-stone-700">
                        {due}
                      </span>
                    ) : null}
                    {completed ? (
                      <Check className="h-7 w-7 text-emerald-700" aria-hidden="true" />
                    ) : null}
                  </div>
                </div>

                {item.recurrence ? (
                  <div className="mt-3 flex items-center justify-between gap-3 pl-12">
                    <div className="flex min-w-0 flex-wrap gap-2">
                      {item.recurrence.week.days.map((day) => {
                        const today = day.date === dashboardDate;
                        const key = `${item.id}:${day.date}`;
                        return (
                          <button
                            key={day.date}
                            type="button"
                            disabled={pendingKey === key}
                            onClick={() => void toggleRecurrenceDay(item, day)}
                            className={`${dayTone(day, today)} disabled:cursor-wait disabled:opacity-60`}
                            aria-label={`${day.status === "completed" ? "Undo" : "Mark"} ${item.title} on ${day.weekday} ${day.date}`}
                            title={`${day.weekday} ${day.date}`}
                          >
                            {day.status === "completed" ? (
                              <Check className="mx-auto h-4 w-4" aria-hidden="true" />
                            ) : (
                              day.weekday.slice(0, 1)
                            )}
                          </button>
                        );
                      })}
                    </div>
                    <span className="shrink-0 text-xs font-medium text-stone-600">
                      {item.recurrence.week.completedCount}
                      {item.recurrence.week.targetCount ? ` of ${item.recurrence.week.targetCount}` : ""}
                    </span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
