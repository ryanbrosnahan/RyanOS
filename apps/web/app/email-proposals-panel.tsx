"use client";

import {
  Check,
  ChevronDown,
  ExternalLink,
  Mail,
  MoreHorizontal,
  RefreshCw,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { apiFetch, apiPath } from "./api-client";

type EmailProposal = {
  id: string;
  actionType: string;
  status: "proposed" | "accepted" | "rejected";
  title: string;
  body?: string;
  priority: string;
  dueAt?: string;
  draftReplyText?: string;
  rationale?: string;
  confidence?: number;
  triage?: { outcome: "actionable" | "maybe"; reason?: string };
  senderAddress?: string;
  senderPreference?: { id: string; disposition: "never" | "likely" };
  initialProgressNote?: string;
  checklistItems: string[];
  account?: { email?: string; displayName?: string };
  source?: {
    title?: string;
    summary?: string;
    url?: string;
    occurredAt?: string;
    metadata: { gmail?: { from?: string; subject?: string } };
  };
};

type ProposalsResponse = { proposals: EmailProposal[] };

function formatDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(value));
}

function senderLabel(proposal: EmailProposal): string {
  return proposal.source?.metadata.gmail?.from ?? proposal.account?.email ?? "Gmail";
}

function subjectLabel(proposal: EmailProposal): string {
  return proposal.source?.metadata.gmail?.subject ?? proposal.source?.title ?? "Email";
}

function proposalTone(priority: string): string {
  if (priority === "urgent") return "bg-rose-50 text-rose-800";
  if (priority === "high") return "bg-amber-50 text-amber-800";
  if (priority === "low") return "bg-stone-100 text-stone-700";
  return "bg-sky-50 text-sky-800";
}

