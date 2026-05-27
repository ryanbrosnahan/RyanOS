export type TelegramSendMessageInput = {
  token: string;
  chatId: string;
  text: string;
  replyToMessageId?: string;
};

export type TelegramSendMessageResult = {
  providerMessageId?: string;
};

type TelegramEnvelope = {
  ok?: boolean;
  description?: string;
  result?: {
    message_id?: string | number;
  };
};

export async function sendTelegramMessage(
  input: TelegramSendMessageInput,
  fetchFn: typeof fetch = fetch
): Promise<TelegramSendMessageResult> {
  const payload: Record<string, unknown> = {
    chat_id: input.chatId,
    text: input.text,
    disable_web_page_preview: true
  };
  if (input.replyToMessageId && /^\d+$/.test(input.replyToMessageId)) {
    payload.reply_to_message_id = Number(input.replyToMessageId);
  }

  const response = await fetchFn(`https://api.telegram.org/bot${input.token}/sendMessage`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const body = (await response.json().catch(() => ({}))) as TelegramEnvelope;
  if (!response.ok || body.ok !== true) {
    throw new Error(
      `Telegram sendMessage failed with HTTP ${response.status}: ${
        body.description ?? response.statusText
      }`
    );
  }

  const providerMessageId = body.result?.message_id;
  return typeof providerMessageId === "undefined"
    ? {}
    : { providerMessageId: String(providerMessageId) };
}
