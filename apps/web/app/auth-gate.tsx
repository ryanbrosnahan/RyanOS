"use client";

import { FormEvent, useEffect, useState } from "react";
import { apiFetch, apiPath } from "./api-client";

type AuthSession = {
  authMode: "required" | "dev-local";
  user?: {
    id: string;
    email: string;
    displayName?: string | null;
  };
};

type AuthMode = "sign-in" | "sign-up";

async function readResponseMessage(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) return `${response.status} ${response.statusText}`.trim();
  try {
    const parsed = JSON.parse(text) as { message?: string; error?: string };
    return parsed.message ?? parsed.error ?? text;
  } catch {
    return text;
  }
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [checked, setChecked] = useState(false);
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadSession() {
    const response = await apiFetch(apiPath("/v1/me"), { cache: "no-store" });
    if (!response.ok) {
      setSession(null);
      setChecked(true);
      return;
    }
    const payload = (await response.json()) as AuthSession | null;
    setSession(payload?.user ? payload : null);
    setChecked(true);
  }

  useEffect(() => {
    void loadSession();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const path = mode === "sign-in" ? "/auth/sign-in/email" : "/auth/sign-up/email";
      const response = await apiFetch(apiPath(path), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(mode === "sign-up" && inviteCode.trim()
            ? { "x-ryanos-invite-code": inviteCode.trim() }
            : {})
        },
        body: JSON.stringify({
          email,
          password,
          ...(mode === "sign-up" ? { name: name.trim() || email } : {})
        })
      });
      if (!response.ok) throw new Error(await readResponseMessage(response));
      await loadSession();
      setPassword("");
      setInviteCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    if (session?.authMode === "dev-local") {
      setSession(session);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(apiPath("/auth/sign-out"), { method: "POST" });
      setSession(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!checked) {
    return (
      <main className="grid min-h-screen place-items-center bg-stone-100 px-5">
        <p className="text-sm font-medium text-stone-600">Checking session...</p>
      </main>
    );
  }

  if (!session?.user) {
    return (
      <main className="grid min-h-screen place-items-center bg-stone-100 px-5">
        <form
          onSubmit={submit}
          className="w-full max-w-sm rounded-lg border border-stone-300 bg-white p-5 shadow-sm"
        >
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-sky-700">RyanOS</p>
              <h1 className="mt-1 text-xl font-semibold text-stone-950">
                {mode === "sign-in" ? "Sign in" : "Create account"}
              </h1>
            </div>
            <button
              type="button"
              onClick={() => {
                setMode(mode === "sign-in" ? "sign-up" : "sign-in");
                setError(null);
              }}
              className="h-9 rounded-md border border-stone-300 px-3 text-sm font-medium text-stone-700 hover:bg-stone-50"
            >
              {mode === "sign-in" ? "Sign up" : "Sign in"}
            </button>
          </div>

          <label className="block text-sm font-medium text-stone-700">
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3 text-sm text-stone-950 outline-none focus:border-sky-500"
            />
          </label>

          {mode === "sign-up" ? (
            <label className="mt-3 block text-sm font-medium text-stone-700">
              Name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3 text-sm text-stone-950 outline-none focus:border-sky-500"
              />
            </label>
          ) : null}

          <label className="mt-3 block text-sm font-medium text-stone-700">
            Password
            <input
              type="password"
              value={password}
              minLength={12}
              onChange={(event) => setPassword(event.target.value)}
              required
              className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3 text-sm text-stone-950 outline-none focus:border-sky-500"
            />
          </label>

          {mode === "sign-up" ? (
            <label className="mt-3 block text-sm font-medium text-stone-700">
              Invite code
              <input
                value={inviteCode}
                onChange={(event) => setInviteCode(event.target.value)}
                className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3 text-sm text-stone-950 outline-none focus:border-sky-500"
              />
            </label>
          ) : null}

          {error ? (
            <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="mt-5 h-10 w-full rounded-md bg-stone-950 px-4 text-sm font-semibold text-white hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Working..." : mode === "sign-in" ? "Sign in" : "Create account"}
          </button>
        </form>
      </main>
    );
  }

  return (
    <>
      <div className="border-b border-stone-300 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-end gap-3 px-5 py-2 text-sm text-stone-600 sm:px-8 lg:px-10">
          <span className="truncate">{session.user.email}</span>
          {session.authMode === "dev-local" ? (
            <span className="rounded-md bg-stone-100 px-2 py-1 text-xs font-medium text-stone-600">
              Local dev
            </span>
          ) : (
            <button
              type="button"
              onClick={signOut}
              disabled={busy}
              className="h-8 rounded-md border border-stone-300 px-3 font-medium text-stone-700 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Sign out
            </button>
          )}
        </div>
      </div>
      {children}
    </>
  );
}
