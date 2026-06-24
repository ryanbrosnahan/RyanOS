"use client";

import { Check, Circle, Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export type ItemProgressSummary = {
  progress?: {
    count: number;
    latest?: ProgressNote;
  };
  checklist?: {
    total: number;
    completed: number;
  };
};

export type ProgressNote = {
  id: string;
  body: string;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
};

export type ChecklistItem = {
  id: string;
  title: string;
  checked: boolean;
  checkedAt?: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

type DetailItem = {
  id: string;
  title: string;
} & ItemProgressSummary;

type DetailsPayload<TItem extends DetailItem> = {
  item: TItem;
  progressNotes: ProgressNote[];
  checklistItems: ChecklistItem[];
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4100";

function formatTimestamp(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone
  }).format(new Date(value));
}

function progressLabel(item: ItemProgressSummary): string | undefined {
  const noteCount = item.progress?.count ?? 0;
  const total = item.checklist?.total ?? 0;
  const completed = item.checklist?.completed ?? 0;
  const labels = [];
  if (noteCount > 0) labels.push(`${noteCount} note${noteCount === 1 ? "" : "s"}`);
  if (total > 0) labels.push(`${completed}/${total} steps`);
  return labels.length > 0 ? labels.join(" / ") : undefined;
}

export function ItemProgressSummaryLine({ item }: { item: ItemProgressSummary }) {
  const label = progressLabel(item);
  if (!label) return null;
  return <span className="text-xs font-medium text-stone-500">{label}</span>;
}

export function ItemProgressDetails<TItem extends DetailItem>({
  item,
  timezone,
  onChanged
}: {
  item: TItem;
  timezone: string;
  onChanged?: (item: TItem) => void;
}) {
  const [details, setDetails] = useState<DetailsPayload<TItem> | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noteBody, setNoteBody] = useState("");
  const [checklistTitle, setChecklistTitle] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteBody, setEditingNoteBody] = useState("");
  const [editingChecklistId, setEditingChecklistId] = useState<string | null>(null);
  const [editingChecklistTitle, setEditingChecklistTitle] = useState("");

  const progressNotes = details?.progressNotes ?? [];
  const checklistItems = details?.checklistItems ?? [];
  const checklistSummary = useMemo(() => {
    const completed = checklistItems.filter((checklistItem) => checklistItem.checked).length;
    return { completed, total: checklistItems.length };
  }, [checklistItems]);

  async function loadDetails(options?: { background?: boolean }) {
    if (!options?.background) setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        userId: "local-owner",
        timezone
      });
      const response = await fetch(`${apiUrl}/v1/items/${encodeURIComponent(item.id)}/details?${params.toString()}`, {
        cache: "no-store"
      });
      if (!response.ok) throw new Error(`Details returned ${response.status}`);
      const payload = (await response.json()) as DetailsPayload<TItem>;
      setDetails(payload);
      onChanged?.(payload.item);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function applyPayload(response: Response) {
    if (!response.ok) throw new Error(`Update returned ${response.status}`);
    const payload = (await response.json()) as DetailsPayload<TItem>;
    setDetails(payload);
    onChanged?.(payload.item);
    window.dispatchEvent(new Event("ryanos-items-refresh"));
    window.dispatchEvent(new Event("ryanos-focus-refresh"));
  }

  async function addNote() {
    const body = noteBody.trim();
    if (!body) return;
    setPendingKey("note:add");
    setError(null);
    try {
      await applyPayload(await fetch(`${apiUrl}/v1/items/${encodeURIComponent(item.id)}/progress-notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "local-owner", timezone, body })
      }));
      setNoteBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingKey(null);
    }
  }

  async function updateNote(noteId: string) {
    const body = editingNoteBody.trim();
    if (!body) return;
    setPendingKey(`${noteId}:note:update`);
    setError(null);
    try {
      await applyPayload(await fetch(`${apiUrl}/v1/items/${encodeURIComponent(item.id)}/progress-notes/${encodeURIComponent(noteId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "local-owner", timezone, body })
      }));
      setEditingNoteId(null);
      setEditingNoteBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingKey(null);
    }
  }

  async function deleteNote(noteId: string) {
    setPendingKey(`${noteId}:note:delete`);
    setError(null);
    try {
      await applyPayload(await fetch(`${apiUrl}/v1/items/${encodeURIComponent(item.id)}/progress-notes/${encodeURIComponent(noteId)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "local-owner", timezone })
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingKey(null);
    }
  }

  async function addChecklistItem() {
    const title = checklistTitle.trim();
    if (!title) return;
    setPendingKey("checklist:add");
    setError(null);
    try {
      await applyPayload(await fetch(`${apiUrl}/v1/items/${encodeURIComponent(item.id)}/checklist-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "local-owner", timezone, title })
      }));
      setChecklistTitle("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingKey(null);
    }
  }

  async function patchChecklistItem(checklistItemId: string, patch: { title?: string; checked?: boolean }) {
    setPendingKey(`${checklistItemId}:checklist`);
    setError(null);
    try {
      await applyPayload(await fetch(`${apiUrl}/v1/items/${encodeURIComponent(item.id)}/checklist-items/${encodeURIComponent(checklistItemId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "local-owner", timezone, ...patch })
      }));
      setEditingChecklistId(null);
      setEditingChecklistTitle("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingKey(null);
    }
  }

  async function deleteChecklistItem(checklistItemId: string) {
    setPendingKey(`${checklistItemId}:checklist:delete`);
    setError(null);
    try {
      await applyPayload(await fetch(`${apiUrl}/v1/items/${encodeURIComponent(item.id)}/checklist-items/${encodeURIComponent(checklistItemId)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "local-owner", timezone })
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingKey(null);
    }
  }

  useEffect(() => {
    void loadDetails();
  }, [item.id, timezone]);

  return (
    <div className="mt-3 rounded-md border border-stone-200 bg-stone-50 p-3">
      {loading ? (
        <p className="text-xs text-stone-500">Loading details...</p>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <section>
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Progress</h4>
              <span className="text-xs text-stone-500">{progressNotes.length}</span>
            </div>
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                value={noteBody}
                onChange={(event) => setNoteBody(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void addNote();
                }}
                placeholder="Add progress note"
                className="h-9 min-w-0 flex-1 rounded-md border border-stone-300 bg-white px-2 text-sm text-stone-900 outline-none focus:border-sky-700 focus:ring-2 focus:ring-sky-100"
              />
              <button
                type="button"
                onClick={() => void addNote()}
                disabled={pendingKey === "note:add" || noteBody.trim().length === 0}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-stone-900 text-white hover:bg-stone-700 disabled:cursor-wait disabled:opacity-50"
                aria-label="Add progress note"
                title="Add note"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {progressNotes.length === 0 ? (
                <p className="text-xs leading-5 text-stone-500">No progress notes yet.</p>
              ) : (
                progressNotes.map((note) => (
                  <div key={note.id} className="rounded-md bg-white px-3 py-2 ring-1 ring-stone-200">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-medium text-stone-500">
                        {formatTimestamp(note.occurredAt, timezone)}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingNoteId(note.id);
                            setEditingNoteBody(note.body);
                          }}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100 hover:text-stone-900"
                          aria-label="Edit progress note"
                          title="Edit note"
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteNote(note.id)}
                          disabled={pendingKey === `${note.id}:note:delete`}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-stone-500 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-wait disabled:opacity-50"
                          aria-label="Delete progress note"
                          title="Delete note"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </span>
                    </div>
                    {editingNoteId === note.id ? (
                      <div className="mt-2 flex gap-2">
                        <input
                          type="text"
                          value={editingNoteBody}
                          onChange={(event) => setEditingNoteBody(event.target.value)}
                          className="h-8 min-w-0 flex-1 rounded-md border border-stone-300 bg-white px-2 text-sm text-stone-900 outline-none focus:border-sky-700 focus:ring-2 focus:ring-sky-100"
                        />
                        <button
                          type="button"
                          onClick={() => void updateNote(note.id)}
                          disabled={pendingKey === `${note.id}:note:update` || editingNoteBody.trim().length === 0}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-stone-900 text-white hover:bg-stone-700 disabled:cursor-wait disabled:opacity-50"
                          aria-label="Save progress note"
                          title="Save"
                        >
                          <Check className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingNoteId(null)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100 hover:text-stone-900"
                          aria-label="Cancel progress note edit"
                          title="Cancel"
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    ) : (
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-stone-800">{note.body}</p>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Checklist</h4>
              <span className="text-xs text-stone-500">
                {checklistSummary.completed}/{checklistSummary.total}
              </span>
            </div>
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                value={checklistTitle}
                onChange={(event) => setChecklistTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void addChecklistItem();
                }}
                placeholder="Add checklist step"
                className="h-9 min-w-0 flex-1 rounded-md border border-stone-300 bg-white px-2 text-sm text-stone-900 outline-none focus:border-sky-700 focus:ring-2 focus:ring-sky-100"
              />
              <button
                type="button"
                onClick={() => void addChecklistItem()}
                disabled={pendingKey === "checklist:add" || checklistTitle.trim().length === 0}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-stone-900 text-white hover:bg-stone-700 disabled:cursor-wait disabled:opacity-50"
                aria-label="Add checklist item"
                title="Add step"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="mt-3 space-y-1.5">
              {checklistItems.length === 0 ? (
                <p className="text-xs leading-5 text-stone-500">No checklist steps yet.</p>
              ) : (
                checklistItems.map((checklistItem) => (
                  <div key={checklistItem.id} className="flex items-center gap-2 rounded-md bg-white px-2 py-1.5 ring-1 ring-stone-200">
                    <button
                      type="button"
                      onClick={() => void patchChecklistItem(checklistItem.id, { checked: !checklistItem.checked })}
                      disabled={pendingKey === `${checklistItem.id}:checklist`}
                      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${
                        checklistItem.checked
                          ? "text-emerald-700 hover:bg-emerald-50"
                          : "text-stone-500 hover:bg-stone-100 hover:text-stone-900"
                      } disabled:cursor-wait disabled:opacity-50`}
                      aria-label={checklistItem.checked ? "Uncheck checklist item" : "Check checklist item"}
                      title={checklistItem.checked ? "Uncheck" : "Check"}
                    >
                      {checklistItem.checked ? (
                        <Check className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Circle className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                    {editingChecklistId === checklistItem.id ? (
                      <input
                        type="text"
                        value={editingChecklistTitle}
                        onChange={(event) => setEditingChecklistTitle(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            void patchChecklistItem(checklistItem.id, { title: editingChecklistTitle.trim() });
                          }
                        }}
                        className="h-8 min-w-0 flex-1 rounded-md border border-stone-300 bg-white px-2 text-sm text-stone-900 outline-none focus:border-sky-700 focus:ring-2 focus:ring-sky-100"
                      />
                    ) : (
                      <span className={`min-w-0 flex-1 truncate text-sm ${checklistItem.checked ? "text-stone-500 line-through" : "text-stone-800"}`}>
                        {checklistItem.title}
                      </span>
                    )}
                    {editingChecklistId === checklistItem.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void patchChecklistItem(checklistItem.id, { title: editingChecklistTitle.trim() })}
                          disabled={editingChecklistTitle.trim().length === 0}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-stone-700 hover:bg-stone-100 disabled:cursor-wait disabled:opacity-50"
                          aria-label="Save checklist item"
                          title="Save"
                        >
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingChecklistId(null)}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100 hover:text-stone-900"
                          aria-label="Cancel checklist edit"
                          title="Cancel"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingChecklistId(checklistItem.id);
                          setEditingChecklistTitle(checklistItem.title);
                        }}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100 hover:text-stone-900"
                        aria-label="Edit checklist item"
                        title="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void deleteChecklistItem(checklistItem.id)}
                      disabled={pendingKey === `${checklistItem.id}:checklist:delete`}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-stone-500 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-wait disabled:opacity-50"
                      aria-label="Delete checklist item"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      )}
      {error ? <p className="mt-3 text-xs font-medium text-rose-700">{error}</p> : null}
    </div>
  );
}
