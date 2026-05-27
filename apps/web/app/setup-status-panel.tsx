"use client";

import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

type SetupAction = {
  id: string;
  title: string;
  blocking: boolean;
  instructions: string[];
  command?: string;
  docs?: string[];
};

type SetupEntry = {
  id: string;
  name: string;
  configured: boolean;
  ready: boolean;
  setupRequired: boolean;
  setupActions: SetupAction[];
  warnings: string[];
};

type SetupStatus = {
  ai: SetupEntry;
  integrations: SetupEntry[];
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4100";

function statusLabel(entry: SetupEntry): string {
  if (!entry.configured && !entry.setupRequired) return "Disabled";
  if (entry.ready) return "Ready";
  if (entry.setupRequired) return "Needs setup";
  return "Not ready";
}

function statusColor(entry: SetupEntry): string {
  if (!entry.configured && !entry.setupRequired) return "bg-stone-100 text-stone-700";
  if (entry.ready) return "bg-emerald-50 text-emerald-800";
  if (entry.setupRequired) return "bg-amber-50 text-amber-800";
  return "bg-stone-100 text-stone-700";
}

export function SetupStatusPanel() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadStatus() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${apiUrl}/v1/setup/status`, {
        cache: "no-store"
      });
      if (!response.ok) throw new Error(`Setup status returned ${response.status}`);
      setStatus((await response.json()) as SetupStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadStatus();
  }, []);

  const entries = status ? [status.ai, ...status.integrations] : [];

  return (
    <div className="rounded-md border border-stone-300 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-700" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-stone-950">Setup status</h2>
        </div>
        <button
          type="button"
          onClick={() => void loadStatus()}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-stone-300 text-stone-700 hover:bg-stone-100"
          aria-label="Refresh setup status"
          title="Refresh setup status"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
        </button>
      </div>

      {error ? (
        <p className="mt-3 text-sm leading-6 text-rose-700">{error}</p>
      ) : null}

      {!error && loading && entries.length === 0 ? (
        <p className="mt-3 text-sm leading-6 text-stone-600">Loading setup status...</p>
      ) : null}

      <div className="mt-4 space-y-3">
        {entries.map((entry) => (
          <div key={entry.id} className="border-t border-stone-200 pt-3 first:border-t-0 first:pt-0">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <CheckCircle2
                  className={`h-4 w-4 ${entry.ready ? "text-emerald-700" : "text-stone-400"}`}
                  aria-hidden="true"
                />
                <p className="text-sm font-semibold text-stone-950">{entry.name}</p>
              </div>
              <span className={`rounded-md px-2 py-1 text-xs font-medium ${statusColor(entry)}`}>
                {statusLabel(entry)}
              </span>
            </div>

            {entry.setupActions.length > 0 ? (
              <div className="mt-2 space-y-2">
                {entry.setupActions.map((action) => (
                  <div key={action.id} className="border-l-2 border-amber-500 pl-3">
                    <p className="text-sm font-medium text-amber-950">{action.title}</p>
                    <ul className="mt-1 space-y-1 text-sm leading-5 text-amber-900">
                      {(action.instructions.length > 0
                        ? action.instructions
                        : ["Setup action required."]
                      ).map((instruction) => (
                        <li key={instruction}>{instruction}</li>
                      ))}
                    </ul>
                    {action.command ? (
                      <code className="mt-2 block overflow-x-auto rounded-sm bg-stone-100 px-2 py-1 text-xs text-stone-900">
                        {action.command}
                      </code>
                    ) : null}
                    {action.docs && action.docs.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        {action.docs.map((doc) => (
                          <a
                            key={doc}
                            href={doc}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-sky-800 underline-offset-2 hover:underline"
                          >
                            Docs
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            {entry.warnings.length > 0 ? (
              <ul className="mt-2 space-y-1 text-xs leading-5 text-stone-600">
                {entry.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
