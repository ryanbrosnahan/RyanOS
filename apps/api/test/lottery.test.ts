import { InMemoryRyanStore } from "@ryanos/core";
import type { UUID } from "@ryanos/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import {
  defaultLotterySettings,
  localDateTimeToUtcIso,
  lotterySettingsMetadata,
  parseLotteryGamePage,
  reconcileLotteryUser,
  type LotteryDataSource
} from "../src/lottery.js";
import {
  internalLotteryCheckPath,
  signInternalLotteryCheckRequest,
  verifyInternalLotteryCheckRequest
} from "../src/internal-lottery-auth.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

function fixture(input: {
  title: string;
  jackpot: string;
  meta?: string;
  details?: string;
  drawLocal?: string;
}): string {
  return `
    <html>
      <head>
        <title>${input.title} | Louisiana Lottery Corporation</title>
        <link rel="canonical" href="https://louisianalottery.com/draw-games/test/" />
      </head>
      <body>
        <h1>${input.title}</h1>
        <div class="jackpot-summary">
          <div class="jackpot-summary__amount__meta">${input.meta ?? "Estimated Annuity"}</div>
          <div class="jackpot-summary__amount__value">${input.jackpot}</div>
          <div class="jackpot-summary__amount__details">${input.details ?? ""}</div>
          <time-countdown date="${input.drawLocal ?? "2026-07-22T22:00:00"}"></time-countdown>
        </div>
      </body>
    </html>
  `;
}

class FixedLotterySource implements LotteryDataSource {
  async fetchGame(gameId: "powerball" | "mega_millions" | "lotto" | "easy_5", fetchedAt?: string) {
    const drawDate = "2026-07-25";
    return {
      gameId,
      advertisedJackpotDollars: gameId === "powerball" ? 567_000_000 : 70_000_000,
      cashValueDollars: gameId === "powerball" ? 260_000_000 : 70_000_000,
      nextDrawAt: localDateTimeToUtcIso(drawDate, "America/Chicago", 22, 0),
      officialCutoffAt: localDateTimeToUtcIso(
        drawDate,
        "America/Chicago",
        gameId === "lotto" || gameId === "easy_5" ? 21 : 21,
        gameId === "lotto" || gameId === "easy_5" ? 30 : 0
      ),
      sourceUrl: `https://louisianalottery.com/draw-games/${gameId}/`,
      fetchedAt: fetchedAt ?? "2026-07-25T13:00:00.000Z"
    };
  }
}

describe("Louisiana Lottery page parsing", () => {
  const fetchedAt = "2026-07-22T15:00:00.000Z";

  it.each([
    ["powerball", "Powerball", "$567,000,000", "Estimated Annuity", "Cash Value: $258.8 Million", 567_000_000, 258_800_000],
    ["mega_millions", "Mega Millions", "$743,000,000", "Estimated Annuity", "Cash Value: $338.2 Million", 743_000_000, 338_200_000],
    ["lotto", "Louisiana Lotto", "$2,850,000", "Cash Prize", "", 2_850_000, 2_850_000],
    ["easy_5", "Easy 5", "$70,000", "Cash Prize", "", 70_000, 70_000]
  ] as const)(
    "parses %s jackpot, drawing, and cutoff",
    (gameId, title, jackpot, meta, details, advertised, cash) => {
      const parsed = parseLotteryGamePage(
        gameId,
        fixture({ title, jackpot, meta, details }),
        fetchedAt
      );

      expect(parsed).toMatchObject({
        gameId,
        advertisedJackpotDollars: advertised,
        cashValueDollars: cash,
        nextDrawAt: "2026-07-23T03:00:00.000Z"
      });
      expect(parsed.officialCutoffAt).toBe(
        gameId === "lotto" || gameId === "easy_5"
          ? "2026-07-23T02:30:00.000Z"
          : "2026-07-23T02:00:00.000Z"
      );
    }
  );

  it("rejects a page whose identity or required values changed", () => {
    expect(() =>
      parseLotteryGamePage(
        "powerball",
        fixture({ title: "Mega Millions", jackpot: "$567,000,000" }),
        fetchedAt
      )
    ).toThrow(/identify itself as Powerball/);
    expect(() =>
      parseLotteryGamePage(
        "powerball",
        fixture({ title: "Powerball", jackpot: "Unavailable" }),
        fetchedAt
      )
    ).toThrow(/jackpot was missing or invalid/);
  });

  it("converts configured local times across Central daylight-saving boundaries", () => {
    expect(localDateTimeToUtcIso("2026-03-08", "America/Chicago", 8, 0)).toBe(
      "2026-03-08T13:00:00.000Z"
    );
    expect(localDateTimeToUtcIso("2026-11-01", "America/Chicago", 8, 0)).toBe(
      "2026-11-01T14:00:00.000Z"
    );
  });
});

