"use client";

import Link from "next/link";
import { MessageSquare, X } from "lucide-react";
import { useEffect, useState } from "react";
import { ChatPanel } from "./chat-panel";
import { DailyFocusPanel } from "./daily-focus-panel";
import { EmailProposalsPanel } from "./email-proposals-panel";
import { ItemsPanel } from "./items-panel";
import { OpportunityProposalsPanel } from "./opportunity-proposals-panel";

export function HomeDashboard() {
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => {
    if (!chatOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setChatOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [chatOpen]);

  return (
    <>
      <section className="border-b border-stone-300 bg-stone-100">
        <div className="mx-auto flex max-w-screen-2xl flex-col gap-5 px-5 py-6 sm:px-8 lg:px-10">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-medium text-sky-700">RyanOS</p>
              <h1 className="mt-1 text-3xl font-semibold tracking-normal text-stone-950">
                Today
              </h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/vocabulary"
                className="inline-flex h-9 items-center justify-center rounded-md border border-indigo-200 bg-indigo-50 px-3 text-sm font-medium text-indigo-900 hover:bg-indigo-100"
              >
                Vocabulary
              </Link>
              <Link
                href="/shopping"
                className="inline-flex h-9 items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 px-3 text-sm font-medium text-emerald-900 hover:bg-emerald-100"
              >
                Shopping
              </Link>
              <Link
                href="/admin"
                className="inline-flex h-9 items-center justify-center rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-700 hover:bg-stone-50"
              >
                Admin
              </Link>
              <button
                type="button"
                onClick={() => setChatOpen(true)}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 text-sm font-medium text-sky-900 hover:bg-sky-100"
                aria-haspopup="dialog"
              >
                <MessageSquare className="h-4 w-4" aria-hidden="true" />
                Chat
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto flex max-w-screen-2xl flex-col gap-6 px-5 py-6 sm:px-8 lg:px-10">
        <DailyFocusPanel />
        <ItemsPanel />

        <div className="grid gap-6 xl:grid-cols-2">
          <OpportunityProposalsPanel />
          <EmailProposalsPanel />
        </div>
      </section>

      {chatOpen ? (
        <div
          className="fixed inset-0 z-50 flex bg-stone-950/35 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Assistant chat"
        >
          <div className="relative flex h-full w-full min-h-0 flex-col bg-white shadow-xl sm:mx-auto sm:max-w-4xl sm:rounded-md sm:border sm:border-stone-300">
            <button
              type="button"
              onClick={() => setChatOpen(false)}
              className="absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md bg-white text-stone-600 ring-1 ring-stone-200 hover:bg-stone-50 hover:text-stone-950"
              aria-label="Close chat"
              title="Close chat"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
            <ChatPanel variant="overlay" />
          </div>
        </div>
      ) : null}
    </>
  );
}
