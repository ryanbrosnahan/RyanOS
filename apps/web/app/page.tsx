import {
  Activity,
  Bell,
  Brain,
  CheckCircle2,
  Database,
  FolderKanban,
  RefreshCw,
  ShieldCheck
} from "lucide-react";
import { ChatPanel } from "./chat-panel";
import { ItemsPanel } from "./items-panel";
import { SetupStatusPanel } from "./setup-status-panel";

const systemStatus = [
  { label: "Assistant intake", value: "Chat + Telegram", icon: Brain },
  { label: "Task ledger", value: "Events + audit", icon: CheckCircle2 },
  { label: "Scope map", value: "Areas + projects", icon: FolderKanban },
  { label: "Refresh loop", value: "Live polling", icon: RefreshCw },
  { label: "Secrets", value: "Encrypted DB fields", icon: ShieldCheck }
];

export default function Home() {
  return (
    <main className="min-h-screen">
      <section className="border-b border-stone-300 bg-stone-100">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 py-6 sm:px-8 lg:px-10">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-medium text-emerald-700">RyanOS</p>
              <h1 className="mt-1 text-3xl font-semibold tracking-normal text-stone-950">
                Personal operations dashboard
              </h1>
            </div>
            <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              <Activity className="h-4 w-4" aria-hidden="true" />
              Local system active
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {systemStatus.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.label}
                  className="rounded-md border border-stone-300 bg-white px-4 py-3 shadow-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-stone-600">{item.label}</p>
                    <Icon className="h-4 w-4 text-sky-700" aria-hidden="true" />
                  </div>
                  <p className="mt-2 text-base font-semibold text-stone-950">{item.value}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-5 py-6 sm:px-8 lg:grid-cols-[1.2fr_0.8fr] lg:px-10">
        <div className="space-y-6">
          <ChatPanel />
          <ItemsPanel />
        </div>

        <aside className="space-y-4">
          <SetupStatusPanel />

          <div className="rounded-md border border-stone-300 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 text-sky-700" aria-hidden="true" />
              <h2 className="text-lg font-semibold text-stone-950">Core state</h2>
            </div>
            <dl className="mt-4 grid gap-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-stone-600">Canonical store</dt>
                <dd className="font-medium text-stone-950">PostgreSQL</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-stone-600">Tool boundary</dt>
                <dd className="font-medium text-stone-950">Typed JSON</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-stone-600">Dashboard refresh</dt>
                <dd className="font-medium text-stone-950">Polling</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-md border border-stone-300 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-rose-700" aria-hidden="true" />
              <h2 className="text-lg font-semibold text-stone-950">Notification stance</h2>
            </div>
            <p className="mt-3 text-sm leading-6 text-stone-700">
              Policies live in the database and are changed through typed tools, so chat can
              adjust quiet hours, nag intensity, and escalation without a custom parser.
            </p>
          </div>
        </aside>
      </section>
    </main>
  );
}