describe("lottery task reconciliation", () => {
  async function configuredStore(userId: UUID, threshold = 500_000_000) {
    const store = new InMemoryRyanStore();
    const settings = defaultLotterySettings();
    settings.games.powerball = {
      enabled: true,
      minimumJackpotDollars: threshold,
      buyByBufferMinutes: 120
    };
    const setting = await store.upsertUserIntegrationSetting({
      userId,
      integrationId: "lottery",
      enabled: true,
      metadata: lotterySettingsMetadata(settings)
    });
    const now = new Date("2026-07-22T13:01:00.000Z");
    const nextDrawAt = localDateTimeToUtcIso("2026-07-22", "America/Chicago", 22, 0);
    const officialCutoffAt = localDateTimeToUtcIso("2026-07-22", "America/Chicago", 21, 0);
    const snapshot = await store.upsertLotteryDrawSnapshot({
      gameId: "powerball",
      status: "ready",
      advertisedJackpotDollars: 567_000_000,
      cashValueDollars: 258_800_000,
      nextDrawAt,
      officialCutoffAt,
      sourceUrl: "https://louisianalottery.com/draw-games/powerball/",
      fetchedAt: now.toISOString(),
      lastAttemptAt: now.toISOString(),
      lastSuccessAt: now.toISOString()
    });
    return { store, setting, snapshot, now, officialCutoffAt };
  }

  it("creates one starred task per drawing with the personal buy-by due time", async () => {
    const { store, setting, snapshot, now, officialCutoffAt } = await configuredStore(
      "user-a" as UUID
    );

    const first = await reconcileLotteryUser(store, setting, [snapshot], now);
    const second = await reconcileLotteryUser(store, setting, [snapshot], now);
    const items = await store.listItems({ userId: setting.userId, limit: 20 });

    expect(first.created).toBe(1);
    expect(second.created).toBe(0);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "Buy a Powerball ticket",
      dueAt: new Date(new Date(officialCutoffAt).getTime() - 120 * 60_000).toISOString(),
      starredAt: now.toISOString()
    });
    expect(items[0]?.body).toContain("Advertised jackpot");
    expect(items[0]?.body).toContain("licensed Louisiana Lottery retailer");
  });

  it("cancels below-threshold tasks and reactivates the same item when eligible again", async () => {
    const { store, setting, snapshot, now } = await configuredStore("user-a" as UUID);
    await reconcileLotteryUser(store, setting, [snapshot], now);
    const original = (await store.listItems({ userId: setting.userId, limit: 20 }))[0]!;

    const raised = defaultLotterySettings();
    raised.games.powerball = {
      enabled: true,
      minimumJackpotDollars: 600_000_000,
      buyByBufferMinutes: 120
    };
    const raisedSetting = await store.upsertUserIntegrationSetting({
      userId: setting.userId,
      integrationId: "lottery",
      enabled: true,
      metadata: lotterySettingsMetadata(raised)
    });
    const cancelled = await reconcileLotteryUser(store, raisedSetting, [snapshot], now);
    expect(cancelled.cancelled).toBe(1);
    expect((await store.getItem(original.id))?.status).toBe("cancelled");

    const lowered = defaultLotterySettings();
    lowered.games.powerball.enabled = true;
    const eligibleSetting = await store.upsertUserIntegrationSetting({
      userId: setting.userId,
      integrationId: "lottery",
      enabled: true,
      metadata: lotterySettingsMetadata(lowered)
    });
    const reactivated = await reconcileLotteryUser(store, eligibleSetting, [snapshot], now);

    expect(reactivated.updated).toBe(1);
    expect((await store.getItem(original.id))?.status).toBe("open");
    expect(store.items.size).toBe(1);
  });

  it("does not re-star a generated task after the user unstars it", async () => {
    const { store, setting, snapshot, now } = await configuredStore("user-a" as UUID);
    await reconcileLotteryUser(store, setting, [snapshot], now);
    const item = (await store.listItems({ userId: setting.userId, limit: 20 }))[0]!;

    await store.updateItem(item.id, { starredAt: null });
    await reconcileLotteryUser(store, setting, [snapshot], now);

    expect((await store.getItem(item.id))?.starredAt).toBeUndefined();
  });

  it("fails closed for stale data and cancels an open reminder after sales close", async () => {
    const { store, setting, snapshot, now, officialCutoffAt } = await configuredStore(
      "user-a" as UUID
    );
    const staleSnapshot = {
      ...snapshot,
      lastSuccessAt: new Date(now.getTime() - 4 * 60 * 60_000).toISOString()
    };

    const stale = await reconcileLotteryUser(store, setting, [staleSnapshot], now);
    expect(stale.created).toBe(0);
    expect(await store.listItems({ userId: setting.userId })).toHaveLength(0);

    await reconcileLotteryUser(store, setting, [snapshot], now);
    const item = (await store.listItems({ userId: setting.userId }))[0]!;
    const afterCutoff = new Date(new Date(officialCutoffAt).getTime() + 60_000);
    const expired = await reconcileLotteryUser(store, setting, [snapshot], afterCutoff);

    expect(expired.cancelled).toBe(1);
    expect((await store.getItem(item.id))?.status).toBe("cancelled");
    expect((await store.getItem(item.id))?.starredAt).toBeUndefined();
  });

  it("keeps tenants isolated when they follow the same drawing", async () => {
    const first = await configuredStore("user-a" as UUID);
    const secondSettings = defaultLotterySettings();
    secondSettings.games.powerball.enabled = true;
    const secondSetting = await first.store.upsertUserIntegrationSetting({
      userId: "user-b" as UUID,
      integrationId: "lottery",
      enabled: true,
      metadata: lotterySettingsMetadata(secondSettings)
    });

    await reconcileLotteryUser(first.store, first.setting, [first.snapshot], first.now);
    await reconcileLotteryUser(first.store, secondSetting, [first.snapshot], first.now);

    expect(await first.store.listItems({ userId: "user-a" as UUID })).toHaveLength(1);
    expect(await first.store.listItems({ userId: "user-b" as UUID })).toHaveLength(1);
  });
});

