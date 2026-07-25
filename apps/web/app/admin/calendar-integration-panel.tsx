"use client";

import { CalendarDays, ChevronDown, ExternalLink, Plus, RefreshCw } from "lucide-react";
import { FormEvent, useState } from "react";
import { apiFetch, apiPath } from "../api-client";

export type AdminGoogleCalendar = {
  id: string;
  externalCalendarId: string;
  name: string;
  timezone?: string;
  accessRole: string;
  backgroundColor?: string;
  primary: boolean;
  selectedForAvailability: boolean;
  allDayBlocksAvailability: boolean;
  writeEnabled: boolean;
  status: string;
  lastSyncedAt?: string;
  lastError?: string;
};

export type CalendarIntegrationStatus = {
  configured: boolean;
  ready: boolean;
  warnings: string[];
  settings: { enabled: boolean };
  health: {
    status: "not_configured" | "healthy" | "degraded";
    stale: boolean;
    lastSuccessAt?: string;
    accountErrors: Array<{ accountId: string; error: string }>;
  };
  accounts: Array<{
    id: string;
    email?: string;
    displayName?: string;
    status: string;
    scopes: string[];
    settings: {
      enabled: boolean;
      lastSyncAt?: string;
      lastSuccessAt?: string;
      lastError?: string;
    };
    calendars: AdminGoogleCalendar[];
  }>;
};

type Props = {
  calendar: CalendarIntegrationStatus;
  onRefresh: () => Promise<void>;
};

async function responseError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => ({})) as { error?: string };
  return payload.error ?? `Request failed with ${response.status}`;
}

