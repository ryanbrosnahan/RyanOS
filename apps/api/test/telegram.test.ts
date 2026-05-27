import { describe, expect, it } from "vitest";
import { getTelegramSenderId, normalizeTelegramUpdate } from "../src/telegram.js";

describe("telegram webhook normalization", () => {
  it("normalizes provider transport data without interpreting intent", () => {
    const normalized = normalizeTelegramUpdate({
      update_id: 900001,
      message: {
        message_id: 77,
        date: 1779857600,
        chat: { id: 123456, type: "private" },
        from: {
          id: 424242,
          is_bot: false,
          first_name: "Ryan",
          username: "ryan"
        },
        text: "I changed the sheets yesterday"
      }
    });

    expect(normalized.status).toBe("message");
    if (normalized.status !== "message") throw new Error("Expected message");
    expect(normalized.message.provider).toBe("telegram");
    expect(normalized.message.id).toBe("77");
    expect(normalized.message.chatId).toBe("123456");
    expect(normalized.message.text).toBe("I changed the sheets yesterday");
    expect(getTelegramSenderId(normalized.message)).toBe("424242");
    expect(normalized.message.metadata).toMatchObject({
      telegram: {
        updateId: 900001,
        messageId: "77",
        contentKind: "text"
      }
    });
  });

  it("ignores unsupported or non-text updates", () => {
    expect(normalizeTelegramUpdate({ update_id: 1 }).status).toBe("ignored");
    expect(
      normalizeTelegramUpdate({
        update_id: 2,
        message: {
          message_id: 88,
          chat: { id: 123456, type: "private" }
        }
      })
    ).toMatchObject({ status: "ignored", reason: "non_text_message" });
  });
});
