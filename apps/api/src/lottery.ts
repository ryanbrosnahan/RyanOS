import { load } from "cheerio";
import type {
  LotteryDrawSnapshot,
  LotteryGameId,
  LotteryTaskAlert,
  RyanStore,
  UserIntegrationSetting
} from "@ryanos/core";
import { nowIso, type JsonObject, type UUID } from "@ryanos/shared";

export const lotteryGameIds = [
  "powerball",
  "mega_millions",
  "lotto",
  "easy_5"
] as const satisfies readonly LotteryGameId[];

export type LotteryGameSettings = {
  enabled: boolean;
  minimumJackpotDollars: number | null;
  buyByBufferMinutes: number;
};

export type LotterySettings = {
  timezone: string;
  taskCreationTime: string;
  autoStar: boolean;
  games: Record<LotteryGameId, LotteryGameSettings>;
};

export type ParsedLotteryDraw = {
  gameId: LotteryGameId;
  advertisedJackpotDollars: number;
  cashValueDollars?: number;
  nextDrawAt: string;
  officialCutoffAt: string;
  sourceUrl: string;
  fetchedAt: string;
};

type LotteryGameConfig = {
  id: LotteryGameId;
  name: string;
  sourceUrl: string;
  expectedTitle: RegExp;
  cutoffHour: number;
  cutoffMinute: number;
};

export const lotteryGameConfigs: Record<LotteryGameId, LotteryGameConfig> = {
  powerball: {
    id: "powerball",
    name: "Powerball",
    sourceUrl: "https://louisianalottery.com/draw-games/powerball/",
    expectedTitle: /\bpowerball\b/i,
    cutoffHour: 21,
    cutoffMinute: 0
  },
  mega_millions: {
    id: "mega_millions",
    name: "Mega Millions",
    sourceUrl: "https://louisianalottery.com/draw-games/mega-millions/",
    expectedTitle: /\bmega millions\b/i,
    cutoffHour: 21,
    cutoffMinute: 0
  },
  lotto: {
    id: "lotto",
    name: "Louisiana Lotto",
    sourceUrl: "https://louisianalottery.com/draw-games/lotto/",
    expectedTitle: /\blotto\b/i,
    cutoffHour: 21,
    cutoffMinute: 30
  },
  easy_5: {
    id: "easy_5",
    name: "Easy 5",
    sourceUrl: "https://louisianalottery.com/draw-games/easy-5/",
    expectedTitle: /\beasy\s*5\b/i,
    cutoffHour: 21,
    cutoffMinute: 30
  }
};

const louisianaTimezone = "America/Chicago";
const retailerUrl = "https://louisianalottery.com/where-to-play/";
const snapshotFreshnessMs = 3 * 60 * 60_000;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asJsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value ?? {})) as JsonObject;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function localDateParts(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second")
  };
}

