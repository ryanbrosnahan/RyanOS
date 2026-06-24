"use client";

import { Check, ExternalLink, RefreshCw, Search, X } from "lucide-react";
import { useEffect, useState } from "react";

type OpportunityProposal = {
  id: string;
  status: "proposed" | "accepted" | "rejected";
  projectSlug: string;
  title: string;
  summary?: string;
  rating?: number;
  fit: "unknown" | "low" | "medium" | "high";
  priority: "low" | "normal" | "high" | "urgent";
  dueAt?: string;
  decisionBy?: string;
  valueEstimate?: string;
  recommendedAction?: string;
  rationale?: string;
  sourceUrls: string[];
  reportPath?: string;
  source?: {
    title?: string;
    summary?: string;
    url?: string;
    occurredAt?: string;
  };
};

type OpportunityProposalsResponse = {
  proposals: OpportunityProposal[];
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4100";

function formatDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

function projectLabel(value: string): string {
  return value
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function ratingLabel(value: number | undefined): string {
  if (value === undefined) return "unrated";
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}/10`;
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
      return "bg-emerald-50 text-emerald-800";
  }
}

function uniqueLinks(proposal: OpportunityProposal): string[] {
  const seen = new Set<string>();
  const links: string[] = [];
  for (const url of [proposal.source?.url, ...proposal.sourceUrls]) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    links.push(url);
  }
  return links;
}

export function OpportunityProposalsPanel() {
  const [proposals, setProposals] = useState<OpportunityProposal[]>([]);
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
      const response = await fetch(`${apiUrl}/v1/opportunity-proposals?${params.toString()}`, {
        cache: "no-store"
      });
      if (!response.ok) throw new Error(`Opportunity proposals returned ${response.status}`);
      const payload = (await response.json()) as OpportunityProposalsResponse;
      setProposals(payload.proposals);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function actOnProposal(proposal: OpportunityProposal, action: "accept" | "reject") {
    setPendingId(proposal.id);
    setError(null);
    try {
      const response = await fetch(
        `${apiUrl}/v1/opportunity-proposals/${encodeURIComponent(proposal.id)}/${action}`,
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
      if (!response.ok) throw new Error(`Opportunity proposal ${action} returned ${response.status}`);
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
          <Search className="h-5 w-5 text-emerald-700" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-stone-950">Proposed opportunity leads</h2>
        </div>
        <button
          type="button"
          onClick={() => void loadProposals()}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-stone-300 text-stone-700 hover:bg-stone-100"
          aria-label="Refresh opportunity proposals"
          title="Refresh opportunity proposals"
        >
          <RefreshCw className={`h-4 w-4 ${loading || refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
        </button>
      </div>

      {error ? <p className="mt-3 text-sm leading-6 text-rose-700">{error}</p> : null}

      {!error && loading && proposals.length === 0 ? (
        <p className="mt-3 text-sm leading-6 text-stone-600">Loading opportunity proposals...</p>
      ) : null}

      {!error && !loading && proposals.length === 0 ? (
        <p className="mt-3 text-sm leading-6 text-stone-600">No proposed opportunity leads.</p>
      ) : null}

      {proposals.length > 0 ? (
        <div className="mt-3 space-y-3">
          {proposals.map((proposal) => {
            const links = uniqueLinks(proposal);
            return (
              <article key={proposal.id} className="border-t border-stone-200 pt-3 first:border-t-0 first:pt-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
                      <span className="font-medium text-stone-600">{projectLabel(proposal.projectSlug)}</span>
                      <span>{ratingLabel(proposal.rating)}</span>
                      <span>{proposal.fit} fit</span>
                      {proposal.dueAt ? <span>Due {formatDate(proposal.dueAt)}</span> : null}
                    </div>
                    <h3 className="mt-1 text-sm font-semibold leading-5 text-stone-950">{proposal.title}</h3>
                  </div>
                  <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium ${proposalTone(proposal.priority)}`}>
                    {proposal.priority}
                  </span>
                </div>

                {proposal.rationale ?? proposal.summary ? (
                  <p className="mt-2 text-sm leading-5 text-stone-700">
                    {proposal.rationale ?? proposal.summary}
                  </p>
                ) : null}

                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-stone-500">
                  {proposal.recommendedAction ? <span>{proposal.recommendedAction}</span> : null}
                  {proposal.decisionBy ? <span>Decide by {formatDate(proposal.decisionBy)}</span> : null}
                  {proposal.valueEstimate ? <span>{proposal.valueEstimate}</span> : null}
                </div>

                {links.length > 0 || proposal.reportPath ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    {links.slice(0, 3).map((url, index) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-emerald-800 hover:text-emerald-950"
                      >
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        Source {index + 1}
                      </a>
                    ))}
                    {proposal.reportPath ? <span className="truncate text-stone-500">{proposal.reportPath}</span> : null}
                  </div>
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
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
