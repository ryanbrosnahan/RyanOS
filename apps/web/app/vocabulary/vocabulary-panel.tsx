"use client";

import {
  BookOpen,
  Check,
  Edit3,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

type VocabularyCategory =
  | "general"
  | "medical"
  | "language"
  | "technical"
  | "slang"
  | "proper_noun"
  | "other";

type VocabularyEntry = {
  id: string;
  term: string;
  normalizedTerm: string;
  languageCode: string;
  category: VocabularyCategory | string;
  definition?: string;
  partOfSpeech?: string;
  pronunciation?: string;
  translation?: string;
  notes?: string;
  tags: string[];
  definitionSource: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

type VocabularyEncounter = {
  id: string;
  entryId: string;
  sourceType?: string;
  sourceTitle?: string;
  sourceUrl?: string;
  context?: string;
  occurredAt: string;
};

type VocabularyResponse = {
  categories: VocabularyCategory[];
  entries: VocabularyEntry[];
  encountersByEntryId: Record<string, VocabularyEncounter[]>;
};

type EditState = {
  term: string;
  languageCode: string;
  category: string;
  definition: string;
  partOfSpeech: string;
  pronunciation: string;
  translation: string;
  notes: string;
  tags: string;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4100";
const userId = "local-owner";

const fallbackCategories: VocabularyCategory[] = [
  "general",
  "medical",
  "language",
  "technical",
  "slang",
  "proper_noun",
  "other"
];

function displayCategory(category: string): string {
  return category.replace("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

function categoryTone(category: string): string {
  switch (category) {
    case "medical":
      return "border-cyan-200 bg-cyan-50 text-cyan-900";
    case "language":
      return "border-indigo-200 bg-indigo-50 text-indigo-900";
    case "technical":
      return "border-sky-200 bg-sky-50 text-sky-900";
    case "slang":
      return "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-900";
    case "proper_noun":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "other":
      return "border-stone-300 bg-stone-50 text-stone-800";
    default:
      return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

function editStateFor(entry: VocabularyEntry): EditState {
  return {
    term: entry.term,
    languageCode: entry.languageCode,
    category: entry.category,
    definition: entry.definition ?? "",
    partOfSpeech: entry.partOfSpeech ?? "",
    pronunciation: entry.pronunciation ?? "",
    translation: entry.translation ?? "",
    notes: entry.notes ?? "",
    tags: entry.tags.join(", ")
  };
}

function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function VocabularyPanel() {
  const [data, setData] = useState<VocabularyResponse | null>(null);
  const [term, setTerm] = useState("");
  const [languageCode, setLanguageCode] = useState("en");
  const [category, setCategory] = useState<VocabularyCategory | "">("");
  const [context, setContext] = useState("");
  const [tagText, setTagText] = useState("");
  const [query, setQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterLanguage, setFilterLanguage] = useState("");
  const [filterTag, setFilterTag] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const categories = data?.categories ?? fallbackCategories;
  const languages = useMemo(() => {
    const values = new Set((data?.entries ?? []).map((entry) => entry.languageCode));
    values.add("en");
    values.add("es");
    return [...values].sort();
  }, [data]);
  const tags = useMemo(() => {
    const values = new Set((data?.entries ?? []).flatMap((entry) => entry.tags));
    return [...values].sort();
  }, [data]);

  async function refresh(overrides: Partial<{
    query: string;
    category: string;
    languageCode: string;
    tag: string;
  }> = {}) {
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({
        userId,
        limit: "100"
      });
      const nextQuery = overrides.query ?? query;
      const nextCategory = overrides.category ?? filterCategory;
      const nextLanguage = overrides.languageCode ?? filterLanguage;
      const nextTag = overrides.tag ?? filterTag;
      if (nextQuery.trim()) params.set("query", nextQuery.trim());
      if (nextCategory) params.set("category", nextCategory);
      if (nextLanguage.trim()) params.set("languageCode", nextLanguage.trim());
      if (nextTag.trim()) params.set("tag", nextTag.trim());
      const response = await fetch(`${apiUrl}/v1/vocabulary/entries?${params.toString()}`, {
        cache: "no-store"
      });
      if (!response.ok) throw new Error(`Vocabulary API ${response.status}`);
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

  async function addEntry(event: FormEvent) {
    event.preventDefault();
    const cleanTerm = term.trim();
    if (!cleanTerm) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${apiUrl}/v1/vocabulary/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          term: cleanTerm,
          languageCode: languageCode.trim() || "en",
          ...(category ? { category } : {}),
          ...(context.trim() ? { context: context.trim() } : {}),
          tags: parseTags(tagText)
        })
      });
      if (!response.ok) throw new Error(`Vocabulary API ${response.status}`);
      setData(await response.json());
      setTerm("");
      setContext("");
      setTagText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function applyFilters(event: FormEvent) {
    event.preventDefault();
    await refresh();
  }

  function startEdit(entry: VocabularyEntry) {
    setEditingId(entry.id);
    setEditState(editStateFor(entry));
  }

  function updateEdit(patch: Partial<EditState>) {
    setEditState((current) => current ? { ...current, ...patch } : current);
  }

  async function saveEdit(entry: VocabularyEntry) {
    if (!editState) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${apiUrl}/v1/vocabulary/entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          term: editState.term,
          languageCode: editState.languageCode,
          category: editState.category,
          definition: editState.definition,
          partOfSpeech: editState.partOfSpeech,
          pronunciation: editState.pronunciation,
          translation: editState.translation,
          notes: editState.notes,
          tags: parseTags(editState.tags)
        })
      });
      if (!response.ok) throw new Error(`Vocabulary API ${response.status}`);
      setData(await response.json());
      setEditingId(null);
      setEditState(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function archiveEntry(entry: VocabularyEntry) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${apiUrl}/v1/vocabulary/entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          deleted: true
        })
      });
      if (!response.ok) throw new Error(`Vocabulary API ${response.status}`);
      setData(await response.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <form
        onSubmit={addEntry}
        className="rounded-lg border border-stone-300 bg-white p-4 shadow-sm"
      >
        <div className="grid gap-3 lg:grid-cols-[1fr_7rem_11rem_auto]">
          <input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Add word or term"
            className="h-11 min-w-0 rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-indigo-500"
          />
          <input
            value={languageCode}
            onChange={(event) => setLanguageCode(event.target.value)}
            placeholder="en"
            className="h-11 rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-indigo-500"
          />
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value as VocabularyCategory | "")}
            className="h-11 rounded-md border border-stone-300 bg-white px-3 text-sm outline-none focus:border-indigo-500"
          >
            <option value="">Auto category</option>
            {categories.map((option) => (
              <option key={option} value={option}>
                {displayCategory(option)}
              </option>
            ))}
          </select>
          <button
            disabled={busy || !term.trim()}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-indigo-700 px-4 text-sm font-semibold text-white hover:bg-indigo-800 disabled:cursor-not-allowed disabled:bg-stone-300"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add
          </button>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_14rem]">
          <input
            value={context}
            onChange={(event) => setContext(event.target.value)}
            placeholder="Context or source note"
            className="h-11 min-w-0 rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-indigo-500"
          />
          <input
            value={tagText}
            onChange={(event) => setTagText(event.target.value)}
            placeholder="tags"
            className="h-11 rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-indigo-500"
          />
        </div>
      </form>

      <form
        onSubmit={applyFilters}
        className="rounded-lg border border-stone-300 bg-white p-4 shadow-sm"
      >
        <div className="grid gap-3 lg:grid-cols-[1fr_11rem_8rem_10rem_auto_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-stone-400" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search words"
              className="h-11 w-full rounded-md border border-stone-300 pl-9 pr-3 text-sm outline-none focus:border-indigo-500"
            />
          </div>
          <select
            value={filterCategory}
            onChange={(event) => setFilterCategory(event.target.value)}
            className="h-11 rounded-md border border-stone-300 bg-white px-3 text-sm outline-none focus:border-indigo-500"
          >
            <option value="">All categories</option>
            {categories.map((option) => (
              <option key={option} value={option}>
                {displayCategory(option)}
              </option>
            ))}
          </select>
          <select
            value={filterLanguage}
            onChange={(event) => setFilterLanguage(event.target.value)}
            className="h-11 rounded-md border border-stone-300 bg-white px-3 text-sm outline-none focus:border-indigo-500"
          >
            <option value="">Any lang</option>
            {languages.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <select
            value={filterTag}
            onChange={(event) => setFilterTag(event.target.value)}
            className="h-11 rounded-md border border-stone-300 bg-white px-3 text-sm outline-none focus:border-indigo-500"
          >
            <option value="">Any tag</option>
            {tags.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <button className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-700 hover:bg-stone-50">
            <Search className="h-4 w-4" aria-hidden="true" />
            Filter
          </button>
          <button
            type="button"
            onClick={() => refresh()}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-700 hover:bg-stone-50"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Refresh
          </button>
        </div>
      </form>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {data?.entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-stone-500">
          <BookOpen className="mx-auto mb-2 h-6 w-6" aria-hidden="true" />
          No vocabulary entries yet.
        </div>
      ) : (
        <div className="space-y-3">
          {(data?.entries ?? []).map((entry) => {
            const encounters = data?.encountersByEntryId[entry.id] ?? [];
            const isEditing = editingId === entry.id && editState !== null;
            return (
              <article
                key={entry.id}
                className="rounded-lg border border-stone-300 bg-white p-4 shadow-sm"
              >
                {isEditing ? (
                  <div className="space-y-3">
                    <div className="grid gap-3 md:grid-cols-[1fr_7rem_11rem]">
                      <input
                        value={editState.term}
                        onChange={(event) => updateEdit({ term: event.target.value })}
                        className="h-10 rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-indigo-500"
                      />
                      <input
                        value={editState.languageCode}
                        onChange={(event) => updateEdit({ languageCode: event.target.value })}
                        className="h-10 rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-indigo-500"
                      />
                      <select
                        value={editState.category}
                        onChange={(event) => updateEdit({ category: event.target.value })}
                        className="h-10 rounded-md border border-stone-300 bg-white px-3 text-sm outline-none focus:border-indigo-500"
                      >
                        {categories.map((option) => (
                          <option key={option} value={option}>
                            {displayCategory(option)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <textarea
                      value={editState.definition}
                      onChange={(event) => updateEdit({ definition: event.target.value })}
                      rows={3}
                      placeholder="Definition"
                      className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                    />
                    <div className="grid gap-3 md:grid-cols-3">
                      <input
                        value={editState.partOfSpeech}
                        onChange={(event) => updateEdit({ partOfSpeech: event.target.value })}
                        placeholder="Part of speech"
                        className="h-10 rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-indigo-500"
                      />
                      <input
                        value={editState.pronunciation}
                        onChange={(event) => updateEdit({ pronunciation: event.target.value })}
                        placeholder="Pronunciation"
                        className="h-10 rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-indigo-500"
                      />
                      <input
                        value={editState.translation}
                        onChange={(event) => updateEdit({ translation: event.target.value })}
                        placeholder="Translation"
                        className="h-10 rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-indigo-500"
                      />
                    </div>
                    <textarea
                      value={editState.notes}
                      onChange={(event) => updateEdit({ notes: event.target.value })}
                      rows={2}
                      placeholder="Notes"
                      className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                    />
                    <input
                      value={editState.tags}
                      onChange={(event) => updateEdit({ tags: event.target.value })}
                      placeholder="tags"
                      className="h-10 w-full rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-indigo-500"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(null);
                          setEditState(null);
                        }}
                        className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-700 hover:bg-stone-50"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => saveEdit(entry)}
                        className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-indigo-700 px-3 text-sm font-semibold text-white hover:bg-indigo-800"
                      >
                        <Check className="h-4 w-4" aria-hidden="true" />
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-lg font-semibold text-stone-950">{entry.term}</h2>
                          <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${categoryTone(entry.category)}`}>
                            {displayCategory(entry.category)}
                          </span>
                          <span className="rounded-md border border-stone-300 bg-stone-50 px-2 py-1 text-xs font-semibold text-stone-700">
                            {entry.languageCode}
                          </span>
                          {entry.partOfSpeech ? (
                            <span className="text-xs text-stone-500">{entry.partOfSpeech}</span>
                          ) : null}
                        </div>
                        {entry.pronunciation ? (
                          <p className="mt-1 text-sm text-stone-500">{entry.pronunciation}</p>
                        ) : null}
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(entry)}
                          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-700 hover:bg-stone-50"
                        >
                          <Edit3 className="h-4 w-4" aria-hidden="true" />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => archiveEntry(entry)}
                          className="inline-flex h-9 items-center justify-center rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-700 hover:bg-stone-50"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    <p className="text-sm leading-6 text-stone-800">
                      {entry.definition?.trim() || "No definition yet."}
                    </p>

                    {entry.translation ? (
                      <p className="text-sm text-stone-600">
                        Translation: <span className="font-medium text-stone-800">{entry.translation}</span>
                      </p>
                    ) : null}

                    {entry.notes ? (
                      <p className="whitespace-pre-wrap text-sm text-stone-600">{entry.notes}</p>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
                      <span>Updated {formatDate(entry.updatedAt)}</span>
                      <span>{entry.definitionSource.replace("_", " ")}</span>
                      {entry.tags.map((tag) => (
                        <span key={tag} className="rounded-md bg-stone-100 px-2 py-1 text-stone-700">
                          {tag}
                        </span>
                      ))}
                    </div>

                    {encounters.length > 0 ? (
                      <div className="rounded-md border border-stone-200 bg-stone-50 p-3">
                        <h3 className="text-xs font-semibold uppercase tracking-normal text-stone-500">
                          Encounters
                        </h3>
                        <div className="mt-2 space-y-2">
                          {encounters.map((encounter) => (
                            <div key={encounter.id} className="text-sm text-stone-700">
                              <div className="flex flex-wrap gap-2 text-xs text-stone-500">
                                <span>{formatDate(encounter.occurredAt)}</span>
                                {encounter.sourceType ? <span>{encounter.sourceType}</span> : null}
                                {encounter.sourceTitle ? <span>{encounter.sourceTitle}</span> : null}
                              </div>
                              {encounter.context ? (
                                <p className="mt-1 text-stone-700">{encounter.context}</p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
