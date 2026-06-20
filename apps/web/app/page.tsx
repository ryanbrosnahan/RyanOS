import Link from "next/link";
import { ChatPanel } from "./chat-panel";
import { DailyFocusPanel } from "./daily-focus-panel";
import { EmailProposalsPanel } from "./email-proposals-panel";
import { ItemsPanel } from "./items-panel";

export default function Home() {
  return (
    <main className="min-h-screen">
      <section className="border-b border-stone-300 bg-stone-100">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 py-6 sm:px-8 lg:px-10">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-medium text-sky-700">RyanOS</p>
              <h1 className="mt-1 text-3xl font-semibold tracking-normal text-stone-950">
                Today
              </h1>
            </div>
            <div className="flex flex-wrap gap-2">
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
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-6 sm:px-8 lg:px-10">
        <DailyFocusPanel />

        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <ChatPanel />
          <div className="space-y-6">
            <EmailProposalsPanel />
            <ItemsPanel />
          </div>
        </div>
      </section>
    </main>
  );
}
