"use client";

import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Send,
  Trash2,
  X
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, apiPath } from "../api-client";
import type { AdminGoogleCalendar, CalendarIntegrationStatus } from "../admin/calendar-integration-panel";

type CalendarEvent = {
  id: string;
  googleCalendarId: string;
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  status: string;
  location?: string;
  htmlLink?: string;
  ryanosOwned: boolean;
  metadata: Record<string, unknown>;
};

type TimeBlock = {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  status: "draft" | "published" | "failed" | "removed";
  pinned: boolean;
  error?: string;
};

type PlanPayload = {
  plan?: {
    id: string;
    status: string;
    dateKey: string;
    timezone: string;
    metadata: Record<string, unknown>;
  };
  blocks: TimeBlock[];
  unscheduledItems: Array<{ id: string; title: string; priority: string; dueAt?: string }>;
};

type RulePayload = {
  policy: {
    id: string;
    status: string;
  };
  rule: TimeBlockRule;
};

type TimeBlockRule = {
  name: string;
  timezone: string;
  availability: Record<string, Array<{ start: string; end: string }>>;
  targetCalendarId: string;
  includeStarred: boolean;
  includeDue: boolean;
  areaIds: string[];
  projectIds: string[];
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  defaultEstimateMinutes: number;
  minimumChunkMinutes: number;
  maximumBlockMinutes: number;
  splitTasks: boolean;
  scheduledDraftTime?: string;
};

const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(value: string, amount: number): string {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return dateKey(date);
}

function weekStart(value: string): Date {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() - date.getDay());
  date.setHours(0, 0, 0, 0);
  return date;
}

function inputDateTime(iso: string): string {
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toIso(local: string): string {
  return new Date(local).toISOString();
}

async function readError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => ({})) as { error?: string };
  return payload.error ?? `Request failed with ${response.status}`;
}

function blankRule(calendars: AdminGoogleCalendar[]): TimeBlockRule {
  return {
    name: "Daily schedule",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago",
    availability: Object.fromEntries(Array.from({ length: 7 }, (_, day) => [
      String(day),
      []
    ])),
    targetCalendarId: calendars.find((calendar) => calendar.writeEnabled)?.id ?? "",
    includeStarred: true,
    includeDue: true,
    areaIds: [],
    projectIds: [],
    bufferBeforeMinutes: 15,
    bufferAfterMinutes: 15,
    defaultEstimateMinutes: 30,
    minimumChunkMinutes: 15,
    maximumBlockMinutes: 120,
    splitTasks: true
  };
}