describe("lottery integration API and worker authentication", () => {
  it("is disabled by default and persists per-game settings", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const app = buildApp({ lotterySource: new FixedLotterySource() });

    const before = await app.inject({ method: "GET", url: "/v1/integrations" });
    const settings = defaultLotterySettings();
    settings.games.powerball.enabled = true;
    settings.games.powerball.minimumJackpotDollars = 500_000_000;
    const update = await app.inject({
      method: "PUT",
      url: "/v1/integrations/lottery",
      payload: {
        enabled: true,
        ...settings
      }
    });
    const after = await app.inject({ method: "GET", url: "/v1/integrations/lottery" });
    await app.close();

    expect(before.json().integrations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "lottery", enabled: false })
      ])
    );
    expect(update.statusCode).toBe(200);
    expect(after.json()).toMatchObject({
      settings: {
        enabled: true,
        games: {
          powerball: {
            enabled: true,
            minimumJackpotDollars: 500_000_000
          }
        }
      }
    });
  });

  it("uses a purpose-specific signature and rejects expired values", () => {
    const key = Buffer.alloc(32, 7);
    const body = JSON.stringify({ refresh: true });
    const signed = signInternalLotteryCheckRequest(key, body, "1784736000000");

    expect(internalLotteryCheckPath).toBe("/v1/internal/lottery/check-due");
    expect(verifyInternalLotteryCheckRequest({
      masterKey: key,
      body,
      ...signed,
      now: 1784736000100
    })).toBe(true);
    expect(verifyInternalLotteryCheckRequest({
      masterKey: key,
      body,
      ...signed,
      now: 1784737000000
    })).toBe(false);
  });

  it("rejects unsigned worker calls and reconciles every configured tenant", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const masterKey = Buffer.alloc(32, 9);
    vi.stubEnv("RYANOS_MASTER_KEY", masterKey.toString("hex"));
    const store = new InMemoryRyanStore();
    for (const userId of ["user-one", "user-two"]) {
      const settings = defaultLotterySettings();
      settings.games.powerball.enabled = true;
      await store.upsertUserIntegrationSetting({
        userId: userId as UUID,
        integrationId: "lottery",
        enabled: true,
        metadata: lotterySettingsMetadata(settings)
      });
    }
    const app = buildApp({ store, lotterySource: new FixedLotterySource() });
    const unsigned = await app.inject({
      method: "POST",
      url: internalLotteryCheckPath,
      payload: { refresh: true }
    });
    expect(unsigned.statusCode).toBe(401);

    const payload = { refresh: true };
    const body = JSON.stringify(payload);
    const signed = signInternalLotteryCheckRequest(masterKey, body);
    const response = await app.inject({
      method: "POST",
      url: internalLotteryCheckPath,
      headers: {
        "x-ryanos-internal-timestamp": signed.timestamp,
        "x-ryanos-internal-signature": signed.signature
      },
      payload
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json().snapshots).toHaveLength(4);
    expect(response.json().results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: "user-one" }),
        expect.objectContaining({ userId: "user-two" })
      ])
    );
  });
});
