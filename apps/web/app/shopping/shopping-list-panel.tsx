"use client";

import { Check, Plus, RefreshCw, RotateCcw, ShoppingBasket, Star } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiFetch, apiPath } from "../api-client";

type ShoppingCategory = "grocery" | "personal care" | "household good" | "health" | "miscellaneous";

type ShoppingItem = {
  id: string;
  name: string;
  normalizedName: string;
  category: ShoppingCategory | string;
  quantity?: string;
  note?: string;
  checked: boolean;
  checkedAt?: string;
  staple: boolean;
};

type ShoppingSuggestion = {
  id: string;
  name: string;
  normalizedName: string;
  category: ShoppingCategory | string;
  lastPurchasedAt?: string;
  purchaseCount: number;
  staple: boolean;
};

type ShoppingResponse = {
  categories: ShoppingCategory[];
  items: ShoppingItem[];
  suggestions: ShoppingSuggestion[];
};

const fallbackCategories: ShoppingCategory[] = [
  "grocery",
  "personal care",
  "household good",
  "health",
  "miscellaneous"
];

type ShoppingStapleTarget = Pick<ShoppingItem | ShoppingSuggestion, "name" | "normalizedName" | "category" | "staple">;

function categoryTone(category: string): string {
  switch (category) {
    case "grocery":
      return "border-emerald-200 bg-emerald-50 text-emerald-900";
    case "personal care":
      return "border-sky-200 bg-sky-50 text-sky-900";
    case "household good":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "health":
      return "border-cyan-200 bg-cyan-50 text-cyan-900";
    default:
      return "border-stone-300 bg-stone-50 text-stone-800";
  }
}

function displayCategory(category: string): string {
  return category.slice(0, 1).toUpperCase() + category.slice(1);
}