export function EmailProposalsPanel() {
  const [proposals, setProposals] = useState<EmailProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [neverCandidate, setNeverCandidate] = useState<EmailProposal | null>(null);
  const [rejectCurrent, setRejectCurrent] = useState(true);

  const actionable = useMemo(
    () => proposals.filter((proposal) => proposal.triage?.outcome !== "maybe"),
    [proposals]
  );
  const maybe = useMemo(
    () => proposals
      .filter((proposal) => proposal.triage?.outcome === "maybe")
      .sort((left, right) => (right.confidence ?? 0) - (left.confidence ?? 0)),
    [proposals]
  );

  async function loadProposals(options?: { background?: boolean }) {
    if (options?.background) setRefreshing(true);
    else {
      setLoading(true);
      setError(null);
    }
    try {
      const params = new URLSearchParams({ status: "proposed", limit: "100" });
      const response = await apiFetch(apiPath(`/v1/email/proposals?${params.toString()}`), { cache: "no-store" });
      if (!response.ok) throw new Error(`Email proposals returned ${response.status}`);
      setProposals(((await response.json()) as ProposalsResponse).proposals);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function actOnProposal(proposal: EmailProposal, action: "accept" | "reject") {
    setPendingId(proposal.id);
    setError(null);
    try {
      const response = await apiFetch(apiPath(`/v1/email/proposals/${encodeURIComponent(proposal.id)}/${action}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      if (!response.ok) throw new Error(`Email proposal ${action} returned ${response.status}`);
      setProposals((current) => current.filter((candidate) => candidate.id !== proposal.id));
      if (action === "accept") window.dispatchEvent(new Event("ryanos-items-refresh"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingId(null);
    }
  }

  async function setSenderPreference(
    proposal: EmailProposal,
    disposition: "never" | "likely" | null,
    shouldReject = false
  ) {
    setPendingId(proposal.id);
    setError(null);
    try {
      const response = await apiFetch(
        apiPath(`/v1/email/proposals/${encodeURIComponent(proposal.id)}/sender-preference`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ disposition, rejectCurrent: shouldReject })
        }
      );
      if (!response.ok) throw new Error(`Sender preference returned ${response.status}`);
      const payload = (await response.json()) as { proposal: EmailProposal };
      if (payload.proposal.status !== "proposed") {
        setProposals((current) => current.filter((candidate) => candidate.id !== proposal.id));
      } else {
        setProposals((current) => current.map((candidate) => candidate.id === proposal.id ? payload.proposal : candidate));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingId(null);
      setNeverCandidate(null);
    }
  }

  useEffect(() => {
    void loadProposals();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadProposals({ background: true });
    }, 60000);
    return () => window.clearInterval(interval);
  }, []);

  function proposalCard(proposal: EmailProposal) {
    return (
      <article key={proposal.id} className="border-t border-stone-200 pt-3 first:border-t-0 first:pt-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
              <span className="truncate">{proposal.account?.displayName ?? proposal.account?.email ?? "Gmail"}</span>
              <span className="truncate">{senderLabel(proposal)}</span>
              {proposal.source?.occurredAt ? <span>{formatDate(proposal.source.occurredAt)}</span> : null}
            </div>
            <p className="mt-1 truncate text-xs font-medium text-stone-600">{subjectLabel(proposal)}</p>
            <h3 className="mt-1 text-sm font-semibold leading-5 text-stone-950">{proposal.title}</h3>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <span className={`rounded-md px-2 py-1 text-xs font-medium ${proposalTone(proposal.priority)}`}>
              {proposal.priority}
            </span>
            <details className="relative">
              <summary
                className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-md text-stone-600 hover:bg-stone-100"
                aria-label="Sender options"
                title="Sender options"
              >
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
              </summary>
              <div className="absolute right-0 z-10 mt-1 w-44 rounded-md border border-stone-200 bg-white p-1 shadow-lg">
                <button type="button" onClick={() => void setSenderPreference(proposal, "likely")} className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-stone-100">
                  Usually actionable
                </button>
                <button type="button" onClick={() => { setRejectCurrent(true); setNeverCandidate(proposal); }} className="block w-full rounded px-2 py-1.5 text-left text-sm text-rose-700 hover:bg-rose-50">
                  Never suggest
                </button>
                {proposal.senderPreference ? (
                  <button type="button" onClick={() => void setSenderPreference(proposal, null)} className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-stone-100">
                    Remove preference
                  </button>
                ) : null}
              </div>
            </details>
          </div>
        </div>

        {proposal.body ?? proposal.source?.summary ? (
          <p className="mt-2 whitespace-pre-wrap text-sm leading-5 text-stone-700">{proposal.body ?? proposal.source?.summary}</p>
        ) : proposal.rationale ? (
          <p className="mt-2 text-sm leading-5 text-stone-700">{proposal.rationale}</p>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-stone-500">
          <span>{proposal.actionType.replace("_", " ")}</span>
          {proposal.confidence !== undefined ? <span>{proposal.confidence}% confidence</span> : null}
          {proposal.dueAt ? <span>Due {formatDate(proposal.dueAt)}</span> : null}
          {proposal.checklistItems.length > 0 ? <span>{proposal.checklistItems.length} checklist steps</span> : null}
          {proposal.initialProgressNote ? <span>Includes progress note</span> : null}
          {proposal.senderPreference ? <span>{proposal.senderPreference.disposition === "likely" ? "Usually actionable sender" : "Blocked sender"}</span> : null}
        </div>

        {proposal.checklistItems.length > 0 || proposal.initialProgressNote || proposal.draftReplyText ? (
          <details className="mt-2 rounded-md bg-stone-50 px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-stone-700">Generated task details</summary>
            {proposal.initialProgressNote ? <p className="mt-2 text-sm text-stone-700">Progress: {proposal.initialProgressNote}</p> : null}
            {proposal.checklistItems.length > 0 ? (
              <ul className="mt-2 space-y-1 text-sm text-stone-700">
                {proposal.checklistItems.map((item) => <li key={item}>- {item}</li>)}
              </ul>
            ) : null}
            {proposal.draftReplyText ? <p className="mt-2 whitespace-pre-wrap text-sm leading-5 text-stone-800">{proposal.draftReplyText}</p> : null}
          </details>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void actOnProposal(proposal, "accept")} disabled={pendingId === proposal.id} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-stone-950 px-3 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-60">
            <Check className="h-4 w-4" aria-hidden="true" /> Accept
          </button>
          <button type="button" onClick={() => void actOnProposal(proposal, "reject")} disabled={pendingId === proposal.id} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-300 px-3 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-60">
            <X className="h-4 w-4" aria-hidden="true" /> Reject
          </button>
          {proposal.source?.url ? (
            <a href={proposal.source.url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 px-2 text-sm font-medium text-sky-800 hover:underline">
              Open email <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          ) : null}
        </div>
      </article>
    );
  }

  return (
    <div className="rounded-md border border-stone-300 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-sky-700" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-stone-950">Proposed email to-dos</h2>
        </div>
        <button type="button" onClick={() => void loadProposals()} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-stone-300 text-stone-700 hover:bg-stone-100" aria-label="Refresh email proposals" title="Refresh email proposals">
          <RefreshCw className={`h-4 w-4 ${loading || refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
        </button>
      </div>

      {error ? <p className="mt-3 text-sm leading-6 text-rose-700">{error}</p> : null}
      {!error && loading && proposals.length === 0 ? <p className="mt-3 text-sm leading-6 text-stone-600">Loading email proposals...</p> : null}
      {!error && !loading && proposals.length === 0 ? <p className="mt-3 text-sm leading-6 text-stone-600">No proposed email to-dos.</p> : null}

      {actionable.length > 0 ? <div className="mt-3 space-y-3">{actionable.map(proposalCard)}</div> : null}
      {maybe.length > 0 ? (
        <details className="mt-4 border-t border-stone-200 pt-3">
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-stone-700">
            <span>Maybe actionable ({maybe.length})</span>
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </summary>
          <div className="mt-3 space-y-3">{maybe.map(proposalCard)}</div>
        </details>
      ) : null}

      {neverCandidate ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-labelledby="never-sender-title">
          <div className="w-full max-w-sm rounded-md bg-white p-4 shadow-xl">
            <h3 id="never-sender-title" className="font-semibold text-stone-950">Never suggest this sender?</h3>
            <p className="mt-2 text-sm leading-5 text-stone-600">Future mail from {neverCandidate.senderAddress ?? senderLabel(neverCandidate)} will be recorded as no action without AI classification.</p>
            <label className="mt-3 flex items-center gap-2 text-sm text-stone-700">
              <input type="checkbox" checked={rejectCurrent} onChange={(event) => setRejectCurrent(event.target.checked)} />
              Reject this proposal too
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setNeverCandidate(null)} className="h-8 rounded-md border border-stone-300 px-3 text-sm font-medium text-stone-700">Cancel</button>
              <button type="button" onClick={() => void setSenderPreference(neverCandidate, "never", rejectCurrent)} className="h-8 rounded-md bg-rose-700 px-3 text-sm font-medium text-white">Never suggest</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
