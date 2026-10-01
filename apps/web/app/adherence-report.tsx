"use client";

import { useEffect, useState } from "react";
import { BarChart3, Download, X } from "lucide-react";
import type { AdherenceReport, AdherenceDay } from "@ryanos/core";
import { apiFetch, apiPath } from "./api-client";

const number = (value: number) => value.toFixed(2);
function dayLabel(day: AdherenceDay): string {
  const status =
    day.status === "none"
      ? "No completion recorded"
      : day.status === "before_tracking"
        ? "Before tracking"
        : day.status === "uncompleted"
          ? "Completion undone"
          : day.status;
  return `${day.date}: ${status}`;
}
export function TaskAdherenceReport({
  itemId,
  timezone,
  refreshKey,
}: {
  itemId: string;
  timezone: string;
  refreshKey?: unknown;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{
    title: string;
    report: AdherenceReport;
  } | null>(null);
  const [months, setMonths] = useState(12);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("ryanos-items-refresh", refresh);
    window.addEventListener("ryanos-focus-refresh", refresh);
    return () => {
      window.removeEventListener("ryanos-items-refresh", refresh);
      window.removeEventListener("ryanos-focus-refresh", refresh);
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setData(null);
    apiFetch(
      apiPath(
        `/v1/items/${encodeURIComponent(itemId)}/adherence?${new URLSearchParams({ timezone })}`,
      ),
      { signal: controller.signal, cache: "no-store" },
    )
      .then(async (response) => {
        if (!response.ok)
          throw new Error(`Could not load report (${response.status}).`);
        return response.json();
      })
      .then((payload) => {
        if (!controller.signal.aborted) setData(payload);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted)
          setError(
            err instanceof Error ? err.message : "Could not load report.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, itemId, timezone, revision, refreshKey]);
  async function download() {
    setDownloading(true);
    setError(null);
    try {
      const response = await apiFetch(
        apiPath(
          `/v1/items/${encodeURIComponent(itemId)}/adherence?${new URLSearchParams({ timezone, format: "pdf" })}`,
        ),
        { cache: "no-store" },
      );
      if (!response.ok)
        throw new Error(`Could not download PDF (${response.status}).`);
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `adherence-${itemId}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not download PDF.");
    } finally {
      setDownloading(false);
    }
  }
  const report = data?.report;
  const visibleMonths = report?.months.slice(-months) ?? [];
  const max = Math.max(1, ...visibleMonths.map((month) => month.completed));
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-sky-800 hover:bg-sky-50"
      >
        <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />
        {open ? "Hide adherence report" : "Adherence report"}
      </button>
      {open ? (
        <section
          aria-label="Task adherence report"
          className="mt-2 rounded-xl border border-stone-200 bg-white p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-semibold text-stone-900">
              Long-term adherence
            </h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void download()}
                disabled={downloading || !report}
                className="inline-flex items-center gap-1.5 rounded-md border border-stone-300 px-3 py-1.5 text-xs font-medium disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                {downloading ? "Preparing PDF…" : "Download PDF"}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close adherence report"
                className="rounded p-1 text-stone-500 hover:bg-stone-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          {loading ? (
            <p role="status" className="mt-4 text-sm text-stone-500">
              Loading history…
            </p>
          ) : null}
          {error ? (
            <div role="alert" className="mt-3 text-sm text-rose-700">
              {error}{" "}
              <button
                type="button"
                onClick={() => setRevision((value) => value + 1)}
                className="underline"
              >
                Retry
              </button>
            </div>
          ) : null}
          {report ? (
            <>
              <p className="mt-1 text-xs text-stone-500">
                {report.start
                  ? `Since ${report.start} · ${report.trackedDays} calendar days · through ${report.through}`
                  : "Complete this task once to begin tracking."}{" "}
                · {report.timezone}
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  [String(report.total), "Completed days"],
                  [number(report.weeklyAverage), "Average / week"],
                  [number(report.monthlyAverage), "Average / month"],
                  [
                    report.adherence?.percent == null
                      ? "—"
                      : `${report.adherence.percent.toFixed(1)}%`,
                    "Current-goal adherence",
                  ],
                ].map(([value, label]) => (
                  <div key={label} className="rounded-lg bg-stone-50 p-3">
                    <p className="text-xl font-semibold tabular-nums text-emerald-800">
                      {value}
                    </p>
                    <p className="mt-1 text-xs text-stone-600">{label}</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-sm text-stone-700">
                {report.adherence
                  ? `${report.adherence.met} of ${report.adherence.windows} closed periods met the goal: ${report.adherence.label}.`
                  : "This recurrence rule has no supported count-based goal; frequency is still tracked."}{" "}
                {report.adherence?.percent === null
                  ? "The first period is still open."
                  : ""}
              </p>
              <p className="mt-1 text-xs text-stone-500">
                Goal comparison uses the current rule, not historical rules or
                on-time completion. Skips count as misses. Open periods are
                excluded.
              </p>
              {report.start ? (
                <p className="mt-3 text-sm text-stone-700">
                  Recent {report.recentDays} days:{" "}
                  <strong>{number(report.recentWeeklyAverage)} / week</strong>{" "}
                  vs. {number(report.weeklyAverage)} lifetime. {report.skipped}{" "}
                  skipped days since tracking began.
                </p>
              ) : null}
              <div className="mt-6 flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-stone-800">
                  Activity calendar
                </h4>
                <label className="text-xs text-stone-600">
                  Show{" "}
                  <select
                    value={months}
                    onChange={(event) => setMonths(Number(event.target.value))}
                    className="ml-1 rounded border border-stone-300 bg-white p-1.5"
                  >
                    <option value={3}>3 months</option>
                    <option value={6}>6 months</option>
                    <option value={12}>12 months</option>
                  </select>
                </label>
              </div>
              <p className="mt-2 text-xs text-stone-500">
                Green ✓ completed · Amber S skipped · Gray – no completion.
                Faded dates are outside tracking or in the future.
              </p>
              <div className="mt-4 grid grid-cols-1 gap-5 min-[420px]:grid-cols-2 xl:grid-cols-3">
                {visibleMonths.map((month) => {
                  const days = report.calendar.filter((day) =>
                    day.date.startsWith(month.month),
                  );
                  const offset =
                    (new Date(`${month.month}-01T00:00:00Z`).getUTCDay() + 6) %
                    7;
                  return (
                    <div key={month.month}>
                      <h5 className="mb-2 text-xs font-semibold text-stone-700">
                        {new Date(
                          `${month.month}-01T12:00:00Z`,
                        ).toLocaleDateString("en-US", {
                          month: "long",
                          year: "numeric",
                          timeZone: "UTC",
                        })}
                      </h5>
                      <div className="grid grid-cols-7 gap-1 text-center text-[10px]">
                        {["M", "T", "W", "T", "F", "S", "S"].map((day, i) => (
                          <span
                            key={i}
                            className="pb-1 text-stone-500"
                            aria-hidden="true"
                          >
                            {day}
                          </span>
                        ))}
                        {Array.from({ length: offset }, (_, i) => (
                          <span key={`blank-${i}`} />
                        ))}
                        {days.map((day) => {
                          const faded =
                            day.status === "before_tracking" ||
                            day.status === "future";
                          return (
                            <span
                              key={day.date}
                              tabIndex={0}
                              role="img"
                              aria-label={dayLabel(day)}
                              title={dayLabel(day)}
                              className={`rounded py-1 leading-4 focus:outline-2 focus:outline-sky-700 ${day.status === "completed" ? "bg-emerald-100 text-emerald-900" : day.status === "skipped" ? "bg-amber-100 text-amber-900" : faded ? "bg-stone-50 text-stone-400" : "bg-stone-200 text-stone-700"}`}
                            >
                              {Number(day.date.slice(-2))}
                              <span aria-hidden="true">
                                {day.status === "completed"
                                  ? "✓"
                                  : day.status === "skipped"
                                    ? "S"
                                    : faded
                                      ? ""
                                      : "–"}
                              </span>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              <h4 className="mt-6 text-sm font-semibold text-stone-800">
                Monthly completed days
              </h4>
              <div
                className="mt-3 space-y-2"
                role="img"
                aria-label={`Monthly completed days: ${visibleMonths.map((month) => `${month.month}: ${month.completed}${month.partial ? " (partial)" : ""}`).join(", ")}`}
              >
                {visibleMonths.map((month) => (
                  <div
                    key={month.month}
                    className="flex items-center gap-2 text-xs"
                    aria-hidden="true"
                  >
                    <span className="w-20 shrink-0 text-stone-600">
                      {month.month}
                      {month.partial ? "*" : ""}
                    </span>
                    <div className="h-3 flex-1 rounded bg-stone-100">
                      <div
                        className="h-3 rounded bg-emerald-600"
                        style={{ width: `${(month.completed / max) * 100}%` }}
                      />
                    </div>
                    <span className="w-6 text-right tabular-nums">
                      {month.completed}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-stone-500">
                * Partial or untracked month. PDF includes all 12 months.
              </p>
              <details className="mt-5 text-xs text-stone-600">
                <summary className="cursor-pointer font-medium">
                  How these numbers are calculated
                </summary>
                <div className="mt-2 space-y-2">
                  {report.notes.map((note) => (
                    <p key={note}>{note}</p>
                  ))}
                </div>
              </details>
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
