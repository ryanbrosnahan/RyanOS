import Link from "next/link";
import { AuthGate } from "../auth-gate";
import { CalendarWorkspace } from "./workspace";

export default function CalendarPage() {
  return (
    <AuthGate>
      <main className="min-h-screen">
        <header className="border-b border-stone-300 bg-stone-100">
          <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-4 px-5 py-5 sm:px-8 lg:px-10">
            <div>
              <p className="text-sm font-medium text-sky-700">RyanOS</p>
              <h1 className="mt-1 text-2xl font-semibold text-stone-950">Calendar</h1>
            </div>
            <div className="flex gap-2">
              <Link href="/admin" className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700">
                Admin
              </Link>
              <Link href="/" className="rounded-md bg-stone-950 px-3 py-2 text-sm font-medium text-white">
                Today
              </Link>
            </div>
          </div>
        </header>
        <CalendarWorkspace />
      </main>
    </AuthGate>
  );
}
