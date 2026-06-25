import { getAccessKey } from "./accessKey";

const API = import.meta.env.VITE_API_URL ?? "";

export type AppConfig = {
  auth_required: boolean;
  demo_mode: boolean;
  full_access: boolean;
};

export async function fetchAppConfig(): Promise<AppConfig> {
  const res = await fetch(`${API}/api/config`, { headers: apiAuthHeaders() });
  if (!res.ok) {
    throw new Error("Failed to load app configuration");
  }
  return res.json() as Promise<AppConfig>;
}

export async function fetchAppConfigWithRetry(
  attempts = 3,
  delayMs = 400,
): Promise<AppConfig> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetchAppConfig();
    } catch (err) {
      lastError = err;
      if (attempt < attempts - 1) {
        await new Promise((resolve) => {
          window.setTimeout(resolve, delayMs * (attempt + 1));
        });
      }
    }
  }
  throw lastError;
}

export function apiAuthHeaders(
  extra?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = { ...(extra ?? {}) };
  const key = getAccessKey();
  if (key) {
    headers["X-API-Key"] = key;
  }
  return headers;
}

function parseErrorDetail(detail: unknown): string | undefined {
  if (typeof detail === "string") return detail;
  if (typeof detail === "object" && detail && "message" in detail) {
    return String((detail as { message: string }).message);
  }
  if (typeof detail === "object" && detail && "code" in detail && "message" in detail) {
    return String((detail as { message: string }).message);
  }
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === "object" && item && "msg" in item) {
          return String((item as { msg: string }).msg);
        }
        return String(item);
      })
      .join("; ");
  }
  return undefined;
}

export type ApiErrorCode = "rate_limit" | "unauthorized" | "demo_readonly" | "demo_rulebook_only";

export class ApiError extends Error {
  readonly code: ApiErrorCode | "unknown";
  readonly status: number;