export function CalendarWorkspace() {
  const [selectedDate, setSelectedDate] = useState(() => dateKey(new Date()));
  const [integration, setIntegration] = useState<CalendarIntegrationStatus | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [plan, setPlan] = useState<PlanPayload>({ blocks: [], unscheduledItems: [] });
  const [rules, setRules] = useState<RulePayload[]>([]);
  const [ruleDraft, setRuleDraft] = useState<TimeBlockRule | null>(null);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [showEventForm, setShowEventForm] = useState(false);
  const [eventDraft, setEventDraft] = useState({
    title: "",
    startAt: `${dateKey(new Date())}T09:00`,
    endAt: `${dateKey(new Date())}T09:30`,
    googleCalendarId: "",
    location: ""
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const start = weekStart(selectedDate);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const [integrationResponse, eventsResponse, planResponse, rulesResponse] = await Promise.all([
      apiFetch(apiPath("/v1/integrations/calendar"), { cache: "no-store" }),
      apiFetch(apiPath(`/v1/calendar/events?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`), { cache: "no-store" }),
      apiFetch(apiPath(`/v1/calendar/plans?date=${selectedDate}`), { cache: "no-store" }),
      apiFetch(apiPath("/v1/calendar/rules"), { cache: "no-store" })
    ]);
    if (!integrationResponse.ok) throw new Error(await readError(integrationResponse));
    const integrationPayload = await integrationResponse.json() as CalendarIntegrationStatus;
    setIntegration(integrationPayload);
    if (eventsResponse.ok) {
      setEvents(((await eventsResponse.json()) as { events: CalendarEvent[] }).events);
    } else {
      setEvents([]);
    }
    if (planResponse.ok) setPlan(await planResponse.json() as PlanPayload);
    if (rulesResponse.ok) setRules(((await rulesResponse.json()) as { rules: RulePayload[] }).rules);
    const writable = integrationPayload.accounts.flatMap((account) => account.calendars).find((calendar) => calendar.writeEnabled);
    setEventDraft((current) => ({
      ...current,
      googleCalendarId: current.googleCalendarId || writable?.id || ""
    }));
  }, [selectedDate]);

  useEffect(() => {
    setError(null);
    void load().catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, [load]);

  const calendars = useMemo(
    () => integration?.accounts.flatMap((account) => account.calendars) ?? [],
    [integration]
  );
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => {
      const start = weekStart(selectedDate);
      start.setDate(start.getDate() + index);
      return start;
    }),
    [selectedDate]
  );

  async function action(key: string, path: string, init: RequestInit) {
    setBusy(key);
    setError(null);
    try {
      const response = await apiFetch(apiPath(path), init);
      if (!response.ok) throw new Error(await readError(response));
      await load();
      return response;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  async function saveRule(event: FormEvent) {
    event.preventDefault();
    if (!ruleDraft) return;
    const method = editingRuleId ? "PUT" : "POST";
    const path = editingRuleId ? `/v1/calendar/rules/${editingRuleId}` : "/v1/calendar/rules";
    const response = await action("rule", path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...ruleDraft, enabled: true })
    });
    if (response) {
      setShowRuleForm(false);
      setEditingRuleId(null);
    }
  }

  async function createEvent(event: FormEvent) {
    event.preventDefault();
    const response = await action("event", "/v1/calendar/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...eventDraft,
        startAt: toIso(eventDraft.startAt),
        endAt: toIso(eventDraft.endAt),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      })
    });
    if (response) {
      setShowEventForm(false);
      setEventDraft((current) => ({ ...current, title: "", location: "" }));
    }
  }

  function beginRule(rule?: RulePayload) {
    setEditingRuleId(rule?.policy.id ?? null);
    setRuleDraft(rule?.rule ?? blankRule(calendars));
    setShowRuleForm(true);
  }

  function setAvailabilityDay(day: number, enabled: boolean) {
    setRuleDraft((current) => current ? {
      ...current,
      availability: {
        ...current.availability,
        [String(day)]: enabled
          ? (current.availability[String(day)]?.length ? current.availability[String(day)] : [{ start: "08:00", end: "17:00" }])
          : []
      }
    } : current);
  }

  const visibleBlocks = plan.blocks.filter((block) => block.status !== "removed");
  const agendaForDate = (key: string) => [
    ...events
      .filter((entry) => dateKey(new Date(entry.startAt)) === key)
      .map((entry) => ({ ...entry, source: "event" as const })),
    ...visibleBlocks
      .filter((entry) => dateKey(new Date(entry.startAt)) === key)
      .map((entry) => ({ ...entry, source: "block" as const }))
  ].sort((a, b) => a.startAt.localeCompare(b.startAt));
  const selectedDayAgenda = agendaForDate(selectedDate);

  return (
    <section className="mx-auto max-w-screen-2xl space-y-6 px-5 py-6 sm:px-8 lg:px-10">
      <div className="flex flex-col gap-3 border-b border-stone-300 pb-5 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setSelectedDate(addDays(selectedDate, -7))} className="icon-button" aria-label="Previous week">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <input
            type="date"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
            className="h-9 rounded-md border border-stone-300 bg-white px-3 text-sm"
          />
          <button type="button" onClick={() => setSelectedDate(addDays(selectedDate, 7))} className="icon-button" aria-label="Next week">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void action("sync", "/v1/integrations/calendar/sync", { method: "POST" })}
            disabled={busy !== null}
            className="secondary-button"
          >
            <RefreshCw className={`h-4 w-4 ${busy === "sync" ? "animate-spin" : ""}`} /> Sync
          </button>
          <button type="button" onClick={() => setShowEventForm(true)} className="secondary-button">
            <CalendarPlus className="h-4 w-4" /> Event
          </button>
          <button
            type="button"
            onClick={() => void action("generate", "/v1/calendar/plans/generate", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ date: selectedDate })
            })}
            disabled={busy !== null || rules.filter((rule) => rule.policy.status === "active").length === 0}
            className="primary-button"
          >
            <Clock3 className="h-4 w-4" /> Build day
          </button>
        </div>
      </div>

      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
      {!integration?.configured ? (
        <p className="border-y border-stone-200 py-6 text-sm text-stone-600">
          Connect Google Calendar in Admin before building a schedule.
        </p>
      ) : null}

      <div className="grid grid-cols-7 gap-1 md:hidden">
        {days.map((day) => {
          const key = dateKey(day);
          return (
            <button
              key={key}
              type="button"
              onClick={() => setSelectedDate(key)}
              className={`min-w-0 rounded-md border px-1 py-2 text-center ${
                key === selectedDate
                  ? "border-sky-600 bg-sky-50 text-sky-900"
                  : "border-stone-300 bg-white text-stone-700"
              }`}
              aria-label={`${weekdayLabels[day.getDay()]} ${day.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
            >
              <span className="block text-[0.65rem] font-medium uppercase">{weekdayLabels[day.getDay()]}</span>
              <span className="mt-0.5 block text-sm font-semibold">{day.getDate()}</span>
            </button>
          );
        })}
      </div>

      <div className="rounded-md border border-stone-300 bg-white p-4 md:hidden">
        <p className="text-sm font-semibold text-stone-950">
          {new Date(`${selectedDate}T12:00:00`).toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric"
          })}
        </p>
        <div className="mt-3 divide-y divide-stone-200">
          {selectedDayAgenda.length === 0 ? (
            <p className="py-3 text-sm text-stone-500">No events or time blocks.</p>
          ) : null}
          {selectedDayAgenda.map((entry) => (
            <div key={`${entry.source}:${entry.id}`} className="flex items-start gap-3 py-3">
              <p className="w-16 shrink-0 text-xs font-medium text-stone-500">
                {new Date(entry.startAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </p>
              <div className={`min-w-0 border-l-2 pl-2 ${entry.source === "block" ? "border-sky-600" : "border-stone-400"}`}>
                <p className="break-words text-sm font-medium text-stone-900">{entry.title}</p>
                <p className="mt-0.5 text-xs text-stone-500">{entry.source === "block" ? "Time block" : "Calendar"}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="hidden gap-px overflow-hidden rounded-md border border-stone-300 bg-stone-300 md:grid md:grid-cols-7">
        {days.map((day) => {
          const key = dateKey(day);
          return (
            <div key={key} className={`min-h-40 bg-white p-3 ${key === selectedDate ? "ring-2 ring-inset ring-sky-500" : ""}`}>
              <button type="button" onClick={() => setSelectedDate(key)} className="w-full text-left">
                <p className="text-xs font-medium uppercase text-stone-500">{weekdayLabels[day.getDay()]}</p>
                <p className="mt-0.5 text-sm font-semibold text-stone-950">{day.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</p>
              </button>
              <div className="mt-3 space-y-2">
                {agendaForDate(key).map((entry) => (
                    <div key={`${entry.source}:${entry.id}`} className={`border-l-2 pl-2 text-xs ${entry.source === "block" ? "border-sky-600" : "border-stone-400"}`}>
                      <p className="font-medium text-stone-900">{entry.title}</p>
                      <p className="text-stone-500">{new Date(entry.startAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>
                    </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(20rem,0.6fr)]">
        <section className="min-w-0">
          <div className="flex items-center justify-between gap-3 border-b border-stone-300 pb-3">
            <div>
              <h2 className="text-lg font-semibold text-stone-950">Schedule draft</h2>
              <p className="text-sm text-stone-500">{plan.plan ? `${plan.plan.status} / ${selectedDate}` : "No draft for this day"}</p>
            </div>
            {plan.plan && visibleBlocks.some((block) => block.status === "draft" || block.status === "failed") ? (
              <button
                type="button"
                onClick={() => void action("publish", `/v1/calendar/plans/${plan.plan!.id}/publish`, { method: "POST" })}
                disabled={busy !== null}
                className="primary-button"
              >
                <Send className="h-4 w-4" /> Publish
              </button>
            ) : null}
          </div>
          <div className="divide-y divide-stone-200">
            {visibleBlocks.length === 0 ? <p className="py-6 text-sm text-stone-500">Build the day to preview task blocks.</p> : null}
            {visibleBlocks.map((block) => (
              <TimeBlockRow
                key={block.id}
                block={block}
                editable={block.status !== "published"}
                onSave={(patch) => action(`block:${block.id}`, `/v1/calendar/plans/${plan.plan!.id}/blocks/${block.id}`, {
                  method: "PATCH",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(patch)
                })}
                onRemove={() => action(`block:${block.id}`, `/v1/calendar/plans/${plan.plan!.id}/blocks/${block.id}`, {
                  method: "PATCH",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ removed: true })
                })}
              />
            ))}
          </div>
          {plan.unscheduledItems.length > 0 ? (
            <div className="border-t border-stone-300 pt-4">
              <h3 className="text-sm font-semibold text-stone-950">Still unscheduled</h3>
              <ul className="mt-2 space-y-1 text-sm text-stone-600">
                {plan.unscheduledItems.map((item) => <li key={item.id}>{item.title}</li>)}
              </ul>
            </div>
          ) : null}
        </section>

        <section>
          <div className="flex items-center justify-between gap-3 border-b border-stone-300 pb-3">
            <div>
              <h2 className="text-lg font-semibold text-stone-950">Scheduling rules</h2>
              <p className="text-sm text-stone-500">Availability, buffers, and task sizing</p>
            </div>
            <button type="button" onClick={() => beginRule()} className="icon-button" aria-label="Add scheduling rule" title="Add scheduling rule">
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <div className="divide-y divide-stone-200">
            {rules.map((entry) => (
              <div key={entry.policy.id} className="flex items-start justify-between gap-3 py-4">
                <div>
                  <p className="text-sm font-semibold text-stone-950">{entry.rule.name}</p>
                  <p className="mt-1 text-xs text-stone-500">
                    {entry.rule.defaultEstimateMinutes} min default / {entry.rule.scheduledDraftTime ? `draft ${entry.rule.scheduledDraftTime}` : "manual drafts"}
                  </p>
                </div>
                <div className="flex gap-1">
                  <button type="button" onClick={() => beginRule(entry)} className="icon-button" aria-label={`Edit ${entry.rule.name}`}>
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void action(`delete-rule:${entry.policy.id}`, `/v1/calendar/rules/${entry.policy.id}`, { method: "DELETE" })}
                    className="icon-button text-rose-700"
                    aria-label={`Disable ${entry.rule.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
            {rules.length === 0 ? <p className="py-6 text-sm text-stone-500">Add working hours before building a day.</p> : null}
          </div>
        </section>
      </div>

      {showRuleForm && ruleDraft ? (
        <RuleDialog
          rule={ruleDraft}
          calendars={calendars}
          editing={editingRuleId !== null}
          onChange={setRuleDraft}
          onToggleDay={setAvailabilityDay}
          onClose={() => setShowRuleForm(false)}
          onSubmit={saveRule}
          busy={busy !== null}
        />
      ) : null}

      {showEventForm ? (
        <Dialog title="Add personal event" onClose={() => setShowEventForm(false)}>
          <form onSubmit={createEvent} className="space-y-3">
            <Field label="Title">
              <input required value={eventDraft.title} onChange={(event) => setEventDraft({ ...eventDraft, title: event.target.value })} className="field" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Start">
                <input type="datetime-local" required value={eventDraft.startAt} onChange={(event) => setEventDraft({ ...eventDraft, startAt: event.target.value })} className="field" />
              </Field>
              <Field label="End">
                <input type="datetime-local" required value={eventDraft.endAt} onChange={(event) => setEventDraft({ ...eventDraft, endAt: event.target.value })} className="field" />
              </Field>
            </div>
            <Field label="Calendar">
              <select required value={eventDraft.googleCalendarId} onChange={(event) => setEventDraft({ ...eventDraft, googleCalendarId: event.target.value })} className="field">
                {calendars.filter((calendar) => calendar.writeEnabled).map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}
              </select>
            </Field>
            <Field label="Location">
              <input value={eventDraft.location} onChange={(event) => setEventDraft({ ...eventDraft, location: event.target.value })} className="field" />
            </Field>
            <button type="submit" disabled={busy !== null} className="primary-button w-full justify-center">
              <CalendarPlus className="h-4 w-4" /> Create event
            </button>
          </form>
        </Dialog>
      ) : null}
    </section>
  );
}

function TimeBlockRow(props: {
  block: TimeBlock;
  editable: boolean;
  onSave: (patch: Record<string, unknown>) => Promise<Response | undefined>;
  onRemove: () => Promise<Response | undefined>;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(props.block.title);
  const [startAt, setStartAt] = useState(inputDateTime(props.block.startAt));
  const [endAt, setEndAt] = useState(inputDateTime(props.block.endAt));
  return (
    <div className="py-4">
      {editing ? (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_11rem_auto]">
          <input value={title} onChange={(event) => setTitle(event.target.value)} className="field" />
          <input type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} className="field" />
          <input type="datetime-local" value={endAt} onChange={(event) => setEndAt(event.target.value)} className="field" />
          <button type="button" onClick={() => void props.onSave({ title, startAt: toIso(startAt), endAt: toIso(endAt) }).then(() => setEditing(false))} className="icon-button" aria-label="Save block">
            <Save className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="break-words text-sm font-semibold text-stone-950">{props.block.title}</p>
            <p className="mt-1 text-xs text-stone-500">
              {new Date(props.block.startAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              {" – "}
              {new Date(props.block.endAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              {" / "}
              {props.block.status}{props.block.pinned ? " / pinned" : ""}
            </p>
            {props.block.error ? <p className="mt-1 text-xs text-red-700">{props.block.error}</p> : null}
          </div>
          {props.editable ? (
            <div className="flex gap-1">
              <button type="button" onClick={() => setEditing(true)} className="icon-button" aria-label="Edit block">
                <Pencil className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => void props.onRemove()} className="icon-button text-rose-700" aria-label="Remove block">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function RuleDialog(props: {
  rule: TimeBlockRule;
  calendars: AdminGoogleCalendar[];
  editing: boolean;
  onChange: (rule: TimeBlockRule) => void;
  onToggleDay: (day: number, enabled: boolean) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  busy: boolean;
}) {
  const firstWindow = (day: number) => props.rule.availability[String(day)]?.[0];
  const setWindow = (day: number, field: "start" | "end", value: string) => {
    const current = firstWindow(day) ?? { start: "08:00", end: "17:00" };
    props.onChange({
      ...props.rule,
      availability: {
        ...props.rule.availability,
        [String(day)]: [{ ...current, [field]: value }]
      }
    });
  };
  return (
    <Dialog title={props.editing ? "Edit scheduling rule" : "Add scheduling rule"} onClose={props.onClose}>
      <form onSubmit={props.onSubmit} className="space-y-4">
        <Field label="Name">
          <input required value={props.rule.name} onChange={(event) => props.onChange({ ...props.rule, name: event.target.value })} className="field" />
        </Field>
        <div className="space-y-2">
          <p className="text-sm font-medium text-stone-700">Available hours</p>
          {weekdayLabels.map((label, day) => {
            const window = firstWindow(day);
            return (
              <div key={label} className="grid grid-cols-[2.5rem_auto_minmax(0,1fr)] items-center gap-2">
                <span className="text-xs font-medium text-stone-600">{label}</span>
                <input
                  type="checkbox"
                  checked={Boolean(window)}
                  onChange={(event) => props.onToggleDay(day, event.target.checked)}
                  aria-label={`Use ${label}`}
                />
                {window ? (
                  <div className="grid min-w-0 grid-cols-2 gap-2">
                    <input
                      type="time"
                      value={window.start}
                      onChange={(event) => setWindow(day, "start", event.target.value)}
                      className="field min-w-0"
                      aria-label={`${label} start`}
                    />
                    <input
                      type="time"
                      value={window.end}
                      onChange={(event) => setWindow(day, "end", event.target.value)}
                      className="field min-w-0"
                      aria-label={`${label} end`}
                    />
                  </div>
                ) : <span />}
              </div>
            );
          })}
        </div>
        <Field label="Write calendar">
          <select value={props.rule.targetCalendarId} onChange={(event) => props.onChange({ ...props.rule, targetCalendarId: event.target.value })} className="field">
            <option value="">Choose calendar</option>
            {props.calendars.filter((calendar) => calendar.writeEnabled).map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}
          </select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField label="Default minutes" value={props.rule.defaultEstimateMinutes} onChange={(value) => props.onChange({ ...props.rule, defaultEstimateMinutes: value })} />
          <NumberField label="Minimum chunk" value={props.rule.minimumChunkMinutes} onChange={(value) => props.onChange({ ...props.rule, minimumChunkMinutes: value })} />
          <NumberField label="Maximum block" value={props.rule.maximumBlockMinutes} onChange={(value) => props.onChange({ ...props.rule, maximumBlockMinutes: value })} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField label="Buffer before" value={props.rule.bufferBeforeMinutes} onChange={(value) => props.onChange({ ...props.rule, bufferBeforeMinutes: value })} />
          <NumberField label="Buffer after" value={props.rule.bufferAfterMinutes} onChange={(value) => props.onChange({ ...props.rule, bufferAfterMinutes: value })} />
        </div>
        <Field label="Scheduled draft time (optional)">
          <input type="time" value={props.rule.scheduledDraftTime ?? ""} onChange={(event) => props.onChange({ ...props.rule, scheduledDraftTime: event.target.value || undefined })} className="field" />
        </Field>
        <div className="flex flex-wrap gap-4 text-sm text-stone-700">
          <label className="flex items-center gap-2"><input type="checkbox" checked={props.rule.includeStarred} onChange={(event) => props.onChange({ ...props.rule, includeStarred: event.target.checked })} /> Starred tasks</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={props.rule.includeDue} onChange={(event) => props.onChange({ ...props.rule, includeDue: event.target.checked })} /> Due tasks</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={props.rule.splitTasks} onChange={(event) => props.onChange({ ...props.rule, splitTasks: event.target.checked })} /> Split when needed</label>
        </div>
        <button type="submit" disabled={props.busy} className="primary-button w-full justify-center">
          <Save className="h-4 w-4" /> Save rule
        </button>
      </form>
    </Dialog>
  );
}

function Dialog(props: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/35 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-md border border-stone-300 bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-stone-950">{props.title}</h2>
          <button type="button" onClick={props.onClose} className="icon-button" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

function Field(props: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm font-medium text-stone-700">{props.label}{props.children}</label>;
}

function NumberField(props: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <Field label={props.label}>
      <input type="number" min={0} value={props.value} onChange={(event) => props.onChange(Number(event.target.value))} className="field" />
    </Field>
  );
}
