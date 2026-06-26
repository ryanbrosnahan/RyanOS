"use client";

import {
  Bot,
  Brain,
  CheckCircle2,
  ChevronDown,
  Download,
  Mail,
  Play,
  RefreshCw,
  Settings,
  ShieldCheck,
  Smartphone
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiFetch, apiPath } from "../api-client";

type SetupAction = {
  id: string;
  title: string;
  blocking: boolean;
  instructions: string[];
  command?: string;
  docs?: string[];
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

type LinkedTelegramAccount = {
  id: string;
  displayName?: string;
  status: string;
  linkedAt?: string;
};

type Integration = {
  id: "ai" | "telegram" | "gmail";
  name: string;
  configured: boolean;
  ready: boolean;
  setupRequired: boolean;
  enabled: boolean;
  effectiveReady: boolean;
  setupActions: SetupAction[];
  warnings: string[];
  accounts?: GmailAccount[];
  linkedAccounts?: LinkedTelegramAccount[];
  counts?: {
    proposed: number;
    accepted: number;
    rejected: number;
  };
  config?: {
    query: string;
    maxPerAccount: number;
    cadenceMinutes: number;
    enabled: boolean;
  };
  canManageDeployment?: boolean;
};

type IntegrationsResponse = {
  user: {
    id: string;
    role: "superadmin" | "user";
  };
  deployment?: {
    providerAccounts: Array<{
      provider: string;
      status: string;
      accountCount: number;
      userCount: number;
    }>;
    integrationSettings: Array<{
      integrationId: string;
      enabled: boolean;
      userCount: number;
    }>;
  };
  integrations: Integration[];
};

type AndroidManifest = {
  versionCode?: number;
  versionName?: string;
  apkUrl?: string;
};

type LinkCodeResponse = {
  code: string;
  expiresAt: string;
  instructions: string[];
};

const iconByIntegration = {
  ai: Brain,
  telegram: Bot,
  gmail: Mail
} satisfies Record<Integration["id"], typeof Brain>;

async function readResponseMessage(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) return `${response.status} ${response.statusText}`.trim();
  try {
    const parsed = JSON.parse(text) as { error?: string; message?: string };
    return parsed.error ?? parsed.message ?? text;
  } catch {
    return text;
  }
}

function statusLabel(integration: Integration): string {
  if (!integration.enabled) return "Disabled";
  if (integration.effectiveReady) return "Ready";
  if (integration.setupRequired) return "Needs setup";
  if (!integration.configured) return "Not configured";
  return "Not ready";
}

function statusTone(integration: Integration): string {
  if (!integration.enabled) return "bg-stone-100 text-stone-700";
  if (integration.effectiveReady) return "bg-emerald-50 text-emerald-800";
  if (integration.setupRequired) return "bg-amber-50 text-amber-900";
  return "bg-stone-100 text-stone-700";
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

function Toggle({
  checked,
  disabled,
  label,
  onChange
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={`group relative inline-flex w-11 shrink-0 rounded-full p-0.5 outline-offset-2 outline-sky-700 ring-1 ring-inset ring-stone-900/5 transition-colors duration-200 ease-in-out has-[:checked]:bg-sky-700 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 ${
        disabled ? "cursor-not-allowed bg-stone-200 opacity-60" : "cursor-pointer bg-stone-200"
      }`}
    >
      <span className="size-5 rounded-full bg-white shadow-sm ring-1 ring-stone-900/5 transition-transform duration-200 ease-in-out group-has-[:checked]:translate-x-5" />
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(event.target.checked)}
        className="absolute inset-0 size-full appearance-none focus:outline-none"
      />
    </label>
  );
}