  constructor(message: string, code: ApiErrorCode | "unknown", status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export function isRateLimitError(err: unknown): err is ApiError {
  return err instanceof ApiError && err.code === "rate_limit";
}

function parseApiError(status: number, body: Record<string, unknown>): ApiError {
  const detail = body.detail ?? body;
  const message = parseErrorDetail(detail) ?? "Request failed";
  const detailCode =
    typeof detail === "object" && detail && "code" in detail
      ? String((detail as { code?: string }).code ?? "")
      : "";

  if (status === 429 || detailCode === "rate_limit" || /rate limit/i.test(message)) {
    return new ApiError(message, "rate_limit", status);
  }
  if (status === 401 || detailCode === "unauthorized") {
    return new ApiError(message, "unauthorized", status);
  }
  if (detailCode === "demo_readonly") {
    return new ApiError(message, "demo_readonly", status);
  }
  if (detailCode === "demo_rulebook_only") {
    return new ApiError(message, "demo_rulebook_only", status);
  }

  return new ApiError(message, "unknown", status);
}

async function throwIfNotOk(res: Response, fallback: string): Promise<void> {
  if (res.ok) {
    return;
  }
  const body = await res.json().catch(() => ({}));
  const err = parseApiError(res.status, body as Record<string, unknown>);
  if (err.code === "unknown" && err.message === "Request failed") {
    throw new ApiError(fallback, "unknown", res.status);
  }
  throw err;
}

export type Rulebook = {
  id: string;
  name: string;
  filename: string;
  page_count: number;
  created_at: string;
  pinned?: boolean;
};

export type Citation = {
  page: number;
  section?: string;
  quote: string;
  valid?: boolean;
  issue?: string;
  source_excerpt?: string | null;
  source_section?: string | null;
};

export type SourceExcerpt = {
  page: number;
  section?: string | null;
  text: string;
};

export type SearchHit = {
  page: number;
  section: string | null;
  text: string;
  score: number | null;
};

export type SearchResponse = {
  agent: string;
  query: string;
  hits: SearchHit[];
};

export function cleanSearchExcerpt(text: string): string {
  let cleaned = text.replace(/\s+/g, " ").trim();
  cleaned = cleaned.replace(/^(?:\d{1,3}\s+){2,}/, "");
  cleaned = cleaned.replace(/^\d{1,2}\s+(?=[A-Z])/, "");
  cleaned = cleaned.replace(/[↘↗→←↓↑↔➘➙➜➔✓✗•▪▸►◆◇○●]+/g, " ");
  cleaned = cleaned.replace(/(?<=[.!?])\s+\d\s+(?=[A-Z])/g, " ");
  cleaned = cleaned.replace(/(?<=[.!?])\s+\d\s+(?=\d(?:\s+\d){2,})/g, " ");
  cleaned = cleaned.replace(/(?:\b\d\b\s+){3,}\d\b/g, " ");
  cleaned = cleaned.replace(/\bx\d+\b/gi, " ");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned.trim() || text.trim();
}

export function formatSearchExcerpt(text: string, maxLength = 160): string {
  const cleaned = cleanSearchExcerpt(text);
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  return `${cleaned.slice(0, maxLength - 1)}…`;
}

export type HistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type RulingFavors = "player_a" | "player_b" | "split" | "neither" | "unclear";

export type RetrievalMetrics = {
  retrieved_pages: number[];
  cited_pages: number[];
  cited_in_retrieval: number[];
  cited_missing_from_retrieval: number[];
  citation_recall: number | null;
  citations_checked: number;
  citations_valid: number;
  citation_pass_rate: number | null;
  all_citations_valid: boolean;
};

export type ConfidenceHint = {
  level: "caution" | "low";
  messages: string[];
};

export type AskResponse = {
  response_id?: string;
  mode: "ask" | "dispute";
  cached?: boolean;
  cached_at?: string;
  rulebook_id: string;
  rulebook_name: string;
  question?: string;
  situation?: string;
  player_a?: string;
  player_b?: string;
  retrieval: {
    chunks_found: number;
    pages: number[];
    sources?: SourceExcerpt[];
    metrics?: RetrievalMetrics;
  };
  ruling: {
    ruling: string;
    confidence: "high" | "medium" | "low";
    reasoning: string;
    citations: Citation[];
    needs_clarification: boolean;
    clarification_question: string | null;
    favors?: RulingFavors;
    player_a_assessment?: string;
    player_b_assessment?: string;
  };
  citation_check: {
    all_valid: boolean;
    issues: string[];
    citations: Citation[];
  };
  confidence_hint?: ConfidenceHint;
};

export type UploadProgress = {
  phase: "starting" | "reading" | "scanning" | "indexing";
  page: number;
  total_pages: number;
};

export type IngestionResult = {
  agent: string;
  total_pages?: number;
  pages_indexed?: number;
  pages_extracted: number;
  chunks_indexed: number;
  ocr_pages?: number;
  thin_pages?: number[];
  thin_page_count?: number;
  ocr_warning?: string;
};

export const CONTEXT_ENGINEERING_PDF_GUIDE_URL =
  "https://github.com/ksycz/board-game-referee/blob/main/docs/CONTEXT_ENGINEERING.md#graphical--layout-heavy-pdfs";

export type RulebookHealthSummary = {
  name: string;
  totalPages: number;
  pagesIndexed: number;
  chunksIndexed: number;
  ocrPages: number;
  thinPages: number[];
  ocrWarning?: string;
};

export function buildRulebookHealthSummary(
  name: string,
  ingestion?: IngestionResult,
): RulebookHealthSummary | null {
  if (!ingestion) {
    return null;
  }

  const pagesIndexed = ingestion.pages_indexed ?? ingestion.pages_extracted;
  return {
    name,
    totalPages: ingestion.total_pages ?? pagesIndexed,
    pagesIndexed,
    chunksIndexed: ingestion.chunks_indexed,
    ocrPages: ingestion.ocr_pages ?? 0,
    thinPages: ingestion.thin_pages ?? [],
    ocrWarning: ingestion.ocr_warning,
  };
}

export function formatThinPagesLabel(pages: number[]): string {
  if (pages.length === 0) {
    return "";
  }
  if (pages.length <= 6) {
    return pages.map((page) => `p. ${page}`).join(", ");
  }
  const preview = pages.slice(0, 5).map((page) => `p. ${page}`).join(", ");
  return `${preview}, … (+${pages.length - 5} more)`;
}

export type RulebookHealthCopy = {
  title: string;
  summary: string;
  cautions: string[];
};

export function formatRulebookHealthCopy(health: RulebookHealthSummary): RulebookHealthCopy {
  const {
    name,
    totalPages,
    pagesIndexed,
    ocrPages,
    thinPages,
    ocrWarning,
  } = health;

  const allPagesRead = pagesIndexed >= totalPages;
  const hasCautions = thinPages.length > 0 || !!ocrWarning || !allPagesRead || ocrPages > 0;

  const title = hasCautions ? `${name} is ready — a few notes` : `${name} is ready`;

  let summary: string;
  if (totalPages === 1) {
    summary = "We read the rulebook — ask a rules question below.";
  } else if (allPagesRead) {
    summary = `We read all ${totalPages} pages — ask a rules question below.`;
  } else {
    summary = `We read ${pagesIndexed} of ${totalPages} pages. Blank or picture-only pages are skipped.`;
  }

  const cautions: string[] = [];

  if (ocrWarning) {
    cautions.push(ocrWarning);
  } else if (ocrPages === 1) {
    cautions.push("One page was mostly graphics, so we scanned it to pull out the rules text.");
  } else if (ocrPages > 1) {
    cautions.push(
      `We scanned ${ocrPages} pages that were mostly graphics to pull out the rules text.`,
    );
  }

  if (thinPages.length === 1) {
    cautions.push(
      `Page ${thinPages[0]} had very little readable text — answers about that page may be weaker.`,
    );
  } else if (thinPages.length > 1) {
    const label = formatThinPagesLabel(thinPages);
    cautions.push(
      `${thinPages.length} pages had very little readable text (${label}) — answers there may be weaker.`,
    );
  }

  return { title, summary, cautions };
}

export type UploadResponse = {
  rulebook: Rulebook;
  example_questions: string[];
  ingestion?: IngestionResult;
  already_exists?: boolean;
  faq_cache_cleared?: number;
};

export function formatUploadSuccessMessage(name: string, ingestion?: IngestionResult): string {
  if (ingestion?.ocr_warning) {
    return ingestion.ocr_warning;
  }

  const ocrPages = ingestion?.ocr_pages ?? 0;
  if (ocrPages === 1) {
    return `"${name}" is ready. One page was mostly graphics, so we scanned it to pull out the rules text.`;
  }
  if (ocrPages > 1) {
    return `"${name}" is ready. We scanned ${ocrPages} pages that were mostly graphics to pull out the rules text.`;
  }

  return `"${name}" is ready — you can ask rules questions now.`;
}

export function formatUploadProgressMessage(
  progress: UploadProgress,
  source: "upload" | "bgg" | "reindex" = "upload",
): string {
  const { phase, page, total_pages } = progress;
  if (phase === "starting") {
    if (source === "bgg") return "Downloading from BoardGameGeek…";
    if (source === "reindex") return "Re-opening PDF…";
    return "Opening PDF…";
  }
  if (phase === "indexing") return "Building search index…";
  if (phase === "scanning" && total_pages > 0) {
    return `Scanning page ${page} of ${total_pages} (mostly graphics)…`;
  }
  if (phase === "reading" && total_pages > 0) {
    return `Reading page ${page} of ${total_pages}…`;
  }
  return "Processing rulebook…";
}

export function uploadProgressPercent(progress: UploadProgress): number {
  const { phase, page, total_pages } = progress;
  if (phase === "indexing") return 95;
  if (phase === "starting" || total_pages <= 0) return 5;
  const pageFraction = page / total_pages;
  if (phase === "scanning") return Math.min(90, 5 + pageFraction * 85);
  return Math.min(88, 5 + pageFraction * 83);
}

type UploadStreamEvent =
  | { type: "progress"; progress: UploadProgress }
  | { type: "complete"; data: UploadResponse }
  | { type: "duplicate"; rulebook: Rulebook; example_questions: string[]; message: string }
  | { type: "error"; message: string; bgg_url?: string; code?: string };

function parseSseChunk(buffer: string): { events: UploadStreamEvent[]; rest: string } {
  const events: UploadStreamEvent[] = [];
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";

  for (const part of parts) {
    if (!part.trim()) continue;
    let eventName = "message";
    let dataLine = "";
    for (const line of part.split("\n")) {
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLine += line.slice(5).trim();
      }
    }
    if (!dataLine) continue;

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(dataLine) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (eventName === "progress") {
      events.push({
        type: "progress",
        progress: {
          phase: payload.phase as UploadProgress["phase"],
          page: Number(payload.page ?? 0),
          total_pages: Number(payload.total_pages ?? 0),
        },
      });
    } else if (eventName === "complete") {
      events.push({
        type: "complete",
        data: {
          rulebook: payload.rulebook as Rulebook,
          example_questions: (payload.example_questions as string[]) ?? [],
          ingestion: payload.ingestion as IngestionResult | undefined,
          faq_cache_cleared: typeof payload.faq_cache_cleared === "number"
            ? payload.faq_cache_cleared
            : undefined,
        },
      });
    } else if (eventName === "duplicate") {
      events.push({
        type: "duplicate",
        rulebook: payload.rulebook as Rulebook,
        example_questions: (payload.example_questions as string[]) ?? [],
        message: String(payload.message ?? "This rulebook is already in your library."),
      });
    } else if (eventName === "error") {
      events.push({
        type: "error",
        message: String(payload.message ?? "Upload failed"),
        bgg_url: typeof payload.bgg_url === "string" ? payload.bgg_url : undefined,
        code: typeof payload.code === "string" ? payload.code : undefined,
      });
    }
  }

  return { events, rest };
}

async function readUploadStream(
  body: ReadableStream<Uint8Array>,
  onProgress?: (progress: UploadProgress) => void,
): Promise<UploadStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseChunk(buffer);
    buffer = parsed.rest;
    for (const event of parsed.events) {
      if (event.type === "progress") {
        onProgress?.(event.progress);
      } else {
        return event;
      }
    }
  }

  const parsed = parseSseChunk(`${buffer}\n\n`);
  for (const event of parsed.events) {
    if (event.type === "progress") {
      onProgress?.(event.progress);
    } else {
      return event;
    }
  }

  throw new Error("Upload ended before the server finished processing.");
}

