"use client";

import { GripHorizontal, Loader2, MessageSquare, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent
} from "react";
import { apiFetch, apiPath } from "./api-client";

type ToolResult = {
  status: string;
  messageForUser?: string;
  clarificationPrompt?: string;
  confirmationPrompt?: string;
};

type MessageResponse = {
  mode: string;
  storedMessage?: unknown;
  response?: {
    text: string;
    storedMessage?: unknown;
  };
  interpreted?: {
    text?: string;
    warnings?: string[];
    toolCalls?: Array<{ name: string }>;
  };
  result?: ToolResult;
  warnings?: string[];
};

type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type StoredMessage = {
  id: string;
  direction: string;
  text: string;
};

type MessagesResponse = {
  messages: StoredMessage[];
};

const defaultPanelHeight = 440;
const minPanelHeight = 320;
const maxPanelHeight = 820;

function clampPanelHeight(value: number): number {
  const viewportMax =
    typeof window === "undefined" ? maxPanelHeight : Math.max(minPanelHeight, window.innerHeight - 96);
  return Math.min(Math.max(value, minPanelHeight), Math.min(maxPanelHeight, viewportMax));
}

function responseText(payload: MessageResponse): string {
  return (
    payload.response?.text ??
    payload.result?.messageForUser ??
    payload.result?.clarificationPrompt ??
    payload.result?.confirmationPrompt ??
    payload.interpreted?.text ??
    "Message accepted."
  );
}

function messageToTurn(message: StoredMessage): ChatTurn {
  return {
    id: message.id,
    role: message.direction === "inbound" ? "user" : "assistant",
    text: message.text
  };
}

type ChatPanelProps = {
  variant?: "embedded" | "overlay";
};