export function localDateKey(date: Date, timeZone: string): string {
  const parts = localDateParts(date, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! + days, 12));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function localDateTimeToUtcIso(
  dateKey: string,
  timeZone: string,
  hour: number,
  minute: number
): string {
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`Invalid date key: ${dateKey}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const parts = localDateParts(guess, timeZone);
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  const intendedAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  return new Date(guess.getTime() - (localAsUtc - intendedAsUtc)).toISOString();
}

function parseMoney(value: string): number | undefined {
  const match = value.match(/\$\s*([\d,.]+)\s*(billion|million|thousand)?/i);
  if (!match) return undefined;
  const amount = Number((match[1] ?? "").replaceAll(",", ""));
  if (!Number.isFinite(amount)) return undefined;
  const multiplier =
    match[2]?.toLowerCase() === "billion"
      ? 1_000_000_000
      : match[2]?.toLowerCase() === "million"
        ? 1_000_000
        : match[2]?.toLowerCase() === "thousand"
          ? 1_000
          : 1;
  return Math.round(amount * multiplier);
}

function parseLouisianaDateTime(value: string): string {
  const localMatch = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (localMatch) {
    return localDateTimeToUtcIso(
      `${localMatch[1]}-${localMatch[2]}-${localMatch[3]}`,
      louisianaTimezone,
      Number(localMatch[4]),
      Number(localMatch[5])
    );
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Next drawing time is invalid.");
  return parsed.toISOString();
}

export function parseLotteryGamePage(
  gameId: LotteryGameId,
  html: string,
  fetchedAt = nowIso()
): ParsedLotteryDraw {
  const config = lotteryGameConfigs[gameId];
  const $ = load(html);
  const pageIdentity = [
    $("title").first().text(),
    $("h1").first().text(),
    $("link[rel='canonical']").attr("href") ?? ""
  ].join(" ");
  if (!config.expectedTitle.test(pageIdentity)) {
    throw new Error(`Official page did not identify itself as ${config.name}.`);
  }

  const summary = $(".jackpot-summary").first();
  if (summary.length === 0) throw new Error("Jackpot summary was not found.");
  const advertisedJackpotDollars = parseMoney(
    summary.find(".jackpot-summary__amount__value").first().text()
  );
  if (
    advertisedJackpotDollars === undefined ||
    advertisedJackpotDollars <= 0 ||
    advertisedJackpotDollars > 100_000_000_000
  ) {
    throw new Error("Advertised jackpot was missing or invalid.");
  }

  const amountMeta = summary.find(".jackpot-summary__amount__meta").first().text().trim();
  const detailsText = summary.find(".jackpot-summary__amount__details").text();
  const cashValueDollars = /cash prize/i.test(amountMeta)
    ? advertisedJackpotDollars
    : parseMoney(detailsText);
  const sourceDate = summary.find("time-countdown[date]").first().attr("date");
  if (!sourceDate) throw new Error("Next drawing timestamp was not found.");
  const nextDrawAt = parseLouisianaDateTime(sourceDate);
  const drawDateKey = localDateKey(new Date(nextDrawAt), louisianaTimezone);
  const officialCutoffAt = localDateTimeToUtcIso(
    drawDateKey,
    louisianaTimezone,
    config.cutoffHour,
    config.cutoffMinute
  );

  const fetchedMs = new Date(fetchedAt).getTime();
  const drawMs = new Date(nextDrawAt).getTime();
  if (
    !Number.isFinite(fetchedMs) ||
    drawMs < fetchedMs - 15 * 60_000 ||
    drawMs > fetchedMs + 14 * 86_400_000
  ) {
    throw new Error("Next drawing timestamp is outside the expected range.");
  }

  return {
    gameId,
    advertisedJackpotDollars,
    ...(cashValueDollars !== undefined ? { cashValueDollars } : {}),
    nextDrawAt,
    officialCutoffAt,
    sourceUrl: config.sourceUrl,
    fetchedAt
  };
}

export interface LotteryDataSource {
  fetchGame(gameId: LotteryGameId, fetchedAt?: string): Promise<ParsedLotteryDraw>;
}

export class OfficialLouisianaLotterySource implements LotteryDataSource {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async fetchGame(gameId: LotteryGameId, fetchedAt = nowIso()): Promise<ParsedLotteryDraw> {
    const config = lotteryGameConfigs[gameId];
    const response = await this.fetchImpl(config.sourceUrl, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "RyanOS lottery task integration/1.0"
      },
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) {
      throw new Error(`Official page returned HTTP ${response.status}.`);
    }
    return parseLotteryGamePage(gameId, await response.text(), fetchedAt);
  }
}

const defaultGameSettings = (): Record<LotteryGameId, LotteryGameSettings> => ({
  powerball: { enabled: false, minimumJackpotDollars: null, buyByBufferMinutes: 120 },
  mega_millions: { enabled: false, minimumJackpotDollars: null, buyByBufferMinutes: 120 },
  lotto: { enabled: false, minimumJackpotDollars: null, buyByBufferMinutes: 120 },
  easy_5: { enabled: false, minimumJackpotDollars: null, buyByBufferMinutes: 120 }
});

export function defaultLotterySettings(timezone = louisianaTimezone): LotterySettings {
  return {
    timezone,
    taskCreationTime: "08:00",
    autoStar: true,
    games: defaultGameSettings()
  };
}

export function normalizeLotterySettings(metadata: unknown): LotterySettings {
  const defaults = defaultLotterySettings();
  const record = asRecord(metadata);
  const games = asRecord(record.games);
  const normalized = defaultLotterySettings(
    typeof record.timezone === "string" && record.timezone.trim()
      ? record.timezone.trim()
      : defaults.timezone
  );
  if (typeof record.taskCreationTime === "string" && /^\d{2}:\d{2}$/.test(record.taskCreationTime)) {
    normalized.taskCreationTime = record.taskCreationTime;
  }
  if (typeof record.autoStar === "boolean") normalized.autoStar = record.autoStar;
  for (const gameId of lotteryGameIds) {
    const candidate = asRecord(games[gameId]);
    const threshold = candidate.minimumJackpotDollars;
    const buffer = candidate.buyByBufferMinutes;
    normalized.games[gameId] = {
      enabled: candidate.enabled === true,
      minimumJackpotDollars:
        threshold === null || threshold === undefined
          ? null
          : typeof threshold === "number" && Number.isFinite(threshold) && threshold >= 0
            ? Math.round(threshold)
            : null,
      buyByBufferMinutes:
        typeof buffer === "number" && Number.isFinite(buffer)
          ? Math.min(Math.max(Math.round(buffer / 30) * 30, 0), 720)
          : 120
    };
  }
  return normalized;
}

export function lotterySettingsMetadata(settings: LotterySettings): JsonObject {
  return asJsonObject(settings);
}

export async function refreshLotterySnapshots(
  store: RyanStore,
  source: LotteryDataSource,
  now = new Date()
): Promise<LotteryDrawSnapshot[]> {
  const attemptedAt = now.toISOString();
  return Promise.all(
    lotteryGameIds.map(async (gameId) => {
      try {
        const draw = await source.fetchGame(gameId, attemptedAt);
        return store.upsertLotteryDrawSnapshot({
          gameId,
          status: "ready",
          advertisedJackpotDollars: draw.advertisedJackpotDollars,
          ...(draw.cashValueDollars !== undefined
            ? { cashValueDollars: draw.cashValueDollars }
            : {}),
          nextDrawAt: draw.nextDrawAt,
          officialCutoffAt: draw.officialCutoffAt,
          sourceUrl: draw.sourceUrl,
          fetchedAt: draw.fetchedAt,
          lastAttemptAt: attemptedAt,
          lastSuccessAt: attemptedAt,
          metadata: {}
        });
      } catch (error) {
        return store.upsertLotteryDrawSnapshot({
          gameId,
          status: "error",
          sourceUrl: lotteryGameConfigs[gameId].sourceUrl,
          lastAttemptAt: attemptedAt,
          lastFailureAt: attemptedAt,
          error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
          metadata: {}
        });
      }
    })
  );
}

function snapshotUsable(snapshot: LotteryDrawSnapshot, now: Date): boolean {
  return (
    snapshot.status === "ready" &&
    snapshot.advertisedJackpotDollars !== undefined &&
    snapshot.nextDrawAt !== undefined &&
    snapshot.officialCutoffAt !== undefined &&
    snapshot.lastSuccessAt !== undefined &&
    now.getTime() - new Date(snapshot.lastSuccessAt).getTime() <= snapshotFreshnessMs
  );
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

function dateTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(new Date(value));
}

function taskBody(
  snapshot: LotteryDrawSnapshot,
  settings: LotterySettings,
  buyByAt: string
): string {
  const lines = [
    `**Advertised jackpot:** ${money(snapshot.advertisedJackpotDollars!)}`,
    snapshot.cashValueDollars !== undefined &&
    snapshot.cashValueDollars !== snapshot.advertisedJackpotDollars
      ? `**Estimated cash value:** ${money(snapshot.cashValueDollars)}`
      : undefined,
    `**Drawing:** ${dateTime(snapshot.nextDrawAt!, settings.timezone)}`,
    `**Personal buy-by:** ${dateTime(buyByAt, settings.timezone)}`,
    `**Official sales cutoff:** ${dateTime(snapshot.officialCutoffAt!, settings.timezone)}`,
    "",
    `[Official ${lotteryGameConfigs[snapshot.gameId].name} details](${snapshot.sourceUrl})`,
    `[Find a licensed Louisiana Lottery retailer](${retailerUrl})`,
    "",
    "Tickets must be purchased from a licensed retailer. Play responsibly; Louisiana Lottery players must be 21 or older."
  ];
  return lines.filter((line) => line !== undefined).join("\n");
}

function creationTimeForDraw(
  snapshot: LotteryDrawSnapshot,
  settings: LotterySettings,
  buyByAt: string
): string {
  const drawDateKey = localDateKey(new Date(snapshot.nextDrawAt!), settings.timezone);
  const [hour, minute] = settings.taskCreationTime.split(":").map(Number);
  const candidate = localDateTimeToUtcIso(
    drawDateKey,
    settings.timezone,
    hour ?? 8,
    minute ?? 0
  );
  if (new Date(candidate) < new Date(buyByAt)) return candidate;
  return localDateTimeToUtcIso(
    addDaysToDateKey(drawDateKey, -1),
    settings.timezone,
    hour ?? 8,
    minute ?? 0
  );
}

function buyByTime(snapshot: LotteryDrawSnapshot, game: LotteryGameSettings): string {
  return new Date(
    new Date(snapshot.officialCutoffAt!).getTime() - game.buyByBufferMinutes * 60_000
  ).toISOString();
}

function alertMetadata(alert: LotteryTaskAlert): Record<string, unknown> {
  return asRecord(alert.metadata);
}

async function cancelAlert(
  store: RyanStore,
  alert: LotteryTaskAlert,
  reason: string,
  now: Date
): Promise<boolean> {
  if (!alert.itemId) return false;
  const item = await store.getItem(alert.itemId);
  if (!item || item.status === "done") return false;
  if (!["open", "active", "waiting"].includes(item.status)) {
    await store.updateLotteryTaskAlert(alert.id, {
      status: "cancelled",
      metadata: asJsonObject({ ...alertMetadata(alert), cancellationReason: "user_cancelled" })
    });
    return false;
  }
  await store.updateItem(item.id, {
    status: "cancelled",
    cancelledAt: now.toISOString(),
    starredAt: null
  });
  await store.updateLotteryTaskAlert(alert.id, {
    status: "cancelled",
    metadata: asJsonObject({
      ...alertMetadata(alert),
      cancellationReason: reason,
      cancelledAt: now.toISOString()
    })
  });
  await store.addItemEvent({
    userId: alert.userId,
    itemId: item.id,
    eventType: "cancelled",
    occurredAt: now.toISOString(),
    payload: asJsonObject({ gameId: alert.gameId, drawAt: alert.drawAt, reason })
  });
  return true;
}

function canReactivate(alert: LotteryTaskAlert): boolean {
  const reason = alertMetadata(alert).cancellationReason;
  return (
    typeof reason === "string" &&
    ["integration_disabled", "game_disabled", "below_threshold"].includes(reason)
  );
}

export type LotteryReconcileResult = {
  userId: UUID;
  created: number;
  updated: number;
  cancelled: number;
  unchanged: number;
  skipped: number;
  error?: string;
};

export async function reconcileLotteryUser(
  store: RyanStore,
  setting: UserIntegrationSetting,
  snapshots: LotteryDrawSnapshot[],
  now = new Date()
): Promise<LotteryReconcileResult> {
  const settings = normalizeLotterySettings(setting.metadata);
  const result: LotteryReconcileResult = {
    userId: setting.userId,
    created: 0,
    updated: 0,
    cancelled: 0,
    unchanged: 0,
    skipped: 0
  };
  const openAlerts = await store.listLotteryTaskAlerts({
    userId: setting.userId,
    statuses: ["created"],
    limit: 500
  });
  const snapshotByGame = new Map(snapshots.map((snapshot) => [snapshot.gameId, snapshot]));

  for (const alert of openAlerts) {
    const snapshot = snapshotByGame.get(alert.gameId);
    const game = settings.games[alert.gameId];
    const currentDrawing = snapshot?.nextDrawAt === alert.drawAt;
    let reason: string | undefined;
    if (!setting.enabled) reason = "integration_disabled";
    else if (!game.enabled) reason = "game_disabled";
    else if (new Date(String(alertMetadata(alert).officialCutoffAt ?? alert.drawAt)).getTime() <= now.getTime()) {
      reason = "sales_closed";
    } else if (
      currentDrawing &&
      snapshot !== undefined &&
      snapshotUsable(snapshot, now) &&
      snapshot?.advertisedJackpotDollars !== undefined &&
      game.minimumJackpotDollars !== null &&
      snapshot.advertisedJackpotDollars < game.minimumJackpotDollars
    ) {
      reason = "below_threshold";
    }
    if (reason && await cancelAlert(store, alert, reason, now)) result.cancelled += 1;
  }

  if (!setting.enabled) return result;
  for (const gameId of lotteryGameIds) {
    const game = settings.games[gameId];
    const snapshot = snapshotByGame.get(gameId);
    if (!game.enabled || !snapshot || !snapshotUsable(snapshot, now)) {
      result.skipped += 1;
      continue;
    }
    if (
      game.minimumJackpotDollars !== null &&
      snapshot.advertisedJackpotDollars! < game.minimumJackpotDollars
    ) {
      result.skipped += 1;
      continue;
    }
    const buyByAt = buyByTime(snapshot, game);
    const createAt = new Date(creationTimeForDraw(snapshot, settings, buyByAt));
    if (now < createAt || now >= new Date(buyByAt)) {
      result.skipped += 1;
      continue;
    }

    const body = taskBody(snapshot, settings, buyByAt);
    const taskMetadata = asJsonObject({
      source: "lottery",
      lotteryGameId: gameId,
      lotteryDrawAt: snapshot.nextDrawAt,
      lotteryOfficialCutoffAt: snapshot.officialCutoffAt,
      lotteryAdvertisedJackpotDollars: snapshot.advertisedJackpotDollars,
      lotterySourceUrl: snapshot.sourceUrl
    });
    const alertResult = await store.createLotteryTaskAlert({
      userId: setting.userId,
      gameId,
      drawAt: snapshot.nextDrawAt!,
      advertisedJackpotDollars: snapshot.advertisedJackpotDollars!,
      buyByAt,
      ...(settings.autoStar ? { starredAt: now.toISOString() } : {}),
      item: {
        title: `Buy a ${lotteryGameConfigs[gameId].name} ticket`,
        body,
        priority: "normal",
        metadata: taskMetadata
      },
      metadata: asJsonObject({
        officialCutoffAt: snapshot.officialCutoffAt,
        sourceUrl: snapshot.sourceUrl,
        autoStarEnabled: settings.autoStar,
        generatedBody: body,
        summaryManaged: true
      })
    });
    if (alertResult.created) {
      result.created += 1;
      await store.addItemEvent({
        userId: setting.userId,
        itemId: alertResult.item.id,
        eventType: "created",
        occurredAt: now.toISOString(),
        idempotencyKey: `lottery:${setting.userId}:${gameId}:${snapshot.nextDrawAt}`,
        payload: asJsonObject({
          gameId,
          drawAt: snapshot.nextDrawAt,
          advertisedJackpotDollars: snapshot.advertisedJackpotDollars
        })
      });
      await store.addAuditLog({
        userId: setting.userId,
        actorType: "system",
        action: "lottery.task.create",
        targetType: "item",
        targetId: alertResult.item.id,
        request: asJsonObject({ gameId, drawAt: snapshot.nextDrawAt }),
        result: asJsonObject({ alertId: alertResult.alert.id }),
        status: "success",
        metadata: {}
      });
      continue;
    }

    const item = alertResult.item;
    if (
      alertResult.alert.status === "cancelled" &&
      canReactivate(alertResult.alert) &&
      item.status !== "done"
    ) {
      await store.updateItem(item.id, {
        status: "open",
        cancelledAt: null,
        dueAt: buyByAt,
        body,
        starredAt: settings.autoStar ? now.toISOString() : null,
        metadata: taskMetadata
      });
      await store.updateLotteryTaskAlert(alertResult.alert.id, {
        status: "created",
        advertisedJackpotDollars: snapshot.advertisedJackpotDollars!,
        buyByAt,
        metadata: asJsonObject({
          officialCutoffAt: snapshot.officialCutoffAt,
          sourceUrl: snapshot.sourceUrl,
          autoStarEnabled: settings.autoStar,
          generatedBody: body,
          summaryManaged: true
        })
      });
      result.updated += 1;
      continue;
    }
    if (item.status === "done" || item.deletedAt || item.status === "cancelled") {
      result.unchanged += 1;
      continue;
    }

    const existingMetadata = alertMetadata(alertResult.alert);
    const previousAutoStarEnabled = existingMetadata.autoStarEnabled === true;
    const autoStarSettingChanged = previousAutoStarEnabled !== settings.autoStar;
    const previousGeneratedBody =
      typeof existingMetadata.generatedBody === "string"
        ? existingMetadata.generatedBody
        : undefined;
    const summaryManaged =
      existingMetadata.summaryManaged !== false &&
      (previousGeneratedBody === undefined || item.body === previousGeneratedBody);
    const bodyNeedsUpdate = summaryManaged && item.body !== body;
    if (
      item.dueAt !== buyByAt ||
      bodyNeedsUpdate ||
      autoStarSettingChanged ||
      alertResult.alert.advertisedJackpotDollars !== snapshot.advertisedJackpotDollars
    ) {
      const patch: Parameters<RyanStore["updateItem"]>[1] = {
        dueAt: buyByAt,
        metadata: taskMetadata
      };
      if (bodyNeedsUpdate) patch.body = body;
      if (autoStarSettingChanged) {
        patch.starredAt = settings.autoStar ? now.toISOString() : null;
      }
      await store.updateItem(item.id, patch);
      await store.updateLotteryTaskAlert(alertResult.alert.id, {
        advertisedJackpotDollars: snapshot.advertisedJackpotDollars!,
        buyByAt,
        metadata: asJsonObject({
          officialCutoffAt: snapshot.officialCutoffAt,
          sourceUrl: snapshot.sourceUrl,
          autoStarEnabled: settings.autoStar,
          generatedBody: summaryManaged ? body : previousGeneratedBody,
          summaryManaged
        })
      });
      result.updated += 1;
    } else {
      result.unchanged += 1;
    }
  }
  return result;
}

export async function runLotteryCheck(input: {
  store: RyanStore;
  source: LotteryDataSource;
  userId?: UUID;
  refresh?: boolean;
  now?: Date;
}): Promise<{
  snapshots: LotteryDrawSnapshot[];
  results: LotteryReconcileResult[];
}> {
  const now = input.now ?? new Date();
  const settings = input.userId
    ? [await input.store.getUserIntegrationSetting(input.userId, "lottery")].filter(
        (setting): setting is UserIntegrationSetting => setting !== undefined
      )
    : await input.store.listUserIntegrationSettingsForIntegration("lottery");
  const shouldRefresh =
    input.refresh !== false && (input.userId !== undefined || settings.length > 0);
  const snapshots = shouldRefresh
    ? await refreshLotterySnapshots(input.store, input.source, now)
    : await input.store.listLotteryDrawSnapshots();
  const results: LotteryReconcileResult[] = [];
  for (const setting of settings) {
    try {
      results.push(await reconcileLotteryUser(input.store, setting, snapshots, now));
    } catch (error) {
      results.push({
        userId: setting.userId,
        created: 0,
        updated: 0,
        cancelled: 0,
        unchanged: 0,
        skipped: 0,
        error: (error instanceof Error ? error.message : String(error)).slice(0, 500)
      });
    }
  }
  return { snapshots, results };
}

export function lotterySnapshotIsStale(snapshot: LotteryDrawSnapshot, now = new Date()): boolean {
  return !snapshotUsable(snapshot, now);
}
