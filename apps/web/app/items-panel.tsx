"use client";

import { CheckCircle2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

type Item = {
  id: string;
  kind: string;
  title: string;
  status: string;
  priority: string;
  dueAt?: string;
};

type ItemsResponse = {
  items: Item[];
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4100";

function formatDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

export function ItemsPanel() {
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadItems() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        userId: "local-owner",
        status: "open,active,waiting",
        limit: "12"
      });
      const response = await fetch(`${apiUrl}/v1/items?${params.toString()}`, {
        cache: "no-store"
      });
      if (!response.ok) throw new Error(`Items returned ${response.status}`);
      const payload = (await response.json()) as ItemsResponse;
      setItems(payload.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadItems();
  }, []);

  return (
    <div className="rounded-md border border-stone-300 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-emerald-700" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-stone-950">Open items</h2>
        </div>
        <button
          type="button"
          onClick={() => void loadItems()}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-stone-300 text-stone-700 hover:bg-stone-100"
          aria-label="Refresh open items"
          title="Refresh open items"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
        </button>
      </div>

      {error ? <p className="mt-3 text-sm leading-6 text-rose-700">{error}</p> : null}

      {!error && loading && items.length === 0 ? (
        <p className="mt-3 text-sm leading-6 text-stone-600">Loading items...</p>
      ) : null}

      {!error && !loading && items.length === 0 ? (
        <p className="mt-3 text-sm leading-6 text-stone-600">No open items.</p>
      ) : null}

      {items.length > 0 ? (
        <div className="mt-4 divide-y divide-stone-200">
          {items.map((item) => {
            const due = formatDate(item.dueAt);
            return (
              <div key={item.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-stone-950">{item.title}</p>
                  <p className="mt-1 text-xs text-stone-600">
                    {item.kind} / {item.priority} / {item.status}
                  </p>
                </div>
                {due ? (
                  <span className="shrink-0 rounded-md bg-stone-100 px-2 py-1 text-xs font-medium text-stone-700">
                    {due}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
