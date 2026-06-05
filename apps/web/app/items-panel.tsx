"use client";

import {
  BookOpen,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  Circle,
  ClipboardList,
  Code2,
  CalendarDays,
  Folder,
  FolderKanban,
  Gauge,
  HeartPulse,
  Home,
  Landmark,
  PawPrint,
  Pencil,
  Plane,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Users
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type RecurrenceDay = {
  date: string;
  weekday: string;
  status: "completed" | "uncompleted" | "skipped" | "missed" | "deferred" | "none";
  eventId?: string;
  occurredAt?: string;
};

type RecurrenceProgress = {
  policy: {
    id: string;
    type: string;
    intervalDays?: number;
    minimumIntervalDays?: number;
    targetCount?: number;
    targetWindowDays?: number;
    preferredDays: string[];
  };
  week: {
    startDate: string;
    endDate: string;
    days: RecurrenceDay[];
    completedCount: number;
    targetCount?: number;
    targetWindowDays: number;
  };
  state?: {
    lastCompletedAt?: string;
    nextEligibleAt?: string;
    nextDueAt?: string;
    stalenessScore: number;
  };
};

type ScopeLabel = {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
};

type ProjectScopeLabel = ScopeLabel & {
  areaId?: string;
};

type Item = {
  id: string;
  kind: string;
  title: string;
  status: string;
  priority: string;
  priorityScore: number;
  prioritySignals: string[];
  hiddenUntil?: string;
  dueAt?: string;
  completedAt?: string;
  completion?: {
    completedToday: boolean;
    completedAt?: string;
  };
  scope?: {
    area?: ScopeLabel;
    project?: ScopeLabel;
  };
  recurrence?: RecurrenceProgress;
};

type ItemsResponse = {
  date: string;
  timezone: string;
  items: Item[];
};

type TaxonomyResponse = {
  areas: ScopeLabel[];
  projects: ProjectScopeLabel[];
};

type ToggleResponse = {
  item?: Item;
};

type ToolResultResponse = {
  status: string;
  messageForUser?: string;
  clarificationPrompt?: string;
  confirmationPrompt?: string;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4100";

const scopeIcons: Record<string, LucideIcon> = {
  "book-open": BookOpen,
  "briefcase-business": BriefcaseBusiness,
  "clipboard-list": ClipboardList,
  "code-2": Code2,
  folder: Folder,
  "folder-kanban": FolderKanban,
  "heart-pulse": HeartPulse,
  home: Home,
  landmark: Landmark,
  "paw-print": PawPrint,
  plane: Plane,
  sparkles: Sparkles,
  users: Users
};

function formatDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

function dateInputValue(value: string | undefined): string {
  if (!value) return "";
  return value.slice(0, 10);
}

function dateInputToIso(value: string): string {
  return new Date(`${value}T12:00:00`).toISOString();
}

function scopeTone(color: string | undefined, variant: "area" | "project"): string {
  if (variant === "project") {
    return "border-stone-300 bg-white text-stone-700";
  }
  switch (color) {
    case "emerald":
      return "border-cyan-200 bg-cyan-50 text-cyan-900";
    case "rose":
      return "border-violet-200 bg-violet-50 text-violet-900";
    case "lime":
      return "border-sky-200 bg-sky-50 text-sky-900";
    case "sky":
      return "border-sky-200 bg-sky-50 text-sky-900";
    case "amber":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "indigo":
      return "border-indigo-200 bg-indigo-50 text-indigo-900";
    case "violet":
      return "border-violet-200 bg-violet-50 text-violet-900";
    case "fuchsia":
      return "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-900";
    case "cyan":
      return "border-cyan-200 bg-cyan-50 text-cyan-900";
    case "blue":
      return "border-blue-200 bg-blue-50 text-blue-900";
    default:
      return "border-stone-300 bg-stone-50 text-stone-800";
  }
}

function ScopeChip({ scope, variant }: { scope: ScopeLabel; variant: "area" | "project" }) {
  const Icon = scopeIcons[scope.icon ?? ""] ?? (variant === "area" ? Folder : FolderKanban);
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${scopeTone(scope.color, variant)}`}
      title={variant === "area" ? `Area: ${scope.name}` : `Project: ${scope.name}`}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{scope.name}</span>
    </span>
  );
}

function dayTone(day: RecurrenceDay, isToday: boolean): string {
  const base = "h-8 w-8 shrink-0 rounded-full border text-[11px] font-semibold transition";
  const todayRing = isToday ? " ring-2 ring-sky-300 ring-offset-1" : "";
  if (day.status === "completed") {
    return `${base}${todayRing} border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800`;
  }
  if (day.status === "missed") {
    return `${base}${todayRing} border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100`;
  }
  if (day.status === "skipped" || day.status === "deferred") {
    return `${base}${todayRing} border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100`;
  }
  if (day.status === "uncompleted") {
    return `${base}${todayRing} border-stone-300 bg-stone-100 text-stone-500 hover:bg-stone-200`;
  }
  return `${base}${todayRing} border-stone-300 bg-white text-stone-600 hover:bg-stone-100`;
}

function recurrenceDayLabel(day: RecurrenceDay): string {
  switch (day.weekday) {
    case "Sunday":
    case "Sun":
      return "Su";
    case "Monday":
    case "Mon":
      return "Mo";
    case "Tuesday":
    case "Tue":
      return "Tu";
    case "Wednesday":
    case "Wed":
      return "We";
    case "Thursday":
    case "Thu":
      return "Th";
    case "Friday":
    case "Fri":
      return "Fr";
    case "Saturday":
    case "Sat":
      return "Sa";
    default:
      return day.weekday.slice(0, 2);
  }
}

function recurrenceCadenceDays(recurrence: RecurrenceProgress): number | undefined {
  if (recurrence.policy.type === "target_frequency") {
    return recurrence.policy.targetWindowDays ?? recurrence.week.targetWindowDays;
  }
  if (recurrence.policy.type === "completion_based") return recurrence.policy.intervalDays;
  if (recurrence.policy.type === "minimum_interval") return recurrence.policy.minimumIntervalDays;
  return undefined;
}

function shouldShowRecurrenceDays(recurrence: RecurrenceProgress): boolean {
  const cadenceDays = recurrenceCadenceDays(recurrence);
  return cadenceDays === undefined || cadenceDays <= 7;
}

function parseDateKey(dateKey: string): { year: number; month: number; day: number } {
  const [year, month, day] = dateKey.split("-").map(Number);
  return { year: year ?? 0, month: month ?? 0, day: day ?? 0 };
}

function daysBetweenDateKeys(startDateKey: string, endDateKey: string): number {
  const start = parseDateKey(startDateKey);
  const end = parseDateKey(endDateKey);
  const startMs = Date.UTC(start.year, start.month - 1, start.day);
  const endMs = Date.UTC(end.year, end.month - 1, end.day);
  return Math.round((endMs - startMs) / (24 * 60 * 60 * 1000));
}

function dateKeyInTimeZone(value: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function recurrenceLastDoneLabel(
  recurrence: RecurrenceProgress,
  dashboardDate: string | null,
  timezone: string
): string | undefined {
  const showDays = shouldShowRecurrenceDays(recurrence);
  const hasRecentCompletion = recurrence.week.days.some((day) => day.status === "completed");
  if (showDays && hasRecentCompletion) return undefined;

  const cadenceDays = recurrenceCadenceDays(recurrence);
  if (showDays && (cadenceDays === undefined || cadenceDays > 7)) return undefined;

  const lastCompletedAt = recurrence.state?.lastCompletedAt;
  if (!lastCompletedAt) return showDays ? "no history" : "not done yet";
  if (!dashboardDate) return undefined;

  const lastDateKey = dateKeyInTimeZone(lastCompletedAt, timezone);
  const daysAgo = Math.max(0, daysBetweenDateKeys(lastDateKey, dashboardDate));
  return daysAgo === 0 ? "done today" : `last ${daysAgo}d ago`;
}

function recurrenceSummary(recurrence: RecurrenceProgress): string {
  const target = recurrence.week.targetCount;
  if (target) return `${recurrence.week.completedCount}/${target}`;
  return `${recurrence.week.completedCount}`;
}

function nextRecurrenceDate(recurrence: RecurrenceProgress | undefined): string | undefined {
  return formatDate(recurrence?.state?.nextDueAt);
}

function updateErrorMessage(payload: ToolResultResponse, fallback: string): string {
  return payload.messageForUser ?? payload.clarificationPrompt ?? payload.confirmationPrompt ?? fallback;
}

export function ItemsPanel() {
  const [items, setItems] = useState<Item[]>([]);
  const [areas, setAreas] = useState<ScopeLabel[]>([]);
  const [projects, setProjects] = useState<ProjectScopeLabel[]>([]);
  const [dashboardDate, setDashboardDate] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [editingScopeItemId, setEditingScopeItemId] = useState<string | null>(null);
  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago",
    []
  );
  const areaCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      const areaId = item.scope?.area?.id;
      if (areaId) counts.set(areaId, (counts.get(areaId) ?? 0) + 1);
    }
    return counts;
  }, [items]);
  const projectCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      const projectId = item.scope?.project?.id;
      if (projectId) counts.set(projectId, (counts.get(projectId) ?? 0) + 1);
    }
    return counts;
  }, [items]);
  const unscopedCount = useMemo(
    () => items.filter((item) => !item.scope?.area && !item.scope?.project).length,
    [items]
  );

  async function loadDashboard(options?: { background?: boolean }) {
    if (options?.background) {
      setRefreshing(true);
    } else {
      setLoading(true);
      setError(null);
    }
    try {
      const params = new URLSearchParams({
        userId: "local-owner",
        status: "open,active,waiting",
        includeDoneToday: "true",
        timezone,
        limit: "100"
      });
      const taxonomyParams = new URLSearchParams({ userId: "local-owner" });
      const [itemsResponse, taxonomyResponse] = await Promise.all([
        fetch(`${apiUrl}/v1/items?${params.toString()}`, { cache: "no-store" }),
        fetch(`${apiUrl}/v1/taxonomy?${taxonomyParams.toString()}`, { cache: "no-store" })
      ]);
      if (!itemsResponse.ok) throw new Error(`Items returned ${itemsResponse.status}`);
      if (!taxonomyResponse.ok) throw new Error(`Taxonomy returned ${taxonomyResponse.status}`);
      const itemsPayload = (await itemsResponse.json()) as ItemsResponse;
      const taxonomyPayload = (await taxonomyResponse.json()) as TaxonomyResponse;
      setItems(itemsPayload.items);
      setAreas(taxonomyPayload.areas);
      setProjects(taxonomyPayload.projects);
      setDashboardDate(itemsPayload.date);
      setLastUpdatedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function toggleTask(item: Item) {
    const nextCompleted = item.status !== "done";
    const key = `${item.id}:task`;
    setPendingKey(key);
    setError(null);
    try {
      const response = await fetch(`${apiUrl}/v1/items/${encodeURIComponent(item.id)}/complete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          userId: "local-owner",
          completed: nextCompleted,
          timezone
        })
      });
      if (!response.ok) throw new Error(`Task update returned ${response.status}`);
      const payload = (await response.json()) as ToggleResponse;
      if (payload.item) {
        setItems((current) => current.map((candidate) => (candidate.id === item.id ? payload.item! : candidate)));
      } else {
        await loadDashboard({ background: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingKey(null);
    }
  }

  async function toggleRecurrenceDay(item: Item, day: RecurrenceDay) {
    const key = `${item.id}:${day.date}`;
    setPendingKey(key);
    setError(null);
    try {
      const response = await fetch(
        `${apiUrl}/v1/items/${encodeURIComponent(item.id)}/recurrence-days/${day.date}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            userId: "local-owner",
            completed: day.status !== "completed",
            timezone,
            referenceDate: dashboardDate ?? undefined
          })
        }
      );
      if (!response.ok) throw new Error(`Recurrence update returned ${response.status}`);
      const payload = (await response.json()) as ToggleResponse;
      if (payload.item) {
        setItems((current) => current.map((candidate) => (candidate.id === item.id ? payload.item! : candidate)));
      } else {
        await loadDashboard({ background: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingKey(null);
    }
  }

  async function classifyItem(
    item: Item,
    input: {
      areaId?: string;
      projectId?: string;
      clearArea?: boolean;
      clearProject?: boolean;
    }
  ) {
    const key = `${item.id}:classify`;
    const area = input.areaId ? areas.find((candidate) => candidate.id === input.areaId) : undefined;
    const project = input.projectId
      ? projects.find((candidate) => candidate.id === input.projectId)
      : undefined;
    const projectArea = project?.areaId
      ? areas.find((candidate) => candidate.id === project.areaId)
      : undefined;

    setPendingKey(key);
    setError(null);
    try {
      const response = await fetch(`${apiUrl}/v1/tools/item.classify/invoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          input: {
            userId: "local-owner",
            itemRef: item.id,
            createMissing: false,
            areaRef: projectArea?.name ?? area?.name,
            projectRef: project?.name,
            clearArea: input.clearArea ?? false,
            clearProject: input.clearProject ?? false
          }
        })
      });
      const payload = (await response.json()) as ToolResultResponse;
      if (!response.ok) throw new Error(updateErrorMessage(payload, `Classification returned ${response.status}`));
      await loadDashboard({ background: true });
      setEditingScopeItemId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingKey(null);
    }
  }

  async function updateDueDate(item: Item, dueDate: string) {
    if (!dueDate) return;
    const key = `${item.id}:due`;
    setPendingKey(key);
    setError(null);
    try {
      const response = await fetch(`${apiUrl}/v1/tools/item.update/invoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          input: {
            userId: "local-owner",
            itemRef: item.id,
            patch: {
              dueAt: dateInputToIso(dueDate)
            }
          }
        })
      });
      const payload = (await response.json()) as ToolResultResponse;
      if (!response.ok) throw new Error(updateErrorMessage(payload, `Due date update returned ${response.status}`));
      await loadDashboard({ background: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingKey(null);
    }
  }

  useEffect(() => {
    void loadDashboard();
    const handleExternalRefresh = () => {
      void loadDashboard({ background: true });
    };
    window.addEventListener("ryanos-items-refresh", handleExternalRefresh);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadDashboard({ background: true });
      }
    }, 30000);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("ryanos-items-refresh", handleExternalRefresh);
    };
  }, []);

  return (
    <div className="rounded-md border border-stone-300 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-sky-700" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-stone-950">Open items</h2>
        </div>
        <button
          type="button"
          onClick={() => void loadDashboard()}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-stone-300 text-stone-700 hover:bg-stone-100"
          aria-label="Refresh open items"
          title="Refresh open items"
        >
          <RefreshCw className={`h-4 w-4 ${loading || refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
        </button>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-stone-500">
        <span>Auto-refreshes every 30 seconds</span>
        {lastUpdatedAt ? <span>Updated {formatDate(lastUpdatedAt)} {new Date(lastUpdatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span> : null}
      </div>

      {error ? <p className="mt-3 text-sm leading-6 text-rose-700">{error}</p> : null}

      {!error && loading && items.length === 0 ? (
        <p className="mt-3 text-sm leading-6 text-stone-600">Loading items...</p>
      ) : null}

      {!error && !loading && items.length === 0 ? (
        <p className="mt-3 text-sm leading-6 text-stone-600">No open items.</p>
      ) : null}

      {areas.length > 0 || projects.length > 0 || unscopedCount > 0 ? (
        <div className="mt-4 border-t border-stone-200 pt-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <FolderKanban className="h-4 w-4 text-sky-700" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-stone-950">Areas and projects</h3>
            </div>
            {unscopedCount > 0 ? (
              <span className="rounded-md bg-white px-2 py-1 text-xs font-medium text-stone-700 ring-1 ring-stone-200">
                {unscopedCount} unscoped
              </span>
            ) : null}
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {areas.map((area) => {
              const areaProjects = projects.filter((project) => project.areaId === area.id);
              return (
                <div key={area.id} className="rounded-md bg-stone-50 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <ScopeChip scope={area} variant="area" />
                    <span className="text-xs font-medium text-stone-500">
                      {areaCounts.get(area.id) ?? 0}
                    </span>
                  </div>
                  {areaProjects.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {areaProjects.map((project) => (
                        <span key={project.id} className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-0.5 text-xs text-stone-700 ring-1 ring-stone-200">
                          <FolderKanban className="h-3 w-3" aria-hidden="true" />
                          <span>{project.name}</span>
                          <span className="text-stone-400">{projectCounts.get(project.id) ?? 0}</span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {projects.some((project) => project.areaId === undefined) ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {projects.filter((project) => project.areaId === undefined).map((project) => (
                <ScopeChip key={project.id} scope={project} variant="project" />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className="mt-4 divide-y divide-stone-200">
          {items.map((item) => {
            const due = formatDate(item.dueAt);
            const nextDue = nextRecurrenceDate(item.recurrence);
            const completed = item.status === "done";
            const hasRecurrence = item.recurrence !== undefined;
            const showRecurrenceDays = item.recurrence ? shouldShowRecurrenceDays(item.recurrence) : false;
            const lastDoneLabel = item.recurrence
              ? recurrenceLastDoneLabel(item.recurrence, dashboardDate, timezone)
              : undefined;
            const selectedAreaId = item.scope?.area?.id ?? "";
            const selectedProjectId = item.scope?.project?.id ?? "";
            const visibleProjects = projects.filter((project) => {
              if (!selectedAreaId) return true;
              return project.areaId === undefined || project.areaId === selectedAreaId;
            });
            const editingScope = editingScopeItemId === item.id;
            return (
              <div key={item.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-3">
                    {hasRecurrence ? (
                      <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-stone-300 bg-stone-50 text-stone-500">
                        <RotateCcw className="h-4 w-4" aria-hidden="true" />
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={pendingKey === `${item.id}:task`}
                        onClick={() => void toggleTask(item)}
                        className={`mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition ${
                          completed
                            ? "border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800"
                            : "border-stone-300 bg-white text-stone-500 hover:bg-stone-100"
                        } disabled:cursor-wait disabled:opacity-60`}
                        aria-label={completed ? `Reopen ${item.title}` : `Complete ${item.title}`}
                        title={completed ? "Reopen" : "Complete"}
                      >
                        {completed ? (
                          <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
                        ) : (
                          <Circle className="h-5 w-5" aria-hidden="true" />
                        )}
                      </button>
                    )}
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-start gap-2">
                        <p
                          className={`min-w-0 flex-1 truncate text-sm font-medium ${
                            completed ? "text-stone-500 line-through" : "text-stone-950"
                          }`}
                        >
                          {item.title}
                        </p>
                        <button
                          type="button"
                          onClick={() => setEditingScopeItemId(editingScope ? null : item.id)}
                          className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100 hover:text-stone-900 ${
                            editingScope ? "bg-stone-100 text-stone-900" : ""
                          }`}
                          aria-label={
                            hasRecurrence
                              ? `Edit area and project for ${item.title}`
                              : `Edit area, project, and due date for ${item.title}`
                          }
                          aria-pressed={editingScope}
                          title={hasRecurrence ? "Edit area and project" : "Edit area, project, and due date"}
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                      <div className="mt-1 flex min-w-0 flex-wrap gap-1.5">
                        {item.scope?.area ? (
                          <ScopeChip scope={item.scope.area} variant="area" />
                        ) : null}
                        {item.scope?.project ? (
                          <ScopeChip scope={item.scope.project} variant="project" />
                        ) : null}
                        {!item.scope?.area && !item.scope?.project ? (
                          <span className="inline-flex items-center rounded-md bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600">
                            Unscoped
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-stone-600">
                        {item.kind} / {item.priority} / {completed ? "done today" : item.status}
                      </p>
                      {editingScope ? (
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          <label className="sr-only" htmlFor={`area-${item.id}`}>
                            Area for {item.title}
                          </label>
                          <select
                            id={`area-${item.id}`}
                            value={selectedAreaId}
                            disabled={pendingKey === `${item.id}:classify`}
                            onChange={(event) => {
                              const areaId = event.target.value;
                              if (!areaId) {
                                void classifyItem(item, { clearArea: true, clearProject: true });
                                return;
                              }
                              const currentProject = projects.find((project) => project.id === selectedProjectId);
                              void classifyItem(item, {
                                areaId,
                                clearProject:
                                  currentProject?.areaId !== undefined && currentProject.areaId !== areaId
                              });
                            }}
                            className="h-8 min-w-0 rounded-md border border-stone-300 bg-white px-2 text-xs text-stone-800 outline-none focus:border-sky-700 focus:ring-2 focus:ring-sky-100 disabled:cursor-wait disabled:opacity-60"
                          >
                            <option value="">No area</option>
                            {areas.map((area) => (
                              <option key={area.id} value={area.id}>
                                {area.name}
                              </option>
                            ))}
                          </select>

                          <label className="sr-only" htmlFor={`project-${item.id}`}>
                            Project for {item.title}
                          </label>
                          <select
                            id={`project-${item.id}`}
                            value={selectedProjectId}
                            disabled={pendingKey === `${item.id}:classify` || projects.length === 0}
                            onChange={(event) => {
                              const projectId = event.target.value;
                              if (!projectId) {
                                void classifyItem(item, { clearProject: true });
                                return;
                              }
                              const project = projects.find((candidate) => candidate.id === projectId);
                              void classifyItem(
                                item,
                                project?.areaId === undefined
                                  ? { projectId }
                                  : { projectId, areaId: project.areaId }
                              );
                            }}
                            className="h-8 min-w-0 rounded-md border border-stone-300 bg-white px-2 text-xs text-stone-800 outline-none focus:border-sky-700 focus:ring-2 focus:ring-sky-100 disabled:cursor-wait disabled:opacity-60"
                          >
                            <option value="">No project</option>
                            {visibleProjects.map((project) => (
                              <option key={project.id} value={project.id}>
                                {project.name}
                              </option>
                            ))}
                          </select>

                          {!hasRecurrence ? (
                            <>
                              <label className="sr-only" htmlFor={`due-${item.id}`}>
                                Due date for {item.title}
                              </label>
                              <span className="relative sm:col-span-2">
                                <CalendarDays
                                  className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-500"
                                  aria-hidden="true"
                                />
                                <input
                                  id={`due-${item.id}`}
                                  type="date"
                                  defaultValue={dateInputValue(item.dueAt)}
                                  disabled={pendingKey === `${item.id}:due`}
                                  onChange={(event) => void updateDueDate(item, event.target.value)}
                                  className="h-8 w-full min-w-0 rounded-md border border-stone-300 bg-white pl-8 pr-2 text-xs text-stone-800 outline-none focus:border-sky-700 focus:ring-2 focus:ring-sky-100 disabled:cursor-wait disabled:opacity-60"
                                />
                              </span>
                            </>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className="inline-flex items-center gap-1 rounded-md bg-stone-100 px-2 py-1 text-xs font-medium text-stone-600"
                      aria-label={`Priority score ${item.priorityScore}`}
                      title={`Priority score ${item.priorityScore}: ${item.prioritySignals.join(", ")}`}
                    >
                      <Gauge className="h-3 w-3" aria-hidden="true" />
                      <span>{item.priorityScore}</span>
                    </span>
                    {item.recurrence ? (
                      <span className="rounded-md bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-900">
                        {recurrenceSummary(item.recurrence)}
                      </span>
                    ) : null}
                    {!due && nextDue ? (
                      <span className="rounded-md bg-stone-100 px-2 py-1 text-xs font-medium text-stone-700">
                        {nextDue}
                      </span>
                    ) : null}
                    {due ? (
                      <span className="rounded-md bg-stone-100 px-2 py-1 text-xs font-medium text-stone-700">
                        {due}
                      </span>
                    ) : null}
                    {completed ? (
                      <Check className="h-7 w-7 text-emerald-700" aria-hidden="true" />
                    ) : null}
                  </div>
                </div>

                {item.recurrence ? (
                  <div className="mt-2 flex items-center gap-2 pl-12">
                    {showRecurrenceDays ? (
                      <div className="flex min-w-0 flex-wrap gap-1.5">
                        {item.recurrence.week.days.map((day) => {
                          const today = day.date === dashboardDate;
                          const key = `${item.id}:${day.date}`;
                          return (
                            <button
                              key={day.date}
                              type="button"
                              disabled={pendingKey === key}
                              onClick={() => void toggleRecurrenceDay(item, day)}
                              className={`${dayTone(day, today)} disabled:cursor-wait disabled:opacity-60`}
                              aria-label={`${day.status === "completed" ? "Undo" : "Mark"} ${item.title} on ${day.weekday} ${day.date}`}
                              title={`${day.weekday} ${day.date}`}
                            >
                              {day.status === "completed" ? (
                                <Check className="mx-auto h-4 w-4" aria-hidden="true" />
                              ) : (
                                recurrenceDayLabel(day)
                              )}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                    {lastDoneLabel ? (
                      <span className="shrink-0 rounded-md bg-stone-100 px-2 py-1 text-xs font-medium text-stone-700">
                        {lastDoneLabel}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
