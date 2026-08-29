import { describe, expect, it, vi } from "vitest";
import {
  PollingStoppedError,
  RetriableRequestError,
  retryDelayMs,
  retryOperation
} from "../src/telegram-poll-cli.js";

describe("Telegram poll retries", () => {
  it("backs off transient failures without restarting the process", async () => {
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new RetriableRequestError("fetch failed"))
      .mockRejectedValueOnce(new RetriableRequestError("Telegram returned 502"))
      .mockResolvedValue("connected");
    const delays: number[] = [];

    const result = await retryOperation({
      operation: "telegram.getUpdates",
      run,
      shouldStop: () => false,
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
      baseDelayMs: 1_000,
      maxDelayMs: 60_000,
      random: () => 0
    });

    expect(result).toBe("connected");
    expect(run).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([1_000, 2_000]);
  });

  it("honors Telegram retry_after when it exceeds exponential backoff", () => {
    expect(
      retryDelayMs(new RetriableRequestError("rate limited", 15_000), 2, 1_000, 60_000, () => 0)
    ).toBe(15_000);
  });

  it("stops retrying cleanly during shutdown", async () => {
    let stopped = false;

    await expect(
      retryOperation({
        operation: "telegram.getUpdates",
        run: async () => {
          throw new RetriableRequestError("fetch failed");
        },
        shouldStop: () => stopped,
        sleep: async () => {
          stopped = true;
        },
        random: () => 0
      })
    ).rejects.toBeInstanceOf(PollingStoppedError);
  });

  it("does not retry permanent failures", async () => {
    const run = vi.fn(async () => {
      throw new Error("Telegram getMe failed with HTTP 401");
    });

    await expect(
      retryOperation({
        operation: "telegram.getMe",
        run,
        shouldStop: () => false,
        sleep: async () => undefined
      })
    ).rejects.toThrow("HTTP 401");
    expect(run).toHaveBeenCalledOnce();
  });
});