export class DuplicateRulebookError extends Error {
  readonly rulebook: Rulebook;
  readonly example_questions: string[];

  constructor(message: string, rulebook: Rulebook, example_questions: string[]) {
    super(message);
    this.name = "DuplicateRulebookError";
    this.rulebook = rulebook;
    this.example_questions = example_questions;
  }
}

export function isDuplicateRulebookError(err: unknown): err is DuplicateRulebookError {
  return (
    err instanceof DuplicateRulebookError
    || (typeof err === "object"
      && err !== null
      && (err as { name?: string }).name === "DuplicateRulebookError"
      && "rulebook" in err)
  );
}

export type BggRulebookFile = {
  file_id: string;
  filepage_id: string;
  title: string;
  filename: string;
  size: number;
  language: string | null;
  votes: number;
  score: number;
  bgg_url: string;
  download_url: string;
};

export type BggLookupResponse = {
  thing_id: string;
  game_name: string;
  files: BggRulebookFile[];
};

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function lookupBggRulebooks(url: string): Promise<BggLookupResponse> {
  const res = await fetch(`${API}/api/rulebooks/bgg/lookup`, {
    method: "POST",
    headers: apiAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    await throwIfNotOk(res, "Could not look up that BoardGameGeek link");
  }
  return res.json();
}

export async function listRulebooks(): Promise<Rulebook[]> {
  const res = await fetch(`${API}/api/rulebooks`, { headers: apiAuthHeaders() });
  await throwIfNotOk(res, "Failed to load rulebooks");
  return res.json();
}

export async function validateAccessKey(): Promise<boolean> {
  const res = await fetch(`${API}/api/rulebooks`, { headers: apiAuthHeaders() });
  return res.ok;
}

export async function uploadRulebook(
  file: File,
  name?: string,
  onProgress?: (progress: UploadProgress) => void,
): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  if (name) form.append("name", name);

  const res = await fetch(`${API}/api/rulebooks/upload-stream`, {
    method: "POST",
    headers: apiAuthHeaders(),
    body: form,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw parseApiError(res.status, data as Record<string, unknown>);
  }
  if (!res.body) {
    throw new Error("Upload failed — no response from server.");
  }

  const result = await readUploadStream(res.body, onProgress);
  if (result.type === "complete") {
    return result.data;
  }
  if (result.type === "duplicate") {
    throw new DuplicateRulebookError(
      result.message,
      result.rulebook,
      result.example_questions,
    );
  }
  if (result.type === "error") {
    throw new Error(result.message);
  }
  throw new Error("Upload failed.");
}

export async function fetchExampleQuestions(rulebookId: string): Promise<string[]> {
  const res = await fetch(`${API}/api/rulebooks/${rulebookId}/examples`, {
    headers: apiAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(parseErrorDetail(err.detail) ?? "Failed to load example questions");
  }
  const data = await res.json();
  return data.questions ?? [];
}

export async function searchRulebook(
  rulebookId: string,
  query: string,
  limit = 8,
): Promise<SearchResponse> {
  const res = await fetch(`${API}/api/rulebooks/${rulebookId}/search`, {
    method: "POST",
    headers: apiAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ query, limit }),
  });
  if (!res.ok) {
    await throwIfNotOk(res, "Search failed");
  }
  return res.json();
}