function SetupActions({ actions, warnings }: { actions: SetupAction[]; warnings: string[] }) {
  if (actions.length === 0 && warnings.length === 0) return null;
  return (
    <div className="mt-3 space-y-3 border-t border-stone-200 pt-3">
      {actions.map((action) => (
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
      {warnings.length > 0 ? (
        <ul className="space-y-1 text-xs leading-5 text-stone-600">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function AdminOperationsPanel() {
  const [payload, setPayload] = useState<IntegrationsResponse | null>(null);
  const [androidManifest, setAndroidManifest] = useState<AndroidManifest | null>(null);
  const [expanded, setExpanded] = useState<Integration["id"] | null>("gmail");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gmailEmail, setGmailEmail] = useState("");
  const [gmailAuthUrl, setGmailAuthUrl] = useState("");
  const [gmailRedirectUrl, setGmailRedirectUrl] = useState("");
  const [telegramToken, setTelegramToken] = useState("");
  const [telegramLink, setTelegramLink] = useState<LinkCodeResponse | null>(null);

  async function load(options?: { background?: boolean }) {
    if (!options?.background) {
      setLoading(true);
      setError(null);
    }
    try {
      const response = await apiFetch(apiPath("/v1/integrations"), {
        cache: "no-store"
      });
      if (!response.ok) throw new Error(await readResponseMessage(response));
      setPayload((await response.json()) as IntegrationsResponse);
    } catch (err) {
      if (!options?.background) setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    fetch("/downloads/android/manifest.json", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((manifest) => setAndroidManifest(manifest))
      .catch(() => setAndroidManifest(null));
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void load({ background: true });
    }, 60000);
    return () => window.clearInterval(interval);
  }, []);

  const integrations = payload?.integrations ?? [];
  const deployment = payload?.deployment;
  const integrationById = useMemo(
    () => new Map(integrations.map((integration) => [integration.id, integration])),
    [integrations]
  );

  async function toggleIntegration(integration: Integration, enabled: boolean) {
    setBusy(`toggle:${integration.id}`);
    setError(null);
    try {
      const response = await apiFetch(apiPath(`/v1/integrations/${integration.id}/settings`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled })
      });
      if (!response.ok) throw new Error(await readResponseMessage(response));
      await load({ background: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function toggleGmailAccount(account: GmailAccount) {
    setBusy(`gmail:${account.id}`);
    setError(null);
    try {
      const response = await apiFetch(apiPath(`/v1/email/accounts/${encodeURIComponent(account.id)}/settings`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !account.settings.enabled })
      });
      if (!response.ok) throw new Error(await readResponseMessage(response));
      await load({ background: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function syncGmailAccounts() {
    setBusy("gmail:sync");
    setError(null);
    try {
      const response = await apiFetch(apiPath("/v1/email/accounts/sync"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      if (!response.ok) throw new Error(await readResponseMessage(response));
      await load({ background: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function scanGmail() {
    setBusy("gmail:scan");
    setError(null);
    try {
      const response = await apiFetch(apiPath("/v1/email/scan"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ syncAccounts: true })
      });
      if (!response.ok) throw new Error(await readResponseMessage(response));
      await load({ background: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function startGmailAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("gmail:auth-start");
    setError(null);
    setGmailAuthUrl("");
    try {
      const response = await apiFetch(apiPath("/v1/integrations/gmail/auth/start"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: gmailEmail })
      });
      if (!response.ok) throw new Error(await readResponseMessage(response));
      const result = (await response.json()) as { authUrl: string };
      setGmailAuthUrl(result.authUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function completeGmailAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("gmail:auth-complete");
    setError(null);
    try {
      const response = await apiFetch(apiPath("/v1/integrations/gmail/auth/complete"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: gmailEmail, redirectUrl: gmailRedirectUrl })
      });
      if (!response.ok) throw new Error(await readResponseMessage(response));
      setGmailRedirectUrl("");
      setGmailAuthUrl("");
      await load({ background: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function saveTelegramToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("telegram:token");
    setError(null);
    try {
      const response = await apiFetch(apiPath("/v1/admin/integrations/telegram/bot-token"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: telegramToken })
      });
      if (!response.ok) throw new Error(await readResponseMessage(response));
      setTelegramToken("");
      await load({ background: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function createTelegramLink() {
    setBusy("telegram:link");
    setError(null);
    try {
      const response = await apiFetch(apiPath("/v1/integrations/telegram/link-code"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      if (!response.ok) throw new Error(await readResponseMessage(response));
      setTelegramLink((await response.json()) as LinkCodeResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const summaryCards = [
    {
      label: "AI provider",
      value: integrationById.get("ai") ? statusLabel(integrationById.get("ai")!) : "Loading",
      icon: Brain
    },
    {
      label: "Telegram",
      value: integrationById.get("telegram") ? statusLabel(integrationById.get("telegram")!) : "Loading",
      icon: Bot
    },
    {
      label: "Gmail",
      value: integrationById.get("gmail") ? statusLabel(integrationById.get("gmail")!) : "Loading",
      icon: Mail
    },
    {
      label: "Android app",
      value: androidManifest?.versionName ? `v${androidManifest.versionName}` : "APK",
      icon: Smartphone
    },
    {
      label: "Secrets",
      value: "Encrypted DB",
      icon: ShieldCheck
    }
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {summaryCards.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="rounded-md border border-stone-300 bg-white px-4 py-3 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-stone-600">{item.label}</p>
                <Icon className="h-4 w-4 text-sky-700" aria-hidden="true" />
              </div>
              <p className="mt-2 truncate text-base font-semibold text-stone-950">{item.value}</p>
            </div>
          );
        })}
      </div>

      <div className="rounded-md border border-stone-300 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-sky-700" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-stone-950">Integrations</h2>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-stone-300 text-stone-700 hover:bg-stone-100"
            aria-label="Refresh integrations"
            title="Refresh integrations"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
          </button>
        </div>

        {error ? <p className="mt-3 text-sm leading-6 text-rose-700">{error}</p> : null}
        {!error && loading && integrations.length === 0 ? (
          <p className="mt-3 text-sm leading-6 text-stone-600">Loading integrations...</p>
        ) : null}

        {deployment ? (
          <div className="mt-4 border-t border-stone-200 pt-3">
            <p className="text-xs font-semibold uppercase tracking-normal text-stone-500">
              Deployment summary
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-stone-600">
              {deployment.providerAccounts.length === 0 && deployment.integrationSettings.length === 0 ? (
                <span>No linked accounts or user-level overrides yet.</span>
              ) : null}
              {deployment.providerAccounts.map((summary) => (
                <span
                  key={`${summary.provider}:${summary.status}`}
                  className="rounded-md bg-stone-100 px-2 py-1"
                >
                  {summary.provider} {summary.status}: {summary.accountCount} account
                  {summary.accountCount === 1 ? "" : "s"} across {summary.userCount} user
                  {summary.userCount === 1 ? "" : "s"}
                </span>
              ))}
              {deployment.integrationSettings.map((summary) => (
                <span
                  key={`${summary.integrationId}:${summary.enabled}`}
                  className="rounded-md bg-stone-100 px-2 py-1"
                >
                  {summary.integrationId} {summary.enabled ? "enabled" : "disabled"} override:{" "}
                  {summary.userCount} user{summary.userCount === 1 ? "" : "s"}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-4 divide-y divide-stone-200">
          {integrations.map((integration) => {
            const Icon = iconByIntegration[integration.id];
            const open = expanded === integration.id;
            return (
              <div key={integration.id} className="py-4 first:pt-0 last:pb-0">
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                  <div className="flex min-w-0 items-center gap-3">
                    <Icon className="h-5 w-5 shrink-0 text-sky-700" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-stone-950">{integration.name}</p>
                      <p className="mt-0.5 text-xs text-stone-500">
                        {integration.id === "gmail"
                          ? `${integration.accounts?.length ?? 0} accounts`
                          : integration.id === "telegram"
                            ? `${integration.linkedAccounts?.length ?? 0} linked`
                            : "Assistant bridge"}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 md:justify-end">
                    <span className={`rounded-md px-2 py-1 text-xs font-medium ${statusTone(integration)}`}>
                      {statusLabel(integration)}
                    </span>
                    <Toggle
                      checked={integration.enabled}
                      disabled={busy !== null}
                      label={`${integration.enabled ? "Disable" : "Enable"} ${integration.name}`}
                      onChange={(checked) => void toggleIntegration(integration, checked)}
                    />
                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : integration.id)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-300 px-2 text-sm font-medium text-stone-700 hover:bg-stone-100"
                    >
                      Settings
                      <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {open ? (
                  <div className="mt-4 border-t border-stone-200 pt-4">
                    <SetupActions actions={integration.setupActions} warnings={integration.warnings} />

                    {integration.id === "gmail" ? (
                      <div className="mt-4 space-y-4">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void syncGmailAccounts()}
                            disabled={busy !== null}
                            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-stone-300 px-3 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <RefreshCw className={`h-4 w-4 ${busy === "gmail:sync" ? "animate-spin" : ""}`} aria-hidden="true" />
                            Sync
                          </button>
                          <button
                            type="button"
                            onClick={() => void scanGmail()}
                            disabled={busy !== null || !integration.effectiveReady}
                            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-stone-950 px-3 text-sm font-medium text-white hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <Play className="h-4 w-4" aria-hidden="true" />
                            Scan now
                          </button>
                        </div>

                        <form onSubmit={startGmailAuth} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                          <label className="block text-sm font-medium text-stone-700">
                            Gmail account
                            <input
                              type="email"
                              value={gmailEmail}
                              onChange={(event) => setGmailEmail(event.target.value)}
                              className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3 text-sm text-stone-950 outline-none focus:border-sky-500"
                              required
                            />
                          </label>
                          <button
                            type="submit"
                            disabled={busy !== null}
                            className="self-end inline-flex h-10 items-center justify-center rounded-md border border-stone-300 px-3 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Start auth
                          </button>
                        </form>

                        {gmailAuthUrl ? (
                          <form onSubmit={completeGmailAuth} className="space-y-3">
                            <a
                              href={gmailAuthUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-9 items-center rounded-md bg-sky-700 px-3 text-sm font-medium text-white hover:bg-sky-800"
                            >
                              Open Google auth
                            </a>
                            <label className="block text-sm font-medium text-stone-700">
                              Redirect URL
                              <textarea
                                value={gmailRedirectUrl}
                                onChange={(event) => setGmailRedirectUrl(event.target.value)}
                                rows={3}
                                className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-950 outline-none focus:border-sky-500"
                                required
                              />
                            </label>
                            <button
                              type="submit"
                              disabled={busy !== null}
                              className="inline-flex h-9 items-center rounded-md bg-stone-950 px-3 text-sm font-medium text-white hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Complete auth
                            </button>
                          </form>
                        ) : null}

                        {integration.accounts && integration.accounts.length > 0 ? (
                          <div className="space-y-3">
                            {integration.accounts.map((account) => (
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
                                  <Toggle
                                    checked={account.settings.enabled}
                                    disabled={busy !== null}
                                    label={`${account.settings.enabled ? "Disable" : "Enable"} ${account.email ?? "Gmail account"}`}
                                    onChange={() => void toggleGmailAccount(account)}
                                  />
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
                      </div>
                    ) : null}

                    {integration.id === "telegram" ? (
                      <div className="mt-4 space-y-4">
                        {integration.canManageDeployment ? (
                          <form onSubmit={saveTelegramToken} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                            <label className="block text-sm font-medium text-stone-700">
                              Bot token
                              <input
                                type="password"
                                value={telegramToken}
                                onChange={(event) => setTelegramToken(event.target.value)}
                                className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3 text-sm text-stone-950 outline-none focus:border-sky-500"
                                required
                              />
                            </label>
                            <button
                              type="submit"
                              disabled={busy !== null}
                              className="self-end inline-flex h-10 items-center justify-center rounded-md bg-stone-950 px-3 text-sm font-medium text-white hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Save token
                            </button>
                          </form>
                        ) : null}

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void createTelegramLink()}
                            disabled={busy !== null}
                            className="inline-flex h-9 items-center rounded-md border border-stone-300 px-3 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Generate link code
                          </button>
                          {telegramLink ? (
                            <span className="rounded-md bg-stone-100 px-3 py-2 text-sm font-semibold tracking-normal text-stone-950">
                              {telegramLink.code}
                            </span>
                          ) : null}
                        </div>

                        {integration.linkedAccounts && integration.linkedAccounts.length > 0 ? (
                          <div className="space-y-2">
                            {integration.linkedAccounts.map((account) => (
                              <div key={account.id} className="flex items-center justify-between gap-3 border-t border-stone-200 pt-3 first:border-t-0 first:pt-0">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold text-stone-950">
                                    {account.displayName ?? account.id}
                                  </p>
                                  <p className="mt-0.5 text-xs text-stone-500">Linked {formatDate(account.linkedAt)}</p>
                                </div>
                                <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800">
                                  {account.status}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-md border border-stone-300 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <Smartphone className="h-5 w-5 text-sky-700" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-stone-950">Android app</h2>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="text-sm text-stone-700">
            {androidManifest?.versionName
              ? `Version ${androidManifest.versionName} (${androidManifest.versionCode ?? "latest"})`
              : "Latest APK"}
          </span>
          <a
            href={androidManifest?.apkUrl ?? "/downloads/android/ryanos-latest.apk"}
            className="inline-flex h-9 items-center justify-center rounded-md bg-stone-950 px-3 text-sm font-medium text-white hover:bg-stone-800"
          >
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            Download APK
          </a>
        </div>
      </div>
    </div>
  );
}
