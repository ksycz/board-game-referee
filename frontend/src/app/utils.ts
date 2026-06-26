import { ApiError, type AskResponse, type HistoryMessage, type Rulebook } from "../api";
import { trimThread, type RecentExchange } from "../conversationStorage";
import type { AppError, ChatMode, ClarificationContext, Message } from "./types";

export function toAppError(err: unknown): AppError {
  if (err instanceof ApiError) {
    if (err.code === "rate_limit") {
      return { message: err.message, code: "rate_limit" };
    }
    if (err.code === "demo_readonly" || err.code === "demo_rulebook_only") {
      return { message: err.message, code: err.code };
    }
    if (err.code === "unauthorized") {
      return { message: err.message, code: "unauthorized" };
    }
  }
  return { message: err instanceof Error ? err.message : String(err) };
}

function matchesPromptMessage(left: Message, right: Message): boolean {
  if (left.role !== right.role) {
    return false;
  }
  if (left.role === "user" && right.role === "user") {
    return left.text === right.text;
  }
  if (left.role === "dispute" && right.role === "dispute") {
    return (
      left.situation === right.situation
      && left.playerA === right.playerA
      && left.playerB === right.playerB
    );
  }
  return false;
}

export function appendRulingToThread(
  existing: Message[],
  prompt: Extract<Message, { role: "user" } | { role: "dispute" }>,
  answer: AskResponse,
): Message[] {
  const last = existing[existing.length - 1];
  const withPrompt = last && matchesPromptMessage(last, prompt) ? existing : [...existing, prompt];
  return trimThread([...withPrompt, { role: "referee", data: answer }]);
}

export function getPendingClarification(messages: Message[]): ClarificationContext | null {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "referee" || !last.data.ruling.needs_clarification) {
    return null;
  }

  const question = last.data.ruling.clarification_question?.trim();
  if (!question) {
    return null;
  }

  for (let index = messages.length - 2; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") {
      return { originalQuestion: message.text, question, mode: "ask" };
    }
    if (message.role === "dispute") {
      return { originalQuestion: message.situation, question, mode: "dispute" };
    }
  }

  return { originalQuestion: "", question, mode: last.data.mode === "dispute" ? "dispute" : "ask" };
}

export function getActiveClarification(
  messages: Message[],
  chatMode: ChatMode,
  override: ClarificationContext | null | undefined,
): ClarificationContext | null {
  if (chatMode === "search") {
    return null;
  }

  const pending = override !== undefined ? override : getPendingClarification(messages);
  if (!pending) {
    return null;
  }

  const mode = pending.mode ?? "ask";
  if (mode === "ask" && chatMode === "dispute") {
    return null;
  }

  return pending;
}

export function findLastDisputeMessage(
  messages: Message[],
): Extract<Message, { role: "dispute" }> | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "dispute") {
      return message;
    }
  }
  return null;
}

export function buildHistory(messages: Message[]): HistoryMessage[] {
  let end = messages.length;
  while (end > 0 && messages[end - 1].role !== "referee") {
    end -= 1;
  }

  return messages.slice(0, end).map((msg) => {
    if (msg.role === "user") {
      return { role: "user", content: msg.text };
    }
    if (msg.role === "dispute") {
      return {
        role: "user",
        content: `Dispute — Situation: ${msg.situation} | Player A: ${msg.playerA} | Player B: ${msg.playerB}`,
      };
    }
    return { role: "assistant", content: msg.data.ruling.ruling };
  });
}

export function messageDomKey(msg: Message, index: number): string {
  if (msg.role === "user") {
    return `user-${index}-${msg.text}`;
  }
  if (msg.role === "dispute") {
    return `dispute-${index}-${msg.situation}`;
  }
  return `referee-${index}-${msg.data.ruling.ruling}`;
}

export const SIDEBAR_LIST_PREVIEW_LIMIT = 5;

export function sortRulebooks(books: Rulebook[]): Rulebook[] {
  return [...books].sort((left, right) => {
    const leftPinned = left.pinned ? 1 : 0;
    const rightPinned = right.pinned ? 1 : 0;
    if (leftPinned !== rightPinned) {
      return rightPinned - leftPinned;
    }
    return right.created_at.localeCompare(left.created_at);
  });
}

export function visibleRulebooks(
  books: Rulebook[],
  selectedId: string | null,
  showAll: boolean,
): Rulebook[] {
  const ordered = sortRulebooks(books);
  if (showAll || ordered.length <= SIDEBAR_LIST_PREVIEW_LIMIT) {
    return ordered;
  }

  const preview = ordered.slice(0, SIDEBAR_LIST_PREVIEW_LIMIT);
  if (selectedId && !preview.some((book) => book.id === selectedId)) {
    const selected = ordered.find((book) => book.id === selectedId);
    if (selected) {
      return [...ordered.slice(0, SIDEBAR_LIST_PREVIEW_LIMIT - 1), selected];
    }
  }

  return preview;
}

export function visibleRecentExchanges(
  exchanges: RecentExchange[],
  showAll: boolean,
): RecentExchange[] {
  if (showAll || exchanges.length <= SIDEBAR_LIST_PREVIEW_LIMIT) {
    return exchanges;
  }
  return exchanges.slice(0, SIDEBAR_LIST_PREVIEW_LIMIT);
}

export const SIDEBAR_COLLAPSED_KEY = "rules-referee:v1:sidebar-collapsed";
export const DESKTOP_LAYOUT_QUERY = "(min-width: 801px)";

export function loadSidebarCollapsed(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveSidebarCollapsed(collapsed: boolean): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (collapsed) {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, "1");
    } else {
      window.localStorage.removeItem(SIDEBAR_COLLAPSED_KEY);
    }
  } catch {
    // Ignore quota or privacy-mode errors.
  }
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  return target.isContentEditable;
}