function formatLastBought(value: string | undefined): string {
  if (!value) return "staple";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

export function ShoppingListPanel() {
  const [data, setData] = useState<ShoppingResponse | null>(null);
  const [title, setTitle] = useState("");
  const [quantity, setQuantity] = useState("");
  const [category, setCategory] = useState<ShoppingCategory | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const categories = data?.categories ?? fallbackCategories;
  const activeItems = useMemo(
    () =>
      [...(data?.items.filter((item) => !item.checked) ?? [])].sort((a, b) => {
        if (a.staple !== b.staple) return a.staple ? -1 : 1;
        return a.name.localeCompare(b.name);
      }),
    [data?.items]
  );
  const checkedItems = data?.items.filter((item) => item.checked) ?? [];
  const grouped = useMemo(() => {
    const groups = new Map<string, ShoppingItem[]>();
    for (const item of activeItems) {
      groups.set(item.category, [...(groups.get(item.category) ?? []), item]);
    }
    return [...groups.entries()];
  }, [activeItems]);

  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch(apiPath("/v1/shopping/list"));
      if (!response.ok) throw new Error(`Shopping API ${response.status}`);
      setData(await response.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function addItem(event: FormEvent) {
    event.preventDefault();
    const name = title.trim();
    if (!name) return;
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch(apiPath("/v1/shopping/items"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          ...(quantity.trim() ? { quantity: quantity.trim() } : {}),
          ...(category ? { category } : {})
        })
      });
      if (!response.ok) throw new Error(`Shopping API ${response.status}`);
      setData(await response.json());
      setTitle("");
      setQuantity("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function addSuggestion(suggestion: ShoppingSuggestion) {
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch(apiPath("/v1/shopping/items"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: suggestion.name,
          category: suggestion.category
        })
      });
      if (!response.ok) throw new Error(`Shopping API ${response.status}`);
      setData(await response.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleItem(item: ShoppingItem, checked: boolean) {
    const previous = data;
    if (previous) {
      setData({
        ...previous,
        items: previous.items.map((candidate) =>
          candidate.id === item.id
            ? {
                ...candidate,
                checked,
                checkedAt: checked ? new Date().toISOString() : undefined
              }
            : candidate
        )
      });
    }
    try {
      const response = await apiFetch(apiPath(`/v1/shopping/items/${item.id}/check`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checked })
      });
      if (!response.ok) throw new Error(`Shopping API ${response.status}`);
      setData(await response.json());
    } catch (err) {
      if (previous) setData(previous);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function setStaple(target: ShoppingStapleTarget, staple: boolean) {
    const previous = data;
    if (previous) {
      setData({
        ...previous,
        items: previous.items.map((item) =>
          item.normalizedName === target.normalizedName ? { ...item, staple } : item
        ),
        suggestions: previous.suggestions.map((suggestion) =>
          suggestion.normalizedName === target.normalizedName ? { ...suggestion, staple } : suggestion
        )
      });
    }
    try {
      const response = await apiFetch(apiPath("/v1/shopping/staples"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: target.name,
          normalizedName: target.normalizedName,
          category: target.category,
          staple
        })
      });
      if (!response.ok) throw new Error(`Shopping API ${response.status}`);
      setData(await response.json());
    } catch (err) {
      if (previous) setData(previous);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-5">
      <form
        onSubmit={addItem}
        className="rounded-lg border border-stone-300 bg-white p-4 shadow-sm"
      >
        <div className="flex flex-col gap-3 md:flex-row">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Add item"
            className="h-11 min-w-0 flex-1 rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-emerald-500"
          />
          <input
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            placeholder="Qty"
            className="h-11 rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-emerald-500 md:w-28"
          />
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value as ShoppingCategory | "")}
            className="h-11 rounded-md border border-stone-300 bg-white px-3 text-sm outline-none focus:border-emerald-500 md:w-44"
          >
            <option value="">Auto category</option>
            {categories.map((option) => (
              <option key={option} value={option}>
                {displayCategory(option)}
              </option>
            ))}
          </select>
          <button
            disabled={busy || !title.trim()}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-stone-300"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add
          </button>
        </div>
      </form>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-stone-950">List</h2>
        <button
          onClick={refresh}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-700 hover:bg-stone-50"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Refresh
        </button>
      </div>

      {grouped.length === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-stone-500">
          <ShoppingBasket className="mx-auto mb-2 h-6 w-6" aria-hidden="true" />
          Nothing on the list.
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([group, items]) => (
            <section key={group} className="rounded-lg border border-stone-300 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${categoryTone(group)}`}>
                  {displayCategory(group)}
                </span>
                <span className="text-xs text-stone-500">{items.length}</span>
              </div>
              <div className="divide-y divide-stone-200">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="flex w-full items-center gap-3 py-3 text-left hover:bg-stone-50"
                  >
                    <button
                      type="button"
                      onClick={() => toggleItem(item, true)}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-stone-300 text-stone-500 hover:bg-white"
                      aria-label={`Mark ${item.name} bought`}
                      title="Bought"
                    >
                      <Check className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-stone-950">{item.name}</span>
                      {[item.quantity, item.note].filter(Boolean).length > 0 ? (
                        <span className="block truncate text-xs text-stone-500">
                          {[item.quantity, item.note].filter(Boolean).join(" / ")}
                        </span>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      onClick={() => void setStaple(item, !item.staple)}
                      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
                        item.staple
                          ? "text-amber-700 hover:bg-amber-50"
                          : "text-stone-400 hover:bg-stone-100 hover:text-amber-700"
                      }`}
                      aria-label={item.staple ? `Unset ${item.name} as staple` : `Set ${item.name} as staple`}
                      aria-pressed={item.staple}
                      title={item.staple ? "Unset staple" : "Set staple"}
                    >
                      <Star className={`h-4 w-4 ${item.staple ? "fill-current" : ""}`} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {data?.suggestions.length ? (
        <section className="rounded-lg border border-stone-300 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-base font-semibold text-stone-950">Staples</h2>
          <div className="flex flex-wrap gap-2">
            {data.suggestions.map((suggestion) => (
              <span
                key={suggestion.id}
                className="inline-flex items-center gap-1 rounded-md border border-stone-300 bg-stone-50 p-1 text-sm text-stone-800"
              >
                <button
                  type="button"
                  onClick={() => addSuggestion(suggestion)}
                  className="inline-flex min-w-0 items-center gap-2 rounded px-2 py-1 hover:bg-stone-100"
                >
                  <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="max-w-48 truncate">{suggestion.name}</span>
                  <span className="text-xs text-stone-500">{formatLastBought(suggestion.lastPurchasedAt)}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void setStaple(suggestion, !suggestion.staple)}
                  className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded ${
                    suggestion.staple
                      ? "text-amber-700 hover:bg-amber-50"
                      : "text-stone-400 hover:bg-stone-100 hover:text-amber-700"
                  }`}
                  aria-label={suggestion.staple ? `Unset ${suggestion.name} as staple` : `Set ${suggestion.name} as staple`}
                  aria-pressed={suggestion.staple}
                  title={suggestion.staple ? "Unset staple" : "Set staple"}
                >
                  <Star className={`h-3.5 w-3.5 ${suggestion.staple ? "fill-current" : ""}`} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {checkedItems.length > 0 ? (
        <section className="rounded-lg border border-stone-300 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-base font-semibold text-stone-950">Checked today</h2>
          <div className="divide-y divide-stone-200">
            {checkedItems.map((item) => (
              <div
                key={item.id}
                className="flex w-full items-center gap-3 py-3 text-left hover:bg-stone-50"
              >
                <button
                  type="button"
                  onClick={() => toggleItem(item, false)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-stone-200 text-stone-600 hover:bg-stone-300"
                  aria-label={`Restore ${item.name}`}
                  title="Restore"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                </button>
                <span className="min-w-0 flex-1 truncate text-sm text-stone-500 line-through">
                  {item.name}
                </span>
                <button
                  type="button"
                  onClick={() => void setStaple(item, !item.staple)}
                  className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
                    item.staple
                      ? "text-amber-700 hover:bg-amber-50"
                      : "text-stone-400 hover:bg-stone-100 hover:text-amber-700"
                  }`}
                  aria-label={item.staple ? `Unset ${item.name} as staple` : `Set ${item.name} as staple`}
                  aria-pressed={item.staple}
                  title={item.staple ? "Unset staple" : "Set staple"}
                >
                  <Star className={`h-4 w-4 ${item.staple ? "fill-current" : ""}`} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
