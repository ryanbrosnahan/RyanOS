"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiPath } from "../api-client";

type CompletionRequest = {
  id: string; captureId: string; sourceId: string; integrationId: string;
  itemId: string | null; itemRevision: number; revision: number | null;
  title: string | null; kind: string | null; body: string | null; priority: string | null;
  status: string | null; dueAt: string | null; suppressedAt: string | null; deletedAt: string | null;
  evidence: { summary: string; sourceUrl?: string; observedAt: string }[];
};

export function TaskCompletionRequestsPanel() {
  const [requests, setRequests] = useState<CompletionRequest[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const response = await apiFetch(apiPath("/v1/task-integration-requests"));
    if (!response.ok) throw new Error("Completion reviews require a signed-in owner and PostgreSQL.");
    const data = await response.json() as { requests: CompletionRequest[] };
    setRequests(data.requests);
    setLoaded(true);
  }, []);
  useEffect(() => { void load().catch(error => setError((error as Error).message)); }, [load]);

  async function refresh() {
    setBusy(true); setError("");
    try { await load(); } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  async function decide(request: CompletionRequest, action: "approve" | "reject" | "dismiss") {
    setBusy(true); setError("");
    try {
      const path = action === "dismiss"
        ? `/v1/task-integration-captures/${request.captureId}/dismiss`
        : `/v1/task-integration-requests/${request.id}/decision`;
      const response = await apiFetch(apiPath(path), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "dismiss" ? { dismiss: true }
          : { approve: action === "approve", expectedRevision: request.itemRevision })
      });
      if (!response.ok) {
        const result = await response.json() as { error?: string };
        throw new Error(result.error ?? "Could not save decision. Refresh and review again.");
      }
      await load();
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <section className="rounded-md border border-stone-300 bg-white p-4 shadow-sm" aria-labelledby="completion-reviews-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="completion-reviews-heading" className="text-lg font-semibold">Task completion requests</h2>
        <button type="button" onClick={() => void refresh()} disabled={busy} className="rounded border border-stone-300 px-3 py-1 disabled:opacity-50">Refresh requests</button>
      </div>
      <p className="mt-2 text-sm text-stone-600">An assistant has proposed these completions. Review each task before choosing Mark done. External observations are reported evidence, not proof that the task is complete.</p>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      {!loaded && !error && <p className="mt-3 text-sm text-stone-600">Loading completion requests...</p>}
      {loaded && !error && requests.length === 0 && <p className="mt-3 text-sm text-stone-600">No pending completion requests.</p>}
      <div className="mt-4 space-y-4">
        {requests.map(request => {
          const changed = request.revision !== request.itemRevision;
          const unavailable = changed || !request.itemId || Boolean(request.deletedAt || request.suppressedAt) || request.kind !== "task" || !["open", "active", "waiting"].includes(request.status ?? "");
          return (
            <article key={request.id} className="rounded border border-stone-200 p-3">
              <h3 className="font-medium">{request.title ?? "Deleted task"}</h3>
              <p className="mt-1 break-all text-xs text-stone-500">Source: {request.sourceId}</p>
              <p className="mt-1 text-sm">Status: {request.status ?? "deleted"}{request.priority ? ` · ${request.priority}` : ""}{request.dueAt ? ` · Due ${request.dueAt}` : ""}</p>
              {request.body && <p className="mt-2 whitespace-pre-wrap text-sm">{request.body}</p>}
              <h4 className="mt-3 text-sm font-medium">Reported external observations</h4>
              {request.evidence.length === 0 && <p className="text-sm text-stone-600">No external evidence supplied.</p>}
              <ul className="mt-1 space-y-2 text-sm">
                {request.evidence.map((entry, index) => <li key={index}>
                  <p className="whitespace-pre-wrap">{entry.summary}</p>
                  <p className="text-xs text-stone-500">Observed: {entry.observedAt}</p>
                  {entry.sourceUrl && <a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-sky-700 underline">Open evidence source</a>}
                </li>)}
              </ul>
              {unavailable && <p className="mt-2 text-sm text-amber-800">The task has changed or is unavailable. Reject this request and review the current task before requesting completion again.</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={busy || unavailable} onClick={() => void decide(request, "approve")} className="rounded bg-sky-700 px-3 py-1 text-white disabled:opacity-50" aria-label={`Mark ${request.title ?? "task"} done`}>Mark done</button>
                <button type="button" disabled={busy} onClick={() => void decide(request, "reject")} className="rounded border border-stone-300 px-3 py-1 disabled:opacity-50">Reject request</button>
                <button type="button" disabled={busy} onClick={() => void decide(request, "dismiss")} className="rounded border border-stone-300 px-3 py-1 disabled:opacity-50">Stop automatic capture</button>
              </div>
              <p className="mt-2 text-xs text-stone-500">Stop automatic capture suppresses this source action and rejects its pending completion requests. The task remains in RyanOS.</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