export async function askRulebook(
  rulebookId: string,
  question: string,
  history: HistoryMessage[] = [],
): Promise<AskResponse> {
  const res = await fetch(`${API}/api/rulebooks/${rulebookId}/ask`, {
    method: "POST",
    headers: apiAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ question, history }),
  });
  if (!res.ok) {
    await throwIfNotOk(res, "Question failed");
  }
  return res.json();
}

export async function disputeRulebook(
  rulebookId: string,
  situation: string,
  playerA: string,
  playerB: string,
  history: HistoryMessage[] = [],
): Promise<AskResponse> {
  const res = await fetch(`${API}/api/rulebooks/${rulebookId}/dispute`, {
    method: "POST",
    headers: apiAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      situation,
      player_a: playerA,
      player_b: playerB,
      history,
    }),
  });
  if (!res.ok) {
    await throwIfNotOk(res, "Dispute failed");
  }
  return res.json();
}

export async function deleteRulebook(rulebookId: string): Promise<void> {
  const res = await fetch(`${API}/api/rulebooks/${rulebookId}`, {
    method: "DELETE",
    headers: apiAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(parseErrorDetail(err.detail) ?? "Delete failed");
  }
}

export async function pinRulebook(rulebookId: string, pinned: boolean): Promise<Rulebook> {
  const res = await fetch(`${API}/api/rulebooks/${rulebookId}/pin`, {
    method: "PATCH",
    headers: apiAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ pinned }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(parseErrorDetail(err.detail) ?? "Could not update pin");
  }
  return res.json();
}

export function rulebookPagePreviewUrl(
  rulebookId: string,
  page: number,
  options?: { zoom?: number },
): string {
  let path = `${API}/api/rulebooks/${rulebookId}/pages/${page}/preview`;
  if (options?.zoom !== undefined) {
    path += `?zoom=${encodeURIComponent(String(options.zoom))}`;
  }
  return path;
}

export async function fetchRulebookPagePreviewBlob(
  rulebookId: string,
  page: number,
  options?: { zoom?: number },
): Promise<string> {
  const url = rulebookPagePreviewUrl(rulebookId, page, options);
  const res = await fetch(url, { headers: apiAuthHeaders() });
  if (!res.ok) {
    await throwIfNotOk(res, "Page preview unavailable");
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export async function reindexRulebook(
  rulebookId: string,
  onProgress?: (progress: UploadProgress) => void,
): Promise<UploadResponse> {
  const res = await fetch(`${API}/api/rulebooks/${rulebookId}/reindex-stream`, {
    method: "POST",
    headers: apiAuthHeaders(),
  });
  if (!res.ok) {
    await throwIfNotOk(res, "Could not re-scan this rulebook");
  }
  if (!res.body) {
    throw new Error("Re-index failed — no response from server.");
  }

  const result = await readUploadStream(res.body, onProgress);
  if (result.type === "complete") {
    return result.data;
  }
  if (result.type === "error") {
    throw new Error(result.message);
  }
  throw new Error("Re-index failed.");
}

export type RulingFeedbackPayload = {
  response_id: string;
  helpful: boolean;
  mode: "ask" | "dispute";
  cached?: boolean;
  confidence?: "high" | "medium" | "low";
  question?: string;
  retrieved_pages?: number[];
};

export async function submitRulingFeedback(
  rulebookId: string,
  payload: RulingFeedbackPayload,
): Promise<void> {
  const res = await fetch(`${API}/api/rulebooks/${rulebookId}/feedback`, {
    method: "POST",
    headers: apiAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(parseErrorDetail(err.detail) ?? "Could not save feedback");
  }
}
