import type { GoogleCalendar, GoogleCalendarEvent, Item } from "@ryanos/core";

export type TimeWindow = {
  start: string;
  end: string;
};

export type TimeBlockRule = {
  name: string;
  timezone: string;
  availability: Record<string, TimeWindow[]>;
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

export type ScheduledBlock = {
  itemId: string;
  title: string;
  startAt: string;
  endAt: string;
  estimatedMinutes: number;
  metadata: {
    source: "time_block_scheduler";
    originalEstimateMinutes: number;
    part: number;
  };
};

export type ScheduleResult = {
  blocks: ScheduledBlock[];
  unscheduledItemIds: string[];
  availableMinutes: number;
  scheduledMinutes: number;
};

type Interval = {
  start: number;
  end: number;
};

const priorityRank: Record<Item["priority"], number> = {
  urgent: 4,
  high: 3,
  normal: 2,
  low: 1
};

export function normalizeTimeBlockRule(value: unknown): TimeBlockRule {
  const record = asRecord(value);
  const availabilityRecord = asRecord(record?.availability);
  const availability: Record<string, TimeWindow[]> = {};
  for (let day = 0; day <= 6; day += 1) {
    const windows = Array.isArray(availabilityRecord?.[String(day)])
      ? availabilityRecord[String(day)] as unknown[]
      : [];
    availability[String(day)] = windows.flatMap((entry) => {
      const window = asRecord(entry);
      const start = typeof window?.start === "string" ? window.start : undefined;
      const end = typeof window?.end === "string" ? window.end : undefined;
      if (!start || !end || !validTime(start) || !validTime(end) || start >= end) return [];
      return [{ start, end }];
    });
  }
  const rule: TimeBlockRule = {
    name: text(record?.name) ?? "Daily schedule",
    timezone: text(record?.timezone) ?? "America/Chicago",
    availability,
    targetCalendarId: text(record?.targetCalendarId) ?? "",
    includeStarred: boolean(record?.includeStarred, true),
    includeDue: boolean(record?.includeDue, true),
    areaIds: stringArray(record?.areaIds),
    projectIds: stringArray(record?.projectIds),
    bufferBeforeMinutes: boundedInteger(record?.bufferBeforeMinutes, 15, 0, 180),
    bufferAfterMinutes: boundedInteger(record?.bufferAfterMinutes, 15, 0, 180),
    defaultEstimateMinutes: boundedInteger(record?.defaultEstimateMinutes, 30, 5, 480),
    minimumChunkMinutes: boundedInteger(record?.minimumChunkMinutes, 15, 5, 240),
    maximumBlockMinutes: boundedInteger(record?.maximumBlockMinutes, 120, 15, 480),
    splitTasks: boolean(record?.splitTasks, true)
  };
  const scheduledDraftTime = text(record?.scheduledDraftTime);
  if (scheduledDraftTime && validTime(scheduledDraftTime)) rule.scheduledDraftTime = scheduledDraftTime;
  if (rule.maximumBlockMinutes < rule.minimumChunkMinutes) {
    rule.maximumBlockMinutes = rule.minimumChunkMinutes;
  }
  return rule;
}

export function validateTimeBlockRule(rule: TimeBlockRule): string | undefined {
  if (!rule.targetCalendarId) return "Choose a writable target calendar.";
  if (!Object.values(rule.availability).some((windows) => windows.length > 0)) {
    return "Add at least one availability window.";
  }
  if (!rule.includeStarred && !rule.includeDue) {
    return "Enable starred tasks, due tasks, or both.";
  }
  return undefined;
}

export function generateTimeBlockSchedule(input: {
  dateKey: string;
  rule: TimeBlockRule;
  items: Item[];
  events: GoogleCalendarEvent[];
  calendars: GoogleCalendar[];
}): ScheduleResult {
  const weekday = String(new Date(`${input.dateKey}T12:00:00.000Z`).getUTCDay());
  const windows = input.rule.availability[weekday] ?? [];
  const dayStart = zonedDateTimeToUtc(input.dateKey, "00:00", input.rule.timezone);
  const dayEnd = zonedDateTimeToUtc(addDateDays(input.dateKey, 1), "00:00", input.rule.timezone);
  const calendarById = new Map(input.calendars.map((calendar) => [calendar.id, calendar]));
  const busy = mergeIntervals(
    input.events.flatMap((event) => {
      if (event.status === "cancelled" || event.transparency === "transparent") return [];
      const calendar = calendarById.get(event.googleCalendarId);
      if (event.allDay && !calendar?.allDayBlocksAvailability) return [];
      return [{
        start: Math.max(dayStart, new Date(event.startAt).getTime() - input.rule.bufferBeforeMinutes * 60_000),
        end: Math.min(dayEnd, new Date(event.endAt).getTime() + input.rule.bufferAfterMinutes * 60_000)
      }];
    }).filter((interval) => interval.end > interval.start)
  );
  let free = windows
    .map((window) => ({
      start: zonedDateTimeToUtc(input.dateKey, window.start, input.rule.timezone),
      end: zonedDateTimeToUtc(input.dateKey, window.end, input.rule.timezone)
    }))
    .flatMap((window) => subtractIntervals(window, busy))
    .filter((window) => window.end > window.start)
    .sort((a, b) => a.start - b.start);
  const availableMinutes = free.reduce((total, interval) => total + minutes(interval.end - interval.start), 0);

  const candidates = input.items
    .filter((item) => {
      if (!["open", "active"].includes(item.status)) return false;
      if (item.snoozedUntil && new Date(item.snoozedUntil).getTime() >= dayEnd) return false;
      if (input.rule.areaIds.length > 0 && (!item.areaId || !input.rule.areaIds.includes(item.areaId))) return false;
      if (input.rule.projectIds.length > 0 && (!item.projectId || !input.rule.projectIds.includes(item.projectId))) return false;
      const dueThisDay = item.dueAt !== undefined && new Date(item.dueAt).getTime() < dayEnd;
      return (input.rule.includeDue && dueThisDay) || (input.rule.includeStarred && item.starredAt !== undefined);
    })
    .sort((a, b) => compareItems(a, b, dayEnd));

  const blocks: ScheduledBlock[] = [];
  const unscheduledItemIds: string[] = [];
  for (const item of candidates) {
    const estimate = Math.max(item.estimateMinutes ?? input.rule.defaultEstimateMinutes, 5);
    let remaining = estimate;
    let part = 1;
    while (remaining > 0) {
      const preferred = Math.min(remaining, input.rule.maximumBlockMinutes);
      let slotIndex = free.findIndex((slot) => minutes(slot.end - slot.start) >= preferred);
      let duration = preferred;
      if (slotIndex < 0 && input.rule.splitTasks) {
        slotIndex = free.findIndex((slot) => minutes(slot.end - slot.start) >= input.rule.minimumChunkMinutes);
        if (slotIndex >= 0) {
          duration = Math.min(preferred, minutes(free[slotIndex]!.end - free[slotIndex]!.start));
        }
      }
      if (slotIndex < 0) break;
      const slot = free[slotIndex]!;
      const start = slot.start;
      const end = start + duration * 60_000;
      blocks.push({
        itemId: item.id,
        title: item.title,
        startAt: new Date(start).toISOString(),
        endAt: new Date(end).toISOString(),
        estimatedMinutes: duration,
        metadata: {
          source: "time_block_scheduler",
          originalEstimateMinutes: estimate,
          part
        }
      });
      part += 1;
      remaining -= duration;
      if (end >= slot.end) free.splice(slotIndex, 1);
      else free[slotIndex] = { start: end, end: slot.end };
      if (!input.rule.splitTasks) break;
    }
    if (remaining > 0) unscheduledItemIds.push(item.id);
  }

  return {
    blocks,
    unscheduledItemIds,
    availableMinutes,
    scheduledMinutes: blocks.reduce((total, block) => total + block.estimatedMinutes, 0)
  };
}

export function dateRangeForDateKey(dateKey: string, timezone: string): { from: string; to: string } {
  return {
    from: new Date(zonedDateTimeToUtc(dateKey, "00:00", timezone)).toISOString(),
    to: new Date(zonedDateTimeToUtc(addDateDays(dateKey, 1), "00:00", timezone)).toISOString()
  };
}

export function localDateKey(date: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function localTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function compareItems(a: Item, b: Item, dayEnd: number): number {
  const aDue = a.dueAt !== undefined && new Date(a.dueAt).getTime() < dayEnd;
  const bDue = b.dueAt !== undefined && new Date(b.dueAt).getTime() < dayEnd;
  if (aDue !== bDue) return aDue ? -1 : 1;
  const priority = priorityRank[b.priority] - priorityRank[a.priority];
  if (priority !== 0) return priority;
  const due = (a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER) -
    (b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER);
  if (due !== 0) return due;
  return a.createdAt.localeCompare(b.createdAt);
}

function subtractIntervals(window: Interval, busy: Interval[]): Interval[] {
  let intervals = [window];
  for (const blocked of busy) {
    intervals = intervals.flatMap((candidate) => {
      if (blocked.end <= candidate.start || blocked.start >= candidate.end) return [candidate];
      const result: Interval[] = [];
      if (blocked.start > candidate.start) result.push({ start: candidate.start, end: blocked.start });
      if (blocked.end < candidate.end) result.push({ start: blocked.end, end: candidate.end });
      return result;
    });
  }
  return intervals;
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged.at(-1);
    if (!last || interval.start > last.end) merged.push({ ...interval });
    else last.end = Math.max(last.end, interval.end);
  }
  return merged;
}

function zonedDateTimeToUtc(dateKey: string, time: string, timezone: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  let candidate = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(candidate)).map((part) => [part.type, part.value])
    );
    const displayed = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute)
    );
    const desired = Date.UTC(year!, month! - 1, day!, hour!, minute!);
    const difference = desired - displayed;
    candidate += difference;
    if (difference === 0) break;
  }
  return candidate;
}

function addDateDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function minutes(milliseconds: number): number {
  return Math.floor(milliseconds / 60_000);
}

function validTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isInteger(value)
    ? Math.min(Math.max(value, minimum), maximum)
    : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}
