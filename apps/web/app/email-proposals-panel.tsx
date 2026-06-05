"use client";

import { Check, Mail, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";

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
  account?: {
    email?: string;
    displayName?: string;
  };
  source?: {
    title?: string;
    summary?: string;
    url?: string;
    occurredAt?: string;
    metadata: {
      gmail?: {
        from?: string;
        subject?: string;
      };
    };
  };
};

type ProposalsResponse = {
  proposals: EmailProposal[];
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4100";

function formatDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

function senderLabel(proposal: EmailProposal): string {
  return proposal.source?.metadata.gmail?.from ?? proposal.account?.email ?? "Gmail";
}

function subjectLabel(proposal: EmailProposal): string {
  return proposal.source?.metadata.gmail?.subject ?? proposal.source?.title ?? "Email";
}

function proposalTone(priority: string): string {
  switch (priority) {
    case "urgent":
      return "bg-rose-50 text-rose-800";
    case "high":
      return "bg-amber-50 text-amber-800";
    case "low":
      return "bg-stone-100 text-stone-700";
    default:
      return "bg-sky-50 text-sky-800";
  }
}

export function EmailProposalsPanel() {
  const [proposals, setProposals] = useState<EmailProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function loadProposals(options?: { background?: boolean }) {
    if (options?.background) {
      setRefreshing(true);
    } else {
      setLoading(true);
      setError(null);
    }
    try {
      const params = new URLSearchParams({
        userId: "local-owner",
        status: "proposed",
        limit: "20"
      });
      const response = await fetch(`${apiUrl}/v1/email/proposals?${params.toString()}`, {
        cache: "no-store"
      });
      if (!response.ok) throw new Error(`Email proposals returned ${response.status}`);
      const payload = (await response.json()) as ProposalsResponse;
      setProposals(payload.proposals);
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
      const response = await fetch(
        `${apiUrl}/v1/email/proposals/${encodeURIComponent(proposal.id)}/${action}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            userId: "local-owner"
          })
        }
      );
      if (!response.ok) throw new Error(`Email proposal ${action} returned ${response.status}`);
      setProposals((current) => current.filter((candidate) => candidate.id !== proposal.id));
      if (action === "accept") {
        window.dispatchEvent(new Event("ryanos-items-refresh"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingId(null);
    }
  }

  useEffect(() => {
    void loadProposals();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadProposals({ background: true });
      }
    }, 60000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="rounded-md border border-stone-300 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-sky-700" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-stone-950">Proposed email to-dos</h2>
        </div>
        <button
          type="button"
          onClick={() => void loadProposals()}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-stone-300 text-stone-700 hover:bg-stone-100"
          aria-label="Refresh email proposals"
          title="Refresh email proposals"
        >
          <RefreshCw className={`h-4 w-4 ${loading || refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
        </button>
      </div>

      {error ? <p className="mt-3 text-sm leading-6 text-rose-700">{error}</p> : null}

      {!error && loading && proposals.length === 0 ? (
        <p className="mt-3 text-sm leading-6 text-stone-600">Loading email proposals...</p>
      ) : null}

      {!error && !loading && proposals.length === 0 ? (
        <p className="mt-3 text-sm leading-6 text-stone-600">No proposed email to-dos.</p>
      ) : null}

      {proposals.length > 0 ? (
        <div className="mt-3 space-y-3">
          {proposals.map((proposal) => (
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
                <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium ${proposalTone(proposal.priority)}`}>
                  {proposal.priority}
                </span>
              </div>

              {proposal.rationale ? (
                <p className="mt-2 text-sm leading-5 text-stone-700">{proposal.rationale}</p>
              ) : null}

              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-stone-500">
                <span>{proposal.actionType.replace("_", " ")}</span>
                {proposal.confidence !== undefined ? <span>{proposal.confidence}% confidence</span> : null}
                {proposal.dueAt ? <span>Due {formatDate(proposal.dueAt)}</span> : null}
              </div>

              {proposal.draftReplyText ? (
                <details className="mt-2 rounded-md bg-stone-50 px-3 py-2">
                  <summary className="cursor-pointer text-xs font-medium text-stone-700">Reply draft</summary>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-5 text-stone-800">
                    {proposal.draftReplyText}
                  </p>
                </details>
              ) : null}

              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void actOnProposal(proposal, "accept")}
                  disabled={pendingId === proposal.id}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-stone-950 px-3 text-sm font-medium text-white hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Check className="h-4 w-4" aria-hidden="true" />
                  Accept
                </button>
                <button
                  type="button"
                  onClick={() => void actOnProposal(proposal, "reject")}
                  disabled={pendingId === proposal.id}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-300 px-3 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                  Reject
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}
