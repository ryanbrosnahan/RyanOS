"use client";

import Link from "next/link";
import { CalendarDays, Clock3, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiPath } from "./api-client";

type AgendaEntry = {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  status: string;
  source: "calendar" | "plan";
};

function todayKey(): string {
  const date = new Date();
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function dayRange(): { from: string; to: string } {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function CalendarAgendaPanel() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [entries, setEntries] = useState<AgendaEntry[]>([]);
  const [plan, setPlan] = useState<{ id: string; status: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const statusResponse = await apiFetch(apiPath("/v1/integrations/calendar"), { cache: "no-store" });
    if (!statusResponse.ok) return;
    const status = await statusResponse.json() as { configured: boolean; settings: { enabled: boolean } };
    const active = status.configured && status.settings.enabled;
    setConfigured(active);
    if (!active) return;
    const range = dayRange();
    const [eventsResponse, planResponse] = await Promise.all([
      apiFetch(apiPath(`/v1/calendar/events?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`), { cache: "no-store" }),
      apiFetch(apiPath(`/v1/calendar/plans?date=${todayKey()}`), { cache: "no-store" })
    ]);
    const next: AgendaEntry[] = [];
    if (eventsResponse.ok) {
      const payload = await eventsResponse.json() as { events: Array<Omit<AgendaEntry, "source">> };
      next.push(...payload.events.map((event) => ({ ...event, source: "calendar" as const })));
    }
    if (planResponse.ok) {
      const payload = await planResponse.json() as {
        plan?: { id: string; status: string };
        blocks: Array<Omit<AgendaEntry, "source">>;
      };
      setPlan(payload.plan ?? null);
      next.push(...payload.blocks
        .filter((block) => block.status !== "removed" && block.status !== "published")
        .map((block) => ({ ...block, source: "plan" as const })));
    }
    setEntries(next.sort((a, b) => a.startAt.localeCompare(b.startAt)));
  }, []);

  useEffect(() => {
    void load().catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, [load]);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch(apiPath("/v1/calendar/plans/generate"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date: todayKey() })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error ?? `Request failed with ${response.status}`);
      }
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  if (configured !== true) return null;

  return (
    <section className="border-y border-stone-300 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-sky-700" aria-hidden="true" />
          <div>
            <h2 className="text-base font-semibold text-stone-950">Today’s schedule</h2>
            <p className="text-xs text-stone-500">{plan ? `Draft ${plan.status}` : "Calendar availability"}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void generate()}
            disabled={busy}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-300 bg-white px-2.5 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-60"
          >
            {busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Clock3 className="h-3.5 w-3.5" />}
            Build day
          </button>
          <Link href="/calendar" className="inline-flex h-8 items-center rounded-md bg-stone-950 px-2.5 text-xs font-medium text-white">
            Open calendar
          </Link>
        </div>
      </div>
      {error ? <p className="mt-3 text-xs text-red-700">{error}</p> : null}
      {entries.length > 0 ? (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {entries.slice(0, 8).map((entry) => (
            <div key={`${entry.source}:${entry.id}`} className="min-w-44 border-l-2 border-sky-600 bg-white px-3 py-2">
              <p className="ryanos-clamp-2 text-xs font-semibold text-stone-900">{entry.title}</p>
              <p className="mt-1 text-xs text-stone-500">
                {new Date(entry.startAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-stone-500">No events or draft blocks today.</p>
      )}
    </section>
  );
}
