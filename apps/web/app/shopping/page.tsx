import Link from "next/link";
import { AuthGate } from "../auth-gate";
import { ShoppingListPanel } from "./shopping-list-panel";

export default function ShoppingPage() {
  return (
    <AuthGate>
      <main className="min-h-screen bg-stone-50">
        <section className="border-b border-stone-300 bg-stone-100">
          <div className="mx-auto flex max-w-5xl flex-col gap-4 px-5 py-6 sm:px-8 lg:px-10">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-sm font-medium text-emerald-700">RyanOS</p>
                <h1 className="mt-1 text-3xl font-semibold tracking-normal text-stone-950">
                  Shopping
                </h1>
              </div>
              <Link
                href="/"
                className="inline-flex h-9 items-center justify-center rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-700 hover:bg-stone-50"
              >
                Today
              </Link>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-5 py-6 sm:px-8 lg:px-10">
          <ShoppingListPanel />
        </section>
      </main>
    </AuthGate>
  );
}