export function ChatPanel({ variant = "embedded" }: ChatPanelProps = {}) {
  const overlay = variant === "overlay";
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [panelHeight, setPanelHeight] = useState(defaultPanelHeight);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const resizeHandleRef = useRef<HTMLButtonElement | null>(null);
  const dragStartRef = useRef<{ pointerId: number; y: number; height: number } | null>(null);
  const sendingRef = useRef(false);

  async function loadMessages(options?: { background?: boolean }) {
    try {
      const params = new URLSearchParams({
        provider: "web",
        chatId: "dashboard",
        limit: "20"
      });
      const response = await apiFetch(apiPath(`/v1/messages?${params.toString()}`), {
        cache: "no-store"
      });
      if (!response.ok) throw new Error(`Message history returned ${response.status}`);
      const payload = (await response.json()) as MessagesResponse;
      setTurns(payload.messages.map(messageToTurn));
    } catch (err) {
      if (!options?.background) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }

  useEffect(() => {
    const messages = messagesRef.current;
    if (!messages) return;
    messages.scrollTop = messages.scrollHeight;
  }, [turns, sending]);

  useEffect(() => {
    sendingRef.current = sending;
  }, [sending]);

  useEffect(() => {
    void loadMessages();
    const interval = window.setInterval(() => {
      if (!sendingRef.current && document.visibilityState === "visible") {
        void loadMessages({ background: true });
      }
    }, 15000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    function handleChatPrefill(event: Event) {
      const detail = (event as CustomEvent<{ text?: string }>).detail;
      setInput(detail?.text ?? "");
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }

    window.addEventListener("ryanos:chat-prefill", handleChatPrefill);
    return () => window.removeEventListener("ryanos:chat-prefill", handleChatPrefill);
  }, []);

  useEffect(() => {
    function clampOnResize() {
      setPanelHeight((current) => clampPanelHeight(current));
    }

    window.addEventListener("resize", clampOnResize);
    return () => window.removeEventListener("resize", clampOnResize);
  }, []);

  useEffect(() => {
    function resizeFromPointer(event: PointerEvent) {
      const start = dragStartRef.current;
      if (!start || start.pointerId !== event.pointerId) return;
      event.preventDefault();
      setPanelHeight(clampPanelHeight(start.height + event.clientY - start.y));
    }

    function stopResize(event: PointerEvent) {
      const start = dragStartRef.current;
      if (!start || start.pointerId !== event.pointerId) return;
      dragStartRef.current = null;
      const handle = resizeHandleRef.current;
      if (handle?.hasPointerCapture(event.pointerId)) {
        handle.releasePointerCapture(event.pointerId);
      }
    }

    window.addEventListener("pointermove", resizeFromPointer);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
    return () => {
      window.removeEventListener("pointermove", resizeFromPointer);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };
  }, []);

  function startResize(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = {
      pointerId: event.pointerId,
      y: event.clientY,
      height: panelHeight
    };
  }

  function resizeWithKeyboard(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const direction = event.key === "ArrowUp" ? -1 : 1;
    setPanelHeight((current) => clampPanelHeight(current + direction * 40));
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    const userTurn: ChatTurn = {
      id: crypto.randomUUID(),
      role: "user",
      text
    };
    setTurns((current) => [...current, userTurn]);
    setInput("");
    setError(null);
    setSending(true);

    try {
      const response = await apiFetch(apiPath("/v1/messages"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          provider: "web",
          chatId: "dashboard",
          text
        })
      });
      const payload = (await response.json()) as MessageResponse;
      if (!response.ok) {
        throw new Error(responseText(payload));
      }
      setTurns((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: responseText(payload)
        }
      ]);
      window.dispatchEvent(new Event("ryanos-items-refresh"));
      window.dispatchEvent(new Event("ryanos-focus-refresh"));
      if (payload.storedMessage || payload.response?.storedMessage) {
        void loadMessages({ background: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      id="assistant-intake"
      className={`flex flex-col bg-white ${
        overlay
          ? "h-full min-h-0"
          : "min-h-80 rounded-md border border-stone-300 shadow-sm"
      }`}
      style={overlay ? undefined : { height: panelHeight }}
    >
      <div className="flex items-center gap-2 px-4 pt-4">
        <MessageSquare className="h-5 w-5 text-sky-700" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-stone-950">Assistant intake</h2>
      </div>

      <div
        ref={messagesRef}
        className="mx-4 mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto rounded-sm border border-stone-200 bg-stone-50 p-3"
      >
        {turns.length === 0 ? (
          <p className="text-sm leading-6 text-stone-600">No messages yet.</p>
        ) : (
          turns.map((turn) => (
            <div
              key={turn.id}
              className={`max-w-[92%] rounded-md px-3 py-2 text-sm leading-6 ${
                turn.role === "user"
                  ? "ml-auto bg-stone-900 text-white"
                  : "bg-white text-stone-800 ring-1 ring-stone-200"
              }`}
            >
              {turn.text}
            </div>
          ))
        )}
      </div>

      {error ? <p className="mx-4 mt-3 text-sm leading-6 text-rose-700">{error}</p> : null}

      <form onSubmit={sendMessage} className="mx-4 mt-4 flex gap-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          className="min-h-12 flex-1 resize-y rounded-md border border-stone-300 bg-white px-3 py-2 text-sm leading-6 text-stone-950 outline-none focus:border-sky-700 focus:ring-2 focus:ring-sky-100"
          placeholder="Message RyanOS"
          rows={2}
        />
        <button
          type="submit"
          disabled={sending || input.trim().length === 0}
          className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-sky-700 bg-sky-700 text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:border-stone-300 disabled:bg-stone-200 disabled:text-stone-500"
          aria-label="Send message"
          title="Send message"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </form>

      {overlay ? null : (
        <button
          ref={resizeHandleRef}
          type="button"
          className="mt-3 flex h-5 shrink-0 cursor-ns-resize touch-none items-center justify-center rounded-b-md border-t border-stone-200 text-stone-400 hover:bg-stone-50 hover:text-stone-700 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-sky-200"
          title="Resize chat panel"
          aria-label="Resize chat panel"
          aria-orientation="horizontal"
          onPointerDown={startResize}
          onKeyDown={resizeWithKeyboard}
        >
          <GripHorizontal className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
