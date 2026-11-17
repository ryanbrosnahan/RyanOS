import Link from 'next/link';
import { AuthGate } from '../auth-gate';
import { SharedPanel } from './shared-panel';
export default function SharedPage() {
  return <AuthGate><main className="min-h-screen bg-stone-50">
    <header className="border-b border-stone-300 bg-stone-100"><div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6">
      <div><p className="text-sm font-medium text-stone-600">RyanOS</p><h1 className="text-3xl font-semibold text-stone-950">Shared</h1><p className="mt-2 text-sm text-stone-600">Keep useful links and evidence. Review ideas before acting.</p></div>
      <Link href="/" className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm">Today</Link>
    </div></header><section className="mx-auto max-w-6xl px-5 py-6"><SharedPanel /></section>
  </main></AuthGate>;
}
