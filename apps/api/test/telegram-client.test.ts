import { describe, expect, it } from "vitest";
import { sendTelegramMessage } from "../src/telegram-client.js";

describe("telegram client", () => {
  it("sends messages through Telegram sendMessage without placing the token in the body", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const result = await sendTelegramMessage(
      {
        token: "123456789:secret_token_value",
        chatId: "42",
        text: "hello",
        replyToMessageId: "100"
      },
      async (url, init) => {
        requests.push({
          url: String(url),
          body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
        });
        return Response.json({
          ok: true,
          result: {
            message_id: 200
          }
        });
      }
    );

    expect(result).toEqual({ providerMessageId: "200" });
    expect(requests).toEqual([
      {
        url: "https://api.telegram.org/bot123456789:secret_token_value/sendMessage",
        body: {
          chat_id: "42",
          text: "hello",
          disable_web_page_preview: true,
          reply_to_message_id: 100
        }
      }
    ]);
    expect(JSON.stringify(requests[0]?.body)).not.toContain("secret_token_value");
  });

  it("redacts the token from failed send errors", async () => {
    const token = "123456789:secret_token_value";
    let error: unknown;

    try {
      await sendTelegramMessage(
        {
          token,
          chatId: "42",
          text: "hello"
        },
        async () =>
          Response.json(
            {
              ok: false,
              description: "Unauthorized"
            },
            { status: 401 }
          )
      );
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("Unauthorized");
    expect((error as Error).message).not.toContain(token);
  });
});