export function CalendarIntegrationPanel({ calendar, onRefresh }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [email, setEmail] = useState("");
  const [authUrl, setAuthUrl] = useState("");
  const [redirectUrl, setRedirectUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function mutate(key: string, path: string, init: RequestInit) {
    setBusy(key);
    setError(null);
    try {
      const response = await apiFetch(apiPath(path), init);
      if (!response.ok) throw new Error(await responseError(response));
      await onRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }

  async function startAuth(event: FormEvent) {
    event.preventDefault();
    setBusy("auth-start");
    setError(null);
    try {
      const response = await apiFetch(apiPath("/v1/integrations/calendar/auth/start"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email })
      });
      if (!response.ok) throw new Error(await responseError(response));
      const payload = await response.json() as { authUrl: string };
      setAuthUrl(payload.authUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }

  async function completeAuth(event: FormEvent) {
    event.preventDefault();
    setBusy("auth-complete");
    setError(null);
    try {
      const response = await apiFetch(apiPath("/v1/integrations/calendar/auth/complete"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, redirectUrl })
      });
      if (!response.ok) throw new Error(await responseError(response));
      setEmail("");
      setAuthUrl("");
      setRedirectUrl("");
      setShowAdd(false);
      await onRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void mutate("sync", "/v1/integrations/calendar/sync", { method: "POST" })}
          disabled={busy !== null}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${busy === "sync" ? "animate-spin" : ""}`} aria-hidden="true" />
          Sync
        </button>
        <button
          type="button"
          onClick={() => setShowAdd((value) => !value)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-stone-950 text-white hover:bg-stone-800"
          aria-label="Add Google Calendar account"
          title="Add Google Calendar account"
        >
          {showAdd ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
        </button>
        <span className="text-xs text-stone-500">
          {calendar.health.lastSuccessAt
            ? `Last sync ${new Date(calendar.health.lastSuccessAt).toLocaleString()}`
            : "No successful sync yet"}
        </span>
      </div>

      {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}

      {showAdd ? (
        <div className="border-y border-stone-200 py-4">
          <form onSubmit={startAuth} className="flex flex-col gap-2 sm:flex-row">
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              required
              placeholder="Google account email"
              className="h-10 min-w-0 flex-1 rounded-md border border-stone-300 bg-white px-3 text-sm"
            />
            <button
              type="submit"
              disabled={busy !== null}
              className="h-10 rounded-md bg-stone-950 px-4 text-sm font-medium text-white disabled:opacity-60"
            >
              Authorize
            </button>
          </form>
          {authUrl ? (
            <form onSubmit={completeAuth} className="mt-3 space-y-2">
              <a
                href={authUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-sky-700 hover:text-sky-900"
              >
                Open Google authorization
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={redirectUrl}
                  onChange={(event) => setRedirectUrl(event.target.value)}
                  type="url"
                  required
                  placeholder="Paste the final redirect URL"
                  className="h-10 min-w-0 flex-1 rounded-md border border-stone-300 bg-white px-3 text-sm"
                />
                <button
                  type="submit"
                  disabled={busy !== null}
                  className="h-10 rounded-md bg-stone-950 px-4 text-sm font-medium text-white disabled:opacity-60"
                >
                  Finish
                </button>
              </div>
            </form>
          ) : null}
        </div>
      ) : null}

      {calendar.accounts.length === 0 ? (
        <p className="text-sm text-stone-600">No Google Calendar accounts connected.</p>
      ) : (
        <div className="divide-y divide-stone-200 border-y border-stone-200">
          {calendar.accounts.map((account) => (
            <div key={account.id} className="py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-stone-950">
                    {account.displayName || account.email}
                  </p>
                  <p className="text-xs text-stone-500">{account.email}</p>
                </div>
                <label className="flex items-center gap-2 text-sm text-stone-700">
                  <input
                    type="checkbox"
                    aria-label={`${account.email || account.displayName || "Google Calendar"} account enabled`}
                    checked={account.settings.enabled}
                    onChange={(event) => void mutate(
                      `account:${account.id}`,
                      `/v1/integrations/calendar/accounts/${encodeURIComponent(account.id)}`,
                      {
                        method: "PATCH",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ enabled: event.target.checked })
                      }
                    )}
                  />
                  Enabled
                </label>
              </div>
              <div className="mt-3 divide-y divide-stone-100">
                {account.calendars.map((entry) => {
                  const writable = ["owner", "writer"].includes(entry.accessRole);
                  return (
                    <div key={entry.id} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className="h-3 w-3 shrink-0 rounded-sm border border-stone-300"
                          style={{ backgroundColor: entry.backgroundColor || "#d6d3d1" }}
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-stone-900">
                            {entry.name}{entry.primary ? " (Primary)" : ""}
                          </p>
                          <p className="text-xs text-stone-500">
                            {entry.timezone || "Calendar timezone"} / {entry.accessRole}
                          </p>
                        </div>
                      </div>
                      <CalendarToggle
                        label="Availability"
                        ariaLabel={`${entry.name} availability`}
                        checked={entry.selectedForAvailability}
                        disabled={busy !== null}
                        onChange={(checked) => void mutate(
                          `calendar:${entry.id}:read`,
                          `/v1/integrations/calendar/calendars/${encodeURIComponent(entry.id)}`,
                          {
                            method: "PATCH",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({ selectedForAvailability: checked })
                          }
                        )}
                      />
                      <CalendarToggle
                        label="All-day busy"
                        ariaLabel={`${entry.name} all-day busy`}
                        checked={entry.allDayBlocksAvailability}
                        disabled={busy !== null}
                        onChange={(checked) => void mutate(
                          `calendar:${entry.id}:all-day`,
                          `/v1/integrations/calendar/calendars/${encodeURIComponent(entry.id)}`,
                          {
                            method: "PATCH",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({ allDayBlocksAvailability: checked })
                          }
                        )}
                      />
                      <CalendarToggle
                        label="Write target"
                        ariaLabel={`${entry.name} write target`}
                        checked={entry.writeEnabled}
                        disabled={busy !== null || !writable}
                        onChange={(checked) => void mutate(
                          `calendar:${entry.id}:write`,
                          `/v1/integrations/calendar/calendars/${encodeURIComponent(entry.id)}`,
                          {
                            method: "PATCH",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({ writeEnabled: checked })
                          }
                        )}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 text-xs leading-5 text-stone-500">
        <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
        Calendar titles, times, locations, and links are cached. Descriptions and attendees are fetched only when opened.
      </div>
    </div>
  );
}

function CalendarToggle(props: {
  label: string;
  ariaLabel: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 whitespace-nowrap text-xs text-stone-600">
      <input
        type="checkbox"
        aria-label={props.ariaLabel}
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      {props.label}
    </label>
  );
}
