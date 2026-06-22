import type { AskResponse } from "./api";

export const MAX_STORED_EXCHANGES = 10;

const THREAD_KEY = "rules-referee:v1:threads";
const HISTORY_KEY = "rules-referee:v1:history";

export type StoredMessage =
  | { role: "user"; text: string }
  | { role: "dispute"; situation: string; playerA: string; playerB: string }
  | { role: "referee"; data: AskResponse };

export type HistoryExchange = {
  id: string;
  label: string;
  mode: "ask" | "dispute";
  messages: StoredMessage[];
  createdAt: string;
  pinned?: boolean;
};

export type RecentExchange = {
  id: string;
  label: string;
  mode: "ask" | "dispute";
  pinned?: boolean;
};

function isStoredMessage(value: unknown): value is StoredMessage {
  if (!value || typeof value !== "object" || !("role" in value)) {
    return false;
  }
  const role = (value as { role: string }).role;
  if (role === "user") {
    return typeof (value as { text?: string }).text === "string";
  }
  if (role === "dispute") {
    const dispute = value as { situation?: string; playerA?: string; playerB?: string };
    return (
      typeof dispute.situation === "string"
      && typeof dispute.playerA === "string"
      && typeof dispute.playerB === "string"
    );
  }
  if (role === "referee") {
    return typeof (value as { data?: unknown }).data === "object"
      && (value as { data?: unknown }).data !== null;
  }
  return false;
}

function isHistoryExchange(value: unknown): value is HistoryExchange {
  if (!value || typeof value !== "object") {
    return false;
  }
  const entry = value as HistoryExchange;
  return (
    typeof entry.id === "string"
    && typeof entry.label === "string"
    && (entry.mode === "ask" || entry.mode === "dispute")
    && Array.isArray(entry.messages)
    && entry.messages.every(isStoredMessage)
    && typeof entry.createdAt === "string"
  );
}

function readJson(key: string): Record<string, unknown> | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: Record<string, unknown>): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (Object.keys(value).length === 0) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, JSON.stringify(value));
    }
  } catch {
    // Ignore quota or privacy-mode errors.
  }
}

export function trimThread(messages: StoredMessage[]): StoredMessage[] {
  const refereeIndices = messages.flatMap((message, index) =>
    message.role === "referee" ? [index] : [],
  );
  if (refereeIndices.length <= MAX_STORED_EXCHANGES) {
    return messages;
  }

  const keepFromRef = refereeIndices[refereeIndices.length - MAX_STORED_EXCHANGES];
  let start = keepFromRef;
  while (start > 0 && messages[start - 1].role !== "referee") {
    start -= 1;
  }
  return messages.slice(start);
}

function trimHistory(entries: HistoryExchange[]): HistoryExchange[] {
  return entries.slice(-MAX_STORED_EXCHANGES);
}

function exchangeFromMessages(messages: StoredMessage[], refereeIndex: number): HistoryExchange | null {
  if (messages[refereeIndex]?.role !== "referee") {
    return null;
  }

  let start = refereeIndex;
  while (start > 0 && messages[start - 1].role !== "referee") {
    start -= 1;
  }

  const slice = messages.slice(start, refereeIndex + 1);
  let label = "Ruling";
  let mode: HistoryExchange["mode"] = "ask";

  for (const message of slice) {
    if (message.role === "user") {
      label = message.text;
      mode = "ask";
      break;
    }
    if (message.role === "dispute") {
      label = message.situation;
      mode = "dispute";
      break;
    }
  }

  return {
    id: crypto.randomUUID(),
    label,
    mode,
    messages: slice,
    createdAt: new Date().toISOString(),
  };
}

function exchangesFromThread(messages: StoredMessage[]): HistoryExchange[] {
  const entries: HistoryExchange[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role !== "referee") {
      continue;
    }
    const entry = exchangeFromMessages(messages, i);
    if (entry) {
      entries.push(entry);
    }
  }
  return trimHistory(entries);
}

function parseThreads(parsed: Record<string, unknown> | null): Record<string, StoredMessage[]> {
  if (!parsed) {
    return {};
  }
  const threads: Record<string, StoredMessage[]> = {};
  for (const [rulebookId, value] of Object.entries(parsed)) {
    if (!Array.isArray(value)) {
      continue;
    }
    const messages = value.filter(isStoredMessage);
    if (messages.length > 0) {
      threads[rulebookId] = trimThread(messages);
    }
  }
  return threads;
}

function parseHistory(parsed: Record<string, unknown> | null): Record<string, HistoryExchange[]> {
  if (!parsed) {
    return {};
  }
  const history: Record<string, HistoryExchange[]> = {};
  for (const [rulebookId, value] of Object.entries(parsed)) {
    if (!Array.isArray(value)) {
      continue;
    }
    const entries = value.filter(isHistoryExchange).map((entry) => ({
      ...entry,
      pinned: Boolean(entry.pinned),
    }));
    if (entries.length > 0) {
      history[rulebookId] = trimHistory(entries);
    }
  }
  return history;
}

