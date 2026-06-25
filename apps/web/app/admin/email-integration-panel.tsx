"use client";

import { Mail, Play, RefreshCw, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { apiFetch, apiPath } from "../api-client";

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

type GmailAccount = {
  id: string;
  displayName?: string;
  email?: string;
  status: string;
  scopes: string[];
  settings: {
    enabled: boolean;
    lastScanAt?: string;
    lastSyncAt?: string;
  };
  proposalCounts: {
    proposed: number;
    accepted: number;
    rejected: number;
  };
};

type EmailAccountsResponse = {
  setup: SetupEntry;
  config: {
    query: string;
    maxPerAccount: number;
    cadenceMinutes: number;
    enabled: boolean;
  };
  counts: {
    proposed: number;
    accepted: number;
    rejected: number;
  };
  accounts: GmailAccount[];
};

type ScanResponse = {
  result: {
    accountsScanned: number;
    messagesSeen: number;
    messagesFetched: number;
    messagesSkippedByFilter: number;
    filterReasons: Record<string, number>;
    proposalsCreatedOrUpdated: number;
    errors: Array<{ error: string }>;
    alreadyRunning?: boolean;
    startedAt?: string;
  };
};

function statusTone(setup: SetupEntry): string {
  if (setup.ready) return "bg-emerald-50 text-emerald-800";
  if (setup.setupRequired) return "bg-amber-50 text-amber-800";
  return "bg-stone-100 text-stone-700";
}

function statusLabel(setup: SetupEntry): string {
  if (setup.ready) return "Ready";
  if (setup.setupRequired) return "Needs setup";
  return "Not ready";
}

function formatDate(value: string | undefined): string {
  if (!value) return "never";
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export function EmailIntegrationPanel() {
  const [payload, setPayload] = useState<EmailAccountsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<ScanResponse["result"] | null>(null);

  async function loadAccounts(options?: { background?: boolean }) {
    if (!options?.background) {
      setLoading(true);
      setError(null);
    }
    try {
      const response = await apiFetch(apiPath("/v1/email/accounts"), {
        cache: "no-store"
      });
      if (!response.ok) throw new Error(`Gmail accounts returned ${response.status}`);
      setPayload((await response.json()) as EmailAccountsResponse);
    } catch (err) {
      if (!options?.background) setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function syncAccounts() {
    setBusy("sync");
    setError(null);
    try {
      const response = await apiFetch(apiPath("/v1/email/accounts/sync"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({})
      });
      if (!response.ok) throw new Error(`Gmail sync returned ${response.status}`);
      await loadAccounts({ background: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function scanNow() {
    setBusy("scan");
    setError(null);
    try {
      const response = await apiFetch(apiPath("/v1/email/scan"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          syncAccounts: true
        })
      });
      if (!response.ok) throw new Error(`Gmail scan returned ${response.status}`);
      const result = (await response.json()) as ScanResponse;
      setScanResult(result.result);
      await loadAccounts({ background: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function toggleAccount(account: GmailAccount) {
    setBusy(account.id);
    setError(null);
    try {
      const response = await apiFetch(apiPath(`/v1/email/accounts/${encodeURIComponent(account.id)}/settings`), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          enabled: !account.settings.enabled
        })
      });
      if (!response.ok) throw new Error(`Gmail account update returned ${response.status}`);
      await loadAccounts({ background: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    void loadAccounts();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadAccounts({ background: true });
      }
    }, 60000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="rounded-md border border-stone-300 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-sky-700" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-stone-950">Gmail integration</h2>
        </div>
        <button
          type="button"
          onClick={() => void loadAccounts()}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-stone-300 text-stone-700 hover:bg-stone-100"
          aria-label="Refresh Gmail integration"
          title="Refresh Gmail integration"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
        </button>
      </div>

      {error ? <p className="mt-3 text-sm leading-6 text-rose-700">{error}</p> : null}
      {!error && loading && !payload ? (
        <p className="mt-3 text-sm leading-6 text-stone-600">Loading Gmail settings...</p>
      ) : null}

      {payload ? (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className={`rounded-md px-2 py-1 text-xs font-medium ${statusTone(payload.setup)}`}>
              {statusLabel(payload.setup)}
            </span>
            <span className="rounded-md bg-stone-100 px-2 py-1 text-xs font-medium text-stone-700">
              {payload.accounts.length} accounts
            </span>
            <span className="rounded-md bg-sky-50 px-2 py-1 text-xs font-medium text-sky-800">
              {payload.counts.proposed} proposed
            </span>
          </div>

          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            <div className="rounded-md bg-stone-50 px-3 py-2">
              <dt className="text-xs font-medium uppercase text-stone-500">Query</dt>
              <dd className="mt-1 break-words font-medium text-stone-950">{payload.config.query}</dd>
            </div>
            <div className="rounded-md bg-stone-50 px-3 py-2">
              <dt className="text-xs font-medium uppercase text-stone-500">Cadence</dt>
              <dd className="mt-1 font-medium text-stone-950">
                {payload.config.cadenceMinutes}m, max {payload.config.maxPerAccount}/account
              </dd>
            </div>
          </dl>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void syncAccounts()}
              disabled={busy !== null}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-stone-300 px-3 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${busy === "sync" ? "animate-spin" : ""}`} aria-hidden="true" />
              Sync
            </button>
            <button
              type="button"
              onClick={() => void scanNow()}
              disabled={busy !== null || !payload.setup.ready}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-stone-950 px-3 text-sm font-medium text-white hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              Scan now
            </button>
          </div>

          {scanResult ? (
            <p className="mt-3 text-sm leading-6 text-stone-700">
              {scanResult.alreadyRunning
                ? `Scan already running${scanResult.startedAt ? ` since ${formatDate(scanResult.startedAt)}` : ""}.`
                : `Scanned ${scanResult.accountsScanned} accounts, saw ${scanResult.messagesSeen} messages, fetched ${scanResult.messagesFetched}, skipped ${scanResult.messagesSkippedByFilter}, proposed ${scanResult.proposalsCreatedOrUpdated}.`}
              {!scanResult.alreadyRunning && scanResult.errors.length > 0 ? ` ${scanResult.errors.length} errors.` : ""}
            </p>
          ) : null}

          {payload.accounts.length > 0 ? (
            <div className="mt-4 space-y-3">
              {payload.accounts.map((account) => (
                <div key={account.id} className="border-t border-stone-200 pt-3 first:border-t-0 first:pt-0">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-stone-950">
                        {account.displayName ?? account.email ?? account.id}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-stone-500">
                        Last scan {formatDate(account.settings.lastScanAt)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void toggleAccount(account)}
                      disabled={busy !== null}
                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
                        account.settings.enabled ? "bg-sky-700" : "bg-stone-300"
                      } disabled:cursor-not-allowed disabled:opacity-60`}
                      aria-pressed={account.settings.enabled}
                      aria-label={`${account.settings.enabled ? "Disable" : "Enable"} ${account.email ?? "Gmail account"}`}
                      title={`${account.settings.enabled ? "Disable" : "Enable"} Gmail scan`}
                    >
                      <span
                        className={`h-5 w-5 rounded-full bg-white shadow transition ${
                          account.settings.enabled ? "translate-x-5" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-stone-500">
                    <span>{account.proposalCounts.proposed} proposed</span>
                    <span>{account.proposalCounts.accepted} accepted</span>
                    <span>{account.proposalCounts.rejected} rejected</span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {payload.setup.setupActions.length > 0 ? (
            <div className="mt-4 border-t border-stone-200 pt-4">
              <div className="flex items-center gap-2">
                <Settings className="h-4 w-4 text-amber-700" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-stone-950">Setup</h3>
              </div>
              <div className="mt-3 space-y-3">
                {payload.setup.setupActions.map((action) => (
                  <div key={action.id} className="border-l-2 border-amber-500 pl-3">
                    <p className="text-sm font-medium text-amber-950">{action.title}</p>
                    <ul className="mt-1 space-y-1 text-sm leading-5 text-amber-900">
                      {action.instructions.map((instruction) => (
                        <li key={instruction}>{instruction}</li>
                      ))}
                    </ul>
                    {action.command ? (
                      <code className="mt-2 block overflow-x-auto rounded-sm bg-stone-100 px-2 py-1 text-xs text-stone-900">
                        {action.command}
                      </code>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {payload.setup.warnings.length > 0 ? (
            <ul className="mt-3 space-y-1 text-xs leading-5 text-stone-600">
              {payload.setup.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
