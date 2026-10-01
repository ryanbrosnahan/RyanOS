import type { RecurrenceEvent, RecurrencePolicy } from "./types.js";

const DAY = 86_400_000;
export function shiftReportDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY)
    .toISOString()
    .slice(0, 10);
}
function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(end) - Date.parse(start)) / DAY);
}
export function reportDate(value: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  return ["year", "month", "day"]
    .map((key) => parts.find((part) => part.type === key)!.value)
    .join("-");
}
export type AdherenceDay = {
  date: string;
  status: RecurrenceEvent["eventType"] | "none" | "before_tracking" | "future";
};
export type AdherenceMonth = {
  month: string;
  completed: number;
  skipped: number;
  trackedDays: number;
  partial: boolean;
};
export type AdherenceReport = {
  timezone: string;
  through: string;
  start: string | null;
  total: number;
  skipped: number;
  trackedDays: number;
  weeklyAverage: number;
  monthlyAverage: number;
  recentWeeklyAverage: number;
  recentDays: number;
  adherence: {
    label: string;
    target: number;
    windows: number;
    met: number;
    credited: number;
    expected: number;
    percent: number | null;
  } | null;
  months: AdherenceMonth[];
  calendar: AdherenceDay[];
  notes: string[];
};

/** One effective outcome per local date; the latest recorded correction wins. */
export function buildAdherenceReport(input: {
  policy: RecurrencePolicy;
  events: RecurrenceEvent[];
  timezone: string;
  now?: string;
}): AdherenceReport {
  const through = reportDate(
    input.now ?? new Date().toISOString(),
    input.timezone,
  );
  const outcomes = new Map<string, RecurrenceEvent["eventType"]>();
  for (const event of [...input.events].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) ||
      a.occurredAt.localeCompare(b.occurredAt),
  )) {
    const day = reportDate(event.occurredAt, input.timezone);
    if (day <= through) outcomes.set(day, event.eventType);
  }
  const completed = [...outcomes]
    .filter(([, status]) => status === "completed")
    .map(([day]) => day)
    .sort();
  const start = completed[0] ?? null;
  const trackedDays = start ? daysBetween(start, through) + 1 : 0;
  const skipped = [...outcomes].filter(
    ([day, status]) => start && day >= start && status === "skipped",
  ).length;
  const recentDays = Math.min(28, trackedDays);
  const recentStart = shiftReportDate(through, 1 - recentDays);
  const months: AdherenceMonth[] = [];
  // Twelve calendar months, including the current partial month.
  const endMonth = new Date(`${through.slice(0, 7)}-01T00:00:00Z`);
  for (let offset = -11; offset <= 0; offset++) {
    const monthStart = new Date(
      Date.UTC(endMonth.getUTCFullYear(), endMonth.getUTCMonth() + offset, 1),
    )
      .toISOString()
      .slice(0, 10);
    const nextMonth = new Date(
      Date.UTC(
        endMonth.getUTCFullYear(),
        endMonth.getUTCMonth() + offset + 1,
        1,
      ),
    )
      .toISOString()
      .slice(0, 10);
    const monthEnd = shiftReportDate(nextMonth, -1);
    const first = start && start > monthStart ? start : monthStart;
    const last = through < monthEnd ? through : monthEnd;
    const days = start && last >= first ? daysBetween(first, last) + 1 : 0;
    const month = monthStart.slice(0, 7);
    months.push({
      month,
      completed: completed.filter((day) => day.startsWith(month)).length,
      skipped: [...outcomes].filter(
        ([day, status]) =>
          start &&
          day >= start &&
          day.startsWith(month) &&
          status === "skipped",
      ).length,
      trackedDays: days,
      partial: days < daysBetween(monthStart, nextMonth),
    });
  }
  const calendar: AdherenceDay[] = [];
  const calendarStart = `${months[0]!.month}-01`;
  const calendarEnd = shiftReportDate(
    new Date(Date.UTC(endMonth.getUTCFullYear(), endMonth.getUTCMonth() + 1, 1))
      .toISOString()
      .slice(0, 10),
    -1,
  );
  for (
    let day = calendarStart;
    day <= calendarEnd;
    day = shiftReportDate(day, 1)
  ) {
    calendar.push({
      date: day,
      status:
        day > through
          ? "future"
          : !start || day < start
            ? "before_tracking"
            : (outcomes.get(day) ?? "none"),
    });
  }
  const policy = input.policy;
  let target = 0;
  let windowDays = 0;
  let label = "";
  if (
    policy.type === "target_frequency" &&
    policy.targetCount &&
    policy.targetWindowDays
  ) {
    target = policy.targetCount;
    windowDays = policy.targetWindowDays;
    label = `${target} completed days every ${windowDays} days`;
  } else if (policy.type === "completion_based" && policy.intervalDays) {
    target = 1;
    windowDays = policy.intervalDays;
    label = `1 completed day every ${windowDays} days (fixed-window comparison)`;
  }
  const counts: number[] = [];
  if (start && target > 0 && windowDays > 0) {
    // Today and the open window cannot yet be misses. Windows anchor to tracking start.
    const closedWindows = Math.floor(daysBetween(start, through) / windowDays);
    for (let i = 0; i < closedWindows; i++) counts.push(0);
    for (const day of completed) {
      const index = Math.floor(daysBetween(start, day) / windowDays);
      if (index < closedWindows) counts[index]!++;
    }
  }
  // Monthly fixed schedules have a count benchmark; this does not imply on-time completion.
  const monthlyCron = /^\d{1,2}\s+\d{1,2}\s+(\d{1,2})\s+\*\s+[\*?]$/.exec(
    policy.cron?.trim() ?? "",
  );
  if (
    policy.type === "fixed_schedule" &&
    monthlyCron &&
    Number(monthlyCron[1]) <= 31 &&
    Number(monthlyCron[1]) >= 1
  ) {
    target = 1;
    label = "1 completed day per full scheduled calendar month";
    if (start) {
      let month = `${start.slice(0, 7)}-01`;
      while (month < through) {
        const date = new Date(`${month}T00:00:00Z`);
        const next = new Date(
          Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1),
        )
          .toISOString()
          .slice(0, 10);
        if (
          month >= start &&
          next <= through &&
          Number(monthlyCron[1]) <= daysBetween(month, next)
        ) {
          counts.push(
            completed.filter((day) => day >= month && day < next).length,
          );
        }
        month = next;
      }
    }
  }
  const credited = counts.reduce(
    (sum, count) => sum + Math.min(target, count),
    0,
  );
  const expected = counts.length * target;
  return {
    timezone: input.timezone,
    through,
    start,
    total: completed.length,
    skipped,
    trackedDays,
    weeklyAverage: trackedDays ? (completed.length * 7) / trackedDays : 0,
    monthlyAverage: trackedDays
      ? (completed.length * (365.2425 / 12)) / trackedDays
      : 0,
    recentWeeklyAverage: recentDays
      ? (completed.filter((day) => day >= recentStart).length * 7) / recentDays
      : 0,
    recentDays,
    adherence: target
      ? {
          label,
          target,
          windows: counts.length,
          met: counts.filter((count) => count >= target).length,
          credited,
          expected,
          percent: expected ? (credited * 100) / expected : null,
        }
      : null,
    months,
    calendar,
    notes: [
      "Tracking starts at the earliest completion that has not been undone. One completion per local day; latest recorded correction wins. Skips count as misses, never completions.",
      "Lifetime averages include every calendar day from tracking start through today. Weekly = completed days / tracked days x 7; monthly uses an average month of 30.44 days. Averages based on only a few days may fluctuate sharply.",
      "Goal adherence compares closed periods with the CURRENT rule, capped at the target in each period. Extra completions cannot offset misses in another period. Open periods are excluded; skips remain in the denominator.",
      "Past rule changes and pauses are not versioned. This is a current-goal benchmark, not historical schedule compliance or on-time adherence. Interval comparisons use fixed windows from tracking start; monthly comparisons exclude partial months.",
      "Minimum-interval and opportunistic rules do not define a completion quota. Unsupported fixed schedules have no goal percentage. Blank days mean no completion recorded, not proof the activity did not happen.",
    ],
  };
}