function migrateLegacyThreads(
  threads: Record<string, StoredMessage[]>,
  history: Record<string, HistoryExchange[]>,
): Record<string, HistoryExchange[]> {
  const migrated = { ...history };
  for (const [rulebookId, messages] of Object.entries(threads)) {
    if (migrated[rulebookId]?.length) {
      continue;
    }
    const entries = exchangesFromThread(messages);
    if (entries.length > 0) {
      migrated[rulebookId] = entries;
    }
  }
  return migrated;
}

export function loadAllThreads(): Record<string, StoredMessage[]> {
  return parseThreads(readJson(THREAD_KEY));
}

export function loadAllHistory(): Record<string, HistoryExchange[]> {
  const threads = parseThreads(readJson(THREAD_KEY));
  const history = parseHistory(readJson(HISTORY_KEY));
  const merged = migrateLegacyThreads(threads, history);
  if (JSON.stringify(merged) !== JSON.stringify(history)) {
    writeJson(HISTORY_KEY, merged);
  }
  return merged;
}

export function saveThread(rulebookId: string, messages: StoredMessage[]): void {
  const all = loadAllThreads();
  const trimmed = trimThread(messages);
  if (trimmed.length === 0) {
    delete all[rulebookId];
  } else {
    all[rulebookId] = trimmed;
  }
  writeJson(THREAD_KEY, all);
}

function saveAllHistory(all: Record<string, HistoryExchange[]>): void {
  writeJson(HISTORY_KEY, all);
}

export function saveHistory(rulebookId: string, entries: HistoryExchange[]): void {
  const all = loadAllHistory();
  const trimmed = trimHistory(entries);
  if (trimmed.length === 0) {
    delete all[rulebookId];
  } else {
    all[rulebookId] = trimmed;
  }
  saveAllHistory(all);
}

export function appendExchange(
  rulebookId: string,
  messages: StoredMessage[],
): HistoryExchange | null {
  const entry = exchangeFromMessages(messages, messages.length - 1);
  if (!entry) {
    return null;
  }

  const all = loadAllHistory();
  const current = all[rulebookId] ?? [];
  const last = current[current.length - 1];
  if (
    last
    && last.label === entry.label
    && last.mode === entry.mode
    && Date.now() - Date.parse(last.createdAt) < 5000
  ) {
    return last;
  }
  const next = trimHistory([...current, entry]);
  all[rulebookId] = next;
  saveAllHistory(all);
  return entry;
}

export function getHistoryExchange(
  rulebookId: string,
  exchangeId: string,
): HistoryExchange | null {
  const entries = loadAllHistory()[rulebookId] ?? [];
  return entries.find((entry) => entry.id === exchangeId) ?? null;
}

export function removeHistoryExchange(rulebookId: string, exchangeId: string): boolean {
  const all = loadAllHistory();
  const current = all[rulebookId] ?? [];
  const next = current.filter((entry) => entry.id !== exchangeId);
  if (next.length === current.length) {
    return false;
  }
  if (next.length === 0) {
    delete all[rulebookId];
  } else {
    all[rulebookId] = next;
  }
  saveAllHistory(all);
  return true;
}

export function clearHistory(rulebookId: string): void {
  saveHistory(rulebookId, []);
}

export function sortHistoryExchanges(entries: HistoryExchange[]): HistoryExchange[] {
  return [...entries].sort((left, right) => {
    const leftPinned = left.pinned ? 1 : 0;
    const rightPinned = right.pinned ? 1 : 0;
    if (leftPinned !== rightPinned) {
      return rightPinned - leftPinned;
    }
    return right.createdAt.localeCompare(left.createdAt);
  });
}

export function removeRulebookStorage(rulebookId: string): void {
  saveThread(rulebookId, []);
  saveHistory(rulebookId, []);
}

export function setHistoryExchangePinned(
  rulebookId: string,
  exchangeId: string,
  pinned: boolean,
): boolean {
  const all = loadAllHistory();
  const current = all[rulebookId] ?? [];
  const index = current.findIndex((entry) => entry.id === exchangeId);
  if (index === -1) {
    return false;
  }
  current[index] = { ...current[index], pinned };
  all[rulebookId] = current;
  saveAllHistory(all);
  return true;
}

export function listRecentExchanges(entries: HistoryExchange[]): RecentExchange[] {
  return sortHistoryExchanges(entries).map((entry) => ({
    id: entry.id,
    label: entry.label,
    mode: entry.mode,
    pinned: Boolean(entry.pinned),
  }));
}
