import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ConfidenceHint as ConfidenceHintInfo } from "./api";
import {
  AskResponse,
  ApiError,
  BggRulebookFile,
  Citation,
  HistoryMessage,
  Rulebook,
  SourceExcerpt,
  askRulebook,
  clearFaqCache,
  reindexRulebook,
  searchRulebook,
  formatSearchExcerpt,
  cleanSearchExcerpt,
  deleteRulebook,
  disputeRulebook,
  fetchExampleQuestions,
  buildRulebookHealthSummary,
  formatThinPagesLabel,
  CONTEXT_ENGINEERING_PDF_GUIDE_URL,
  formatUploadProgressMessage,
  formatFileSize,
  isDuplicateRulebookError,
  listRulebooks,
  lookupBggRulebooks,
  pinRulebook,
  submitRulingFeedback,
  fetchRulebookPagePreviewBlob,
  uploadProgressPercent,
  uploadRulebook,
  type UploadProgress,
  type RulebookHealthSummary,
  type SearchHit,
} from "./api";
import {
  IconBook,
  IconChevronLeft,
  IconClose,
  IconCopy,
  IconDice,
  IconLibrary,
  IconMenu,
  IconPin,
  IconScales,
  IconShare,
  IconThumbDown,
  IconThumbUp,
  IconUpload,
} from "./Icons";
import {
  appendExchange,
  clearHistory,
  getHistoryExchange,
  listRecentExchanges,
  loadAllHistory,
  loadAllThreads,
  setHistoryExchangePinned,
  removeHistoryExchange,
  removeRulebookStorage,
  saveHistory,
  saveThread,
  trimThread,
  type HistoryExchange,
  type RecentExchange,
  type StoredMessage,
} from "./conversationStorage";

type ChatMode = "ask" | "search" | "dispute";

type Message = StoredMessage;

type ClarificationContext = {
  originalQuestion: string;
  question: string;
};

type AppError = {
  message: string;
  code?: "rate_limit" | "bgg_manual_download";
  bggUrl?: string;
};

function toAppError(err: unknown): AppError {
  if (err instanceof ApiError && err.code === "rate_limit") {
    return { message: err.message, code: "rate_limit" };
  }
  return { message: err instanceof Error ? err.message : String(err) };
}

function buildHistory(messages: Message[]): HistoryMessage[] {
  return messages.map((msg) => {
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

const SIDEBAR_LIST_PREVIEW_LIMIT = 5;

function sortRulebooks(books: Rulebook[]): Rulebook[] {
  return [...books].sort((left, right) => {
    const leftPinned = left.pinned ? 1 : 0;
    const rightPinned = right.pinned ? 1 : 0;
    if (leftPinned !== rightPinned) {
      return rightPinned - leftPinned;
    }
    return right.created_at.localeCompare(left.created_at);
  });
}

function visibleRulebooks(
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

function visibleRecentExchanges(
  exchanges: RecentExchange[],
  showAll: boolean,
): RecentExchange[] {
  if (showAll || exchanges.length <= SIDEBAR_LIST_PREVIEW_LIMIT) {
    return exchanges;
  }
  return exchanges.slice(0, SIDEBAR_LIST_PREVIEW_LIMIT);
}

const SIDEBAR_COLLAPSED_KEY = "rules-referee:v1:sidebar-collapsed";
const DESKTOP_LAYOUT_QUERY = "(min-width: 801px)";

function loadSidebarCollapsed(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function saveSidebarCollapsed(collapsed: boolean): void {
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

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  return target.isContentEditable;
}

export default function App({
  fullAccess = true,
  demoMode = false,
}: {
  fullAccess?: boolean;
  demoMode?: boolean;
}) {
  const [rulebooks, setRulebooks] = useState<Rulebook[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [threads, setThreads] = useState<Record<string, Message[]>>(() => loadAllThreads());
  const [history, setHistory] = useState<Record<string, HistoryExchange[]>>(() => loadAllHistory());
  const [clarifications, setClarifications] = useState<Record<string, ClarificationContext | null>>({});
  const [examples, setExamples] = useState<Record<string, string[]>>({});
  const [question, setQuestion] = useState("");
  const [chatMode, setChatMode] = useState<ChatMode>("ask");
  const [disputeSituation, setDisputeSituation] = useState("");
  const [disputePlayerA, setDisputePlayerA] = useState("");
  const [disputePlayerB, setDisputePlayerB] = useState("");
  const [uploadName, setUploadName] = useState("");
  const [bggUrl, setBggUrl] = useState("");
  const [bggCandidates, setBggCandidates] = useState<BggRulebookFile[] | null>(null);
  const [bggLookupLoading, setBggLookupLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [ingestSource, setIngestSource] = useState<"upload" | "reindex">("upload");
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [uploadHealth, setUploadHealth] = useState<RulebookHealthSummary | null>(null);
  const [quickSearchQuery, setQuickSearchQuery] = useState("");
  const [quickSearchHits, setQuickSearchHits] = useState<SearchHit[] | null>(null);
  const [quickSearchLoading, setQuickSearchLoading] = useState(false);
  const [quickSearchSelected, setQuickSearchSelected] = useState<number | null>(null);
  const [showAllRulebooks, setShowAllRulebooks] = useState(false);
  const [showAllRecentExchanges, setShowAllRecentExchanges] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => loadSidebarCollapsed());
  const [overlayDismissTick, setOverlayDismissTick] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const quickSearchInputRef = useRef<HTMLInputElement>(null);
  const disputeSituationRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const activeRequestRulebookRef = useRef<string | null>(null);

  function selectRulebook(id: string) {
    if (loadingRef.current || id === selectedId) {
      if (id === selectedId) {
        setLibraryOpen(false);
      }
      return;
    }
    setSelectedId(id);
    setLibraryOpen(false);
    clearConversation(id);
  }

  const showLibraryPanel = useCallback(() => {
    setSidebarCollapsed(false);
    saveSidebarCollapsed(false);
  }, []);

  const hideLibraryPanel = useCallback(() => {
    setSidebarCollapsed(true);
    saveSidebarCollapsed(true);
    setLibraryOpen(false);
  }, []);

  const displayedRulebooks = visibleRulebooks(rulebooks, selectedId, showAllRulebooks);
  const hiddenRulebookCount = showAllRulebooks
    ? 0
    : Math.max(0, rulebooks.length - SIDEBAR_LIST_PREVIEW_LIMIT);

  const messages = selectedId ? threads[selectedId] ?? [] : [];
  const clarification = selectedId ? clarifications[selectedId] ?? null : null;
  const exampleQuestions = selectedId ? examples[selectedId] ?? [] : [];
  const recentExchanges = selectedId ? listRecentExchanges(history[selectedId] ?? []) : [];
  const displayedRecentExchanges = visibleRecentExchanges(recentExchanges, showAllRecentExchanges);
  const hiddenRecentCount = showAllRecentExchanges
    ? 0
    : Math.max(0, recentExchanges.length - SIDEBAR_LIST_PREVIEW_LIMIT);

  const updateThread = useCallback((rulebookId: string, updater: (prev: Message[]) => Message[]) => {
    setThreads((current) => {
      const nextMessages = trimThread(updater(current[rulebookId] ?? []));
      saveThread(rulebookId, nextMessages);
      return {
        ...current,
        [rulebookId]: nextMessages,
      };
    });
  }, []);

  const setClarificationFor = useCallback((rulebookId: string, value: ClarificationContext | null) => {
    setClarifications((current) => ({
      ...current,
      [rulebookId]: value,
    }));
  }, []);

  const persistThreadAndHistory = useCallback((rulebookId: string, threadWithRuling: Message[]) => {
    saveThread(rulebookId, threadWithRuling);
    appendExchange(rulebookId, threadWithRuling);
    setHistory((hist) => ({
      ...hist,
      [rulebookId]: loadAllHistory()[rulebookId] ?? [],
    }));
  }, []);

  const clearConversation = useCallback((rulebookId: string) => {
    updateThread(rulebookId, () => []);
    setClarificationFor(rulebookId, null);
    setQuestion("");
    setDisputeSituation("");
    setDisputePlayerA("");
    setDisputePlayerB("");
    setError(null);
  }, [updateThread, setClarificationFor]);

  const refresh = useCallback(async () => {
    const books = await listRulebooks();
    setRulebooks(books);
    return books;
  }, []);

  useEffect(() => {
    refresh()
      .then((books) => {
        setSelectedId((current) => current ?? books[0]?.id ?? null);
        const bookIds = new Set(books.map((book) => book.id));
        setThreads((current) => {
          const next: Record<string, Message[]> = {};
          for (const [rulebookId, thread] of Object.entries(current)) {
            if (bookIds.has(rulebookId)) {
              next[rulebookId] = thread;
            } else {
              removeRulebookStorage(rulebookId);
            }
          }
          return next;
        });
        setHistory((current) => {
          const next: Record<string, HistoryExchange[]> = {};
          for (const [rulebookId, entries] of Object.entries(current)) {
            if (bookIds.has(rulebookId)) {
              next[rulebookId] = entries;
            } else {
              saveHistory(rulebookId, []);
            }
          }
          return next;
        });
      })
      .catch((e) => setError(toAppError(e)));
  }, [refresh]);

  useEffect(() => {
    if (clarification) {
      inputRef.current?.focus();
    }
  }, [clarification]);

  useEffect(() => {
    setQuickSearchQuery("");
    setQuickSearchHits(null);
    setQuickSearchLoading(false);
    setQuickSearchSelected(null);
    setShowAllRecentExchanges(false);
  }, [selectedId]);

  useEffect(() => {
    if (overlayDismissTick > 0) {
      setQuickSearchSelected(null);
    }
  }, [overlayDismissTick]);

  useEffect(() => {
    if (!libraryOpen) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [libraryOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isEscape = event.key === "Escape" || event.code === "Escape";
      if (isEscape && !event.isComposing) {
        let handled = false;

        if (document.querySelector(".page-preview-lightbox")) {
          handled = true;
        } else if (document.querySelector(".source-panel")) {
          setOverlayDismissTick((tick) => tick + 1);
          handled = true;
        } else {
          const openDetails = document.querySelector("details[open]");
          if (openDetails instanceof HTMLDetailsElement) {
            openDetails.open = false;
            handled = true;
          } else if (libraryOpen) {
            setLibraryOpen(false);
            handled = true;
          } else if (selectedId && clarification) {
            setClarificationFor(selectedId, null);
            handled = true;
          } else if (error) {
            setError(null);
            handled = true;
          } else if (info) {
            setInfo(null);
            handled = true;
          } else if (
            !sidebarCollapsed
            && window.matchMedia(DESKTOP_LAYOUT_QUERY).matches
          ) {
            hideLibraryPanel();
            handled = true;
          }
        }

        if (handled) {
          event.preventDefault();
        }
        return;
      }

      if (event.defaultPrevented || event.isComposing) {
        return;
      }

      if (isEditableTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (event.key === "/" && selectedId) {
        event.preventDefault();
        if (chatMode === "search") {
          quickSearchInputRef.current?.focus();
        } else if (chatMode === "ask") {
          inputRef.current?.focus();
        } else {
          disputeSituationRef.current?.focus();
        }
        return;
      }

      if ((event.key === "n" || event.key === "N") && selectedId && !loading) {
        event.preventDefault();
        clearConversation(selectedId);
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    chatMode,
    clarification,
    clearConversation,
    error,
    hideLibraryPanel,
    info,
    libraryOpen,
    loading,
    selectedId,
    setClarificationFor,
    sidebarCollapsed,
  ]);

  useEffect(() => {
    if (chatMode === "search") {
      quickSearchInputRef.current?.focus();
    }
  }, [chatMode, selectedId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, loading, selectedId]);

  useEffect(() => {
    if (!info) {
      return;
    }
    const timer = window.setTimeout(() => setInfo(null), 8000);
    return () => window.clearTimeout(timer);
  }, [info]);

  useEffect(() => {
    if (!selectedId || examples[selectedId]) {
      return;
    }

    fetchExampleQuestions(selectedId)
      .then((questions) => {
        setExamples((current) => ({ ...current, [selectedId]: questions }));
      })
      .catch(() => {
        // Non-fatal: empty chat still works without suggestions.
      });
  }, [selectedId, examples]);

  const selected = rulebooks.find((b) => b.id === selectedId);

  function openHistoryExchange(rulebookId: string, exchangeId: string) {
    const entry = getHistoryExchange(rulebookId, exchangeId);
    if (!entry) {
      return;
    }
    setThreads((current) => {
      saveThread(rulebookId, entry.messages);
      return { ...current, [rulebookId]: entry.messages };
    });
    setClarificationFor(rulebookId, null);
  }

  function removeRecentExchange(rulebookId: string, exchangeId: string) {
    if (!removeHistoryExchange(rulebookId, exchangeId)) {
      return;
    }
    setHistory((current) => {
      const nextEntries = (current[rulebookId] ?? []).filter((entry) => entry.id !== exchangeId);
      if (nextEntries.length === 0) {
        const next = { ...current };
        delete next[rulebookId];
        return next;
      }
      return { ...current, [rulebookId]: nextEntries };
    });
  }

  function clearRecentExchanges(rulebookId: string, name: string) {
    if (
      !confirm(
        `Clear all recent rulings for "${name}"? This cannot be undone.`,
      )
    ) {
      return;
    }
    clearHistory(rulebookId);
    setHistory((current) => {
      const next = { ...current };
      delete next[rulebookId];
      return next;
    });
    setShowAllRecentExchanges(false);
  }

  function toggleRecentExchangePin(rulebookId: string, exchangeId: string, pinned: boolean) {
    if (!setHistoryExchangePinned(rulebookId, exchangeId, pinned)) {
      return;
    }
    setHistory((current) => ({
      ...current,
      [rulebookId]: (current[rulebookId] ?? []).map((entry) =>
        entry.id === exchangeId ? { ...entry, pinned } : entry,
      ),
    }));
  }

  function purgeRulebookState(id: string) {
    removeRulebookStorage(id);
    setThreads((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setHistory((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setClarifications((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setExamples((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  async function ingestUploadedRulebook(upload: Awaited<ReturnType<typeof uploadRulebook>>) {
    setSelectedId(upload.rulebook.id);
    setExamples((current) => ({
      ...current,
      [upload.rulebook.id]: upload.example_questions,
    }));
    clearConversation(upload.rulebook.id);
    await refresh();
    setUploadHealth(buildRulebookHealthSummary(upload.rulebook.name, upload.ingestion));
    setInfo(null);
    setBggCandidates(null);
    setBggUrl("");
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setIngestSource("upload");
    setUploadProgress({ phase: "starting", page: 0, total_pages: 0 });
    setError(null);
    setInfo(null);
    setUploadHealth(null);
    setBggCandidates(null);
    setBggUrl("");
    try {
      const upload = await uploadRulebook(file, uploadName || undefined, (progress) => {
        setUploadProgress(progress);
      });
      setUploadName("");
      await ingestUploadedRulebook(upload);
    } catch (err) {
      if (isDuplicateRulebookError(err)) {
        setUploadName("");
        setSelectedId(err.rulebook.id);
        setExamples((current) => ({
          ...current,
          [err.rulebook.id]: err.example_questions,
        }));
        await refresh();
        setInfo(
          `"${err.rulebook.name}" is already in your library — opened the existing copy. `
          + "Delete it first if you want to scan the PDF again.",
        );
      } else {
        setError(toAppError(err));
      }
    } finally {
      setUploading(false);
      setUploadProgress(null);
      e.target.value = "";
    }
  }

  async function handleBggLookup() {
    if (!bggUrl.trim()) {
      return;
    }
    setBggLookupLoading(true);
    setError(null);
    setInfo(null);
    try {
      const result = await lookupBggRulebooks(bggUrl.trim());
      setBggCandidates(result.files);
      setUploadName(result.game_name);
      if (result.files.length === 0) {
        setInfo(
          `No likely rulebook PDFs found for ${result.game_name} on BoardGameGeek. `
          + "Try uploading a PDF manually.",
        );
      }
    } catch (err) {
      setBggCandidates(null);
      setError(toAppError(err));
    } finally {
      setBggLookupLoading(false);
    }
  }

  async function submitQuestion(reply: string) {
    if (!selectedId || !reply.trim() || loadingRef.current) {
      return;
    }

    const requestRulebookId = selectedId;
    const trimmed = reply.trim();
    const priorMessages = threads[requestRulebookId] ?? [];
    const history = buildHistory(priorMessages);
    updateThread(requestRulebookId, (current) => [...current, { role: "user", text: trimmed }]);

    loadingRef.current = true;
    activeRequestRulebookRef.current = requestRulebookId;
    setLoading(true);
    setError(null);
    try {
      const answer = await askRulebook(requestRulebookId, trimmed, history);
      if (activeRequestRulebookRef.current !== requestRulebookId) {
        return;
      }
      if (answer.ruling.needs_clarification && answer.ruling.clarification_question) {
        setClarificationFor(requestRulebookId, {
          originalQuestion: clarification?.originalQuestion ?? trimmed,
          question: answer.ruling.clarification_question,
        });
      } else {
        setClarificationFor(requestRulebookId, null);
      }
      const threadWithRuling = trimThread([
        ...priorMessages,
        { role: "user", text: trimmed },
        { role: "referee", data: answer },
      ]);
      setThreads((current) => ({
        ...current,
        [requestRulebookId]: threadWithRuling,
      }));
      persistThreadAndHistory(requestRulebookId, threadWithRuling);
    } catch (err) {
      if (activeRequestRulebookRef.current === requestRulebookId) {
        updateThread(requestRulebookId, () => priorMessages);
        setError(toAppError(err));
      }
    } finally {
      if (activeRequestRulebookRef.current === requestRulebookId) {
        loadingRef.current = false;
        activeRequestRulebookRef.current = null;
        setLoading(false);
      }
    }
  }

  async function handleAsk(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !question.trim() || loadingRef.current) return;

    const reply = question.trim();
    setQuestion("");
    await submitQuestion(reply);
  }

  async function handleDispute(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || loadingRef.current) return;

    const requestRulebookId = selectedId;
    const situation = disputeSituation.trim();
    const playerA = disputePlayerA.trim();
    const playerB = disputePlayerB.trim();
    if (!situation || !playerA || !playerB) return;

    setDisputeSituation("");
    setDisputePlayerA("");
    setDisputePlayerB("");

    const priorMessages = threads[requestRulebookId] ?? [];
    const history = buildHistory(priorMessages);
    updateThread(requestRulebookId, (current) => [
      ...current,
      { role: "dispute", situation, playerA, playerB },
    ]);

    loadingRef.current = true;
    activeRequestRulebookRef.current = requestRulebookId;
    setLoading(true);
    setError(null);
    try {
      const answer = await disputeRulebook(requestRulebookId, situation, playerA, playerB, history);
      if (activeRequestRulebookRef.current !== requestRulebookId) {
        return;
      }
      if (answer.ruling.needs_clarification && answer.ruling.clarification_question) {
        setClarificationFor(requestRulebookId, {
          originalQuestion: situation,
          question: answer.ruling.clarification_question,
        });
      } else {
        setClarificationFor(requestRulebookId, null);
      }
      const threadWithRuling = trimThread([
        ...priorMessages,
        { role: "dispute", situation, playerA, playerB },
        { role: "referee", data: answer },
      ]);
      setThreads((current) => ({
        ...current,
        [requestRulebookId]: threadWithRuling,
      }));
      persistThreadAndHistory(requestRulebookId, threadWithRuling);
    } catch (err) {
      if (activeRequestRulebookRef.current === requestRulebookId) {
        updateThread(requestRulebookId, () => priorMessages);
        setError(toAppError(err));
      }
    } finally {
      if (activeRequestRulebookRef.current === requestRulebookId) {
        loadingRef.current = false;
        activeRequestRulebookRef.current = null;
        setLoading(false);
      }
    }
  }

  async function handleTogglePin(id: string, pinned: boolean) {
    setError(null);
    try {
      const updated = await pinRulebook(id, pinned);
      setRulebooks((current) => sortRulebooks(
        current.map((book) => (book.id === id ? updated : book)),
      ));
    } catch (err) {
      setError(toAppError(err));
    }
  }

  async function handleClearFaqCache(id: string, name: string) {
    if (
      !confirm(
        `Clear cached answers for "${name}"? Repeat questions will call the referee again.`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      const cleared = await clearFaqCache(id);
      setInfo(
        cleared > 0
          ? `Cleared ${cleared} cached answer(s) for "${name}".`
          : `No cached answers to clear for "${name}".`,
      );
    } catch (err) {
      setError(toAppError(err));
    }
  }

  async function handleQuickSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !quickSearchQuery.trim()) {
      return;
    }
    setQuickSearchLoading(true);
    setQuickSearchSelected(null);
    setError(null);
    try {
      const result = await searchRulebook(selectedId, quickSearchQuery.trim());
      setQuickSearchHits(result.hits);
    } catch (err) {
      setQuickSearchHits(null);
      setError(toAppError(err));
    } finally {
      setQuickSearchLoading(false);
    }
  }

  async function handleReindex(id: string, name: string) {
    if (
      !confirm(
        `Re-scan "${name}" from the stored PDF? This rebuilds the search index and clears cached answers.`,
      )
    ) {
      return;
    }
    setUploading(true);
    setIngestSource("reindex");
    setUploadProgress({ phase: "starting", page: 0, total_pages: 0 });
    setError(null);
    setInfo(null);
    setUploadHealth(null);
    try {
      const result = await reindexRulebook(id, (progress) => {
        setUploadProgress(progress);
      });
      setExamples((current) => ({
        ...current,
        [id]: result.example_questions,
      }));
      await refresh();
      setUploadHealth(buildRulebookHealthSummary(result.rulebook.name, result.ingestion));
      if ((result.faq_cache_cleared ?? 0) > 0) {
        setInfo(`Cleared ${result.faq_cache_cleared} cached answer(s) for this game.`);
      }
    } catch (err) {
      setError(toAppError(err));
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this rulebook?")) return;
    setLoading(true);
    setError(null);
    try {
      await deleteRulebook(id);
      purgeRulebookState(id);
      setRulebooks((current) => {
        const next = current.filter((book) => book.id !== id);
        setSelectedId((selected) => (selected === id ? (next[0]?.id ?? null) : selected));
        return next;
      });
    } catch (err) {
      setError(toAppError(err));
    } finally {
      setLoading(false);
    }
  }

  async function clearAllRulebooks() {
    if (rulebooks.length === 0) {
      return;
    }
    if (
      !confirm(
        `Delete all ${rulebooks.length} rulebook${rulebooks.length === 1 ? "" : "s"} from your library? This cannot be undone.`,
      )
    ) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      for (const book of rulebooks) {
        await deleteRulebook(book.id);
        purgeRulebookState(book.id);
      }
      setRulebooks([]);
      setSelectedId(null);
      setShowAllRulebooks(false);
    } catch (err) {
      setError(toAppError(err));
      await refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`app${selected ? " app-in-session" : ""}`}>
      <div className="table-rail table-rail-top" aria-hidden="true" />
      <header className="site-header panel">
        <div className="brand-mark" aria-hidden="true">
          <IconScales className="icon icon-lg" />
        </div>
        <div className="brand-copy">
          <p className="brand-eyebrow">Tableside rules engine</p>
          <h1>
            <span className="brand-title-main">Rules</span>
            <span className="brand-title-accent">Referee</span>
          </h1>
          <p>
            {demoMode && !fullAccess
              ? "Try the sample rulebook — ask questions and see cited rulings."
              : "Settle arguments with cited rulings — upload a rulebook and roll."}
          </p>
        </div>
        <div className="header-dice" aria-hidden="true">
          <IconDice className="icon icon-lg" />
        </div>
      </header>

      {demoMode && !fullAccess && (
        <div className="app-notice" role="status">
          <div className="notice-banner demo-banner">
            <div className="notice-banner-copy">
              <p className="notice-banner-title">Public demo</p>
              <p>
                Ask, search, and dispute on the sample game below. Uploads and
                library edits are disabled on this instance.
              </p>
            </div>
          </div>
        </div>
      )}

      {(error || info || uploadHealth || (uploading && uploadProgress)) && (
        <div className="app-notice" role="status">
          {uploading && uploadProgress && (
            <div className="notice-banner info ingest-progress-banner" aria-live="polite">
              <div className="notice-banner-copy">
                <p className="notice-banner-title">
                  {ingestSource === "reindex" ? "Re-scanning rulebook" : "Processing rulebook"}
                </p>
                <p>{formatUploadProgressMessage(uploadProgress, ingestSource)}</p>
                <div
                  className="upload-progress-track"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={uploadProgressPercent(uploadProgress)}
                >
                  <div
                    className="upload-progress-bar"
                    style={{ width: `${uploadProgressPercent(uploadProgress)}%` }}
                  />
                </div>
              </div>
            </div>
          )}
          {uploadHealth && (
            <RulebookHealthNotice
              health={uploadHealth}
              onDismiss={() => setUploadHealth(null)}
            />
          )}
          <AppNotice
            error={error}
            info={info}
            onDismissError={() => setError(null)}
            onDismissInfo={() => setInfo(null)}
          />
        </div>
      )}

      <div className={`layout${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
        {libraryOpen && (
          <button
            type="button"
            className="sidebar-backdrop"
            aria-label="Close library"
            onClick={() => setLibraryOpen(false)}
          />
        )}

        {sidebarCollapsed && (
          <button
            type="button"
            className="sidebar-expand-rail"
            aria-label="Show library panel"
            title="Show library panel"
            onClick={showLibraryPanel}
          >
            <IconLibrary className="icon" />
          </button>
        )}

        <aside className={`sidebar panel${libraryOpen ? " open" : ""}`}>
          <div className="sidebar-desktop-header">
            <h2>Library</h2>
            <button
              type="button"
              className="sidebar-collapse-btn"
              aria-label="Hide library panel"
              title="Hide library panel"
              onClick={hideLibraryPanel}
            >
              <IconChevronLeft className="icon icon-sm" />
            </button>
          </div>

          <div className="sidebar-mobile-header">
            <h2>Your library</h2>
            <button
              type="button"
              className="sidebar-close"
              aria-label="Close library"
              onClick={() => setLibraryOpen(false)}
            >
              <IconClose className="icon icon-sm" />
            </button>
          </div>

          {fullAccess && (
          <section className="panel-section">
            <h2 className="panel-title">
              <span className="panel-title-icon">
                <IconUpload className="icon" />
              </span>
              Add a game
            </h2>
            <label className="field-label" htmlFor="upload-name">
              Game name
            </label>
            <input
              id="upload-name"
              type="text"
              placeholder="Optional — we'll detect it from the PDF"
              value={uploadName}
              onChange={(e) => setUploadName(e.target.value)}
              disabled={uploading}
            />
            <label className={`upload-btn${uploading ? " upload-btn-busy" : ""}`}>
              <IconUpload className="icon icon-sm" />
              {uploading ? "Processing…" : "Choose rulebook PDF"}
              <input type="file" accept=".pdf" onChange={handleUpload} hidden disabled={uploading} />
            </label>

            <div className="bgg-import">
              <label className="field-label" htmlFor="bgg-url">
                Or find rulebooks on BoardGameGeek
              </label>
              <div className="bgg-import-row">
                <input
                  id="bgg-url"
                  type="url"
                  placeholder="boardgamegeek.com/boardgame/…"
                  value={bggUrl}
                  onChange={(e) => setBggUrl(e.target.value)}
                  disabled={uploading || bggLookupLoading}
                />
                <button
                  type="button"
                  className="bgg-lookup-btn"
                  disabled={uploading || bggLookupLoading || !bggUrl.trim()}
                  onClick={() => {
                    void handleBggLookup();
                  }}
                >
                  {bggLookupLoading ? "Finding…" : "Find"}
                </button>
              </div>
              {bggCandidates && bggCandidates.length > 0 && (
                <>
                  <p className="bgg-import-hint">
                    BoardGameGeek blocks automatic downloads. Open a file, save the PDF in your
                    browser, then upload it with Choose rulebook PDF above.
                  </p>
                  <ul className="bgg-file-list">
                    {bggCandidates.map((file) => (
                      <li key={file.file_id}>
                        <a
                          className="bgg-file-btn"
                          href={file.bgg_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <span className="bgg-file-title">{file.title}</span>
                          <span className="bgg-file-meta">
                            {file.filename} · {formatFileSize(file.size)}
                            {file.votes > 0 ? ` · ${file.votes} thumbs` : ""}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            {uploading && uploadProgress && (
              <div className="upload-progress" role="status" aria-live="polite">
                <p className="upload-progress-label">
                  {formatUploadProgressMessage(uploadProgress, ingestSource)}
                </p>
                <div
                  className="upload-progress-track"
                  aria-hidden="true"
                >
                  <div
                    className="upload-progress-bar"
                    style={{ width: `${uploadProgressPercent(uploadProgress)}%` }}
                  />
                </div>
              </div>
            )}
          </section>
          )}

          <section className="panel-section">
            <h2 className="panel-title">
              <span className="panel-title-icon">
                <IconLibrary className="icon" />
              </span>
              {demoMode && !fullAccess ? "Demo library" : "Your library"}
            </h2>
            {rulebooks.length === 0 && (
              <p className="muted">
                {demoMode && !fullAccess
                  ? "Loading sample rulebook…"
                  : "No rulebooks yet — add one to start."}
              </p>
            )}
            <ul className="book-list">
              {displayedRulebooks.map((book) => (
                <li key={book.id} className={book.id === selectedId ? "active" : ""}>
                  <button type="button" onClick={() => selectRulebook(book.id)} disabled={loading}>
                    <span className="book-icon">
                      <IconBook className="icon icon-sm" />
                    </span>
                    <span className="book-details">
                      <strong>
                        {book.pinned && (
                          <IconPin className="icon book-pin-marker" />
                        )}
                        {book.name}
                      </strong>
                      <span className="book-pages">{book.page_count} pages</span>
                    </span>
                  </button>
                  {fullAccess && (
                  <button
                    type="button"
                    className={`pin${book.pinned ? " pinned" : ""}`}
                    aria-label={book.pinned ? `Unpin ${book.name}` : `Pin ${book.name}`}
                    title={book.pinned ? "Unpin" : "Pin to top"}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleTogglePin(book.id, !book.pinned);
                    }}
                  >
                    <IconPin className="icon icon-sm" />
                  </button>
                  )}
                  {fullAccess && (
                  <button
                    type="button"
                    className="delete"
                    aria-label={`Delete ${book.name}`}
                    title="Delete rulebook"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDelete(book.id);
                    }}
                  >
                    ×
                  </button>
                  )}
                </li>
              ))}
            </ul>
            {hiddenRulebookCount > 0 && (
              <button
                type="button"
                className="book-list-toggle"
                onClick={() => setShowAllRulebooks(true)}
              >
                See {hiddenRulebookCount} more
              </button>
            )}
            {showAllRulebooks && rulebooks.length > SIDEBAR_LIST_PREVIEW_LIMIT && (
              <button
                type="button"
                className="book-list-toggle"
                onClick={() => setShowAllRulebooks(false)}
              >
                Show less
              </button>
            )}
            {fullAccess && rulebooks.length > 0 && (
              <button
                type="button"
                className="book-list-toggle"
                onClick={() => void clearAllRulebooks()}
                disabled={loading}
              >
                Clear all
              </button>
            )}
          </section>

          {selected && recentExchanges.length > 0 && (
            <section className="panel-section">
              <h2 className="panel-title">
                <span className="panel-title-icon">
                  <IconScales className="icon" />
                </span>
                Recent rulings
              </h2>
              <ul className="book-list">
                {displayedRecentExchanges.map((exchange) => (
                  <li key={`${selected.id}-${exchange.id}`}>
                    <button
                      type="button"
                      onClick={() => openHistoryExchange(selected.id, exchange.id)}
                    >
                      <span className="book-icon">
                        <IconScales className="icon icon-sm" />
                      </span>
                      <span className="book-details">
                        <strong>
                          {exchange.pinned && (
                            <IconPin className="icon book-pin-marker" />
                          )}
                          {exchange.label}
                        </strong>
                        <span className="book-pages">
                          {exchange.mode === "dispute" ? "Dispute" : "Ask"}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className={`pin${exchange.pinned ? " pinned" : ""}`}
                      aria-label={exchange.pinned ? `Unpin ruling: ${exchange.label}` : `Pin ruling: ${exchange.label}`}
                      title={exchange.pinned ? "Unpin" : "Pin to top"}
                      onClick={() => toggleRecentExchangePin(selected.id, exchange.id, !exchange.pinned)}
                    >
                      <IconPin className="icon icon-sm" />
                    </button>
                    <button
                      type="button"
                      className="delete"
                      aria-label={`Remove ruling: ${exchange.label}`}
                      title="Remove ruling"
                      onClick={() => removeRecentExchange(selected.id, exchange.id)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              {hiddenRecentCount > 0 && (
                <button
                  type="button"
                  className="book-list-toggle"
                  onClick={() => setShowAllRecentExchanges(true)}
                >
                  See {hiddenRecentCount} more
                </button>
              )}
              {showAllRecentExchanges && recentExchanges.length > SIDEBAR_LIST_PREVIEW_LIMIT && (
                <button
                  type="button"
                  className="book-list-toggle"
                  onClick={() => setShowAllRecentExchanges(false)}
                >
                  Show less
                </button>
              )}
              <button
                type="button"
                className="book-list-toggle"
                onClick={() => clearRecentExchanges(selected.id, selected.name)}
              >
                Clear all
              </button>
            </section>
          )}
        </aside>

        <main className="chat panel">
          {!selected ? (
            <div className="empty-state">
              <div className="empty-dice" aria-hidden="true">
                <IconDice className="icon icon-empty-dice" />
              </div>
              <h3>The table awaits</h3>
              <p className="muted">Drop a rulebook PDF into your library — then roll for rulings on timing, edge cases, and disputes.</p>
              <button
                type="button"
                className="open-library-btn"
                onClick={() => {
                  showLibraryPanel();
                  setLibraryOpen(true);
                }}
              >
                <IconLibrary className="icon icon-sm" />
                Open library
              </button>
            </div>
          ) : (
            <>
              <div className="mobile-game-bar">
                <button
                  type="button"
                  className="library-toggle"
                  aria-expanded={libraryOpen}
                  onClick={() => setLibraryOpen(true)}
                >
                  <IconMenu className="icon icon-sm" />
                  Games
                </button>
                <div className="mobile-game-meta">
                  <span className="mobile-app-brand">Rules Referee</span>
                  <span className="mobile-game-name">{selected.name}</span>
                </div>
              </div>

              <div className="chat-header">
                <div className="chat-header-row">
                  <div className="chat-header-title">
                    <span className="chat-app-brand">Rules Referee</span>
                    <h2>{selected.name}</h2>
                    <span className="chat-subtitle">
                      {chatMode === "ask"
                        ? "Ask about timing, edge cases, disputes…"
                        : chatMode === "search"
                          ? "Search indexed passages — no LLM call"
                          : "Two players disagree — let the referee decide"}
                    </span>
                  </div>
                  <div className="chat-header-actions">
                    <div className="mode-toggle" role="tablist" aria-label="Chat mode">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={chatMode === "ask"}
                        className={chatMode === "ask" ? "active" : ""}
                        onClick={() => setChatMode("ask")}
                      >
                        Ask
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={chatMode === "search"}
                        className={chatMode === "search" ? "active" : ""}
                        onClick={() => setChatMode("search")}
                      >
                        Search
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={chatMode === "dispute"}
                        className={chatMode === "dispute" ? "active" : ""}
                        onClick={() => setChatMode("dispute")}
                      >
                        Dispute
                      </button>
                    </div>
                    <div className="chat-header-tools">
                      <button
                        type="button"
                        className="new-conversation"
                        onClick={() => clearConversation(selected.id)}
                      >
                        New conversation
                      </button>
                      {fullAccess && (
                      <button
                        type="button"
                        className="reindex-rulebook"
                        disabled={uploading || loading}
                        onClick={() => {
                          void handleReindex(selected.id, selected.name);
                        }}
                      >
                        {uploading && ingestSource === "reindex" ? "Scanning…" : "Scan again"}
                      </button>
                      )}
                      {fullAccess && (
                      <button
                        type="button"
                        className="clear-faq-cache"
                        disabled={uploading || loading}
                        onClick={() => {
                          void handleClearFaqCache(selected.id, selected.name);
                        }}
                      >
                        Clear FAQ cache
                      </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className={`messages${chatMode === "search" ? " search-mode" : ""}`} aria-busy={loading || uploading} aria-live="polite">
                {chatMode === "search" ? (
                  <QuickSearchPanel
                    query={quickSearchQuery}
                    hits={quickSearchHits}
                    loading={quickSearchLoading}
                    selectedIndex={quickSearchSelected}
                    disabled={loading || uploading}
                    inputRef={quickSearchInputRef}
                    standalone
                    onQueryChange={setQuickSearchQuery}
                    onSubmit={(event) => {
                      void handleQuickSearch(event);
                    }}
                    onSelectHit={setQuickSearchSelected}
                    rulebookId={selected.id}
                  />
                ) : (
                  <>
                {messages.length === 0 && exampleQuestions.length > 0 && chatMode === "ask" && (
                  <div className="example-questions">
                    <p className="example-questions-label">Try asking</p>
                    <p className="example-questions-hint">Tap a question to ask the referee.</p>
                    <div className="example-questions-list">
                      {exampleQuestions.map((example) => (
                        <button
                          key={example}
                          type="button"
                          className="example-question"
                          disabled={loading}
                          onClick={() => {
                            void submitQuestion(example);
                          }}
                        >
                          {example}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {messages.length === 0 && exampleQuestions.length === 0 && chatMode === "ask" && (
                  <div className="hint">
                    Try: &ldquo;Can I play this card during another player&apos;s turn?&rdquo;
                    Follow up with: &ldquo;What about on the first turn?&rdquo;
                  </div>
                )}
                {messages.map((msg, i) =>
                  msg.role === "user" ? (
                    <div key={i} id={`message-${i}`} className="message-wrap user">
                      <span className="message-label">You</span>
                      <div className="bubble user">{msg.text}</div>
                    </div>
                  ) : msg.role === "dispute" ? (
                    <div key={i} id={`message-${i}`} className="message-wrap dispute">
                      <span className="message-label">Dispute</span>
                      <div className="bubble dispute">
                        <p className="dispute-field">
                          <strong>Situation</strong>
                          {msg.situation}
                        </p>
                        <p className="dispute-field">
                          <strong>Player A</strong>
                          {msg.playerA}
                        </p>
                        <p className="dispute-field">
                          <strong>Player B</strong>
                          {msg.playerB}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div key={i} id={`message-${i}`} className="message-wrap referee">
                      <span className="message-label">Referee</span>
                      <RefereeAnswer
                        rulebookId={selected.id}
                        data={msg.data}
                        overlayDismissTick={overlayDismissTick}
                      />
                    </div>
                  )
                )}
                {loading && (
                  <div className="message-wrap referee loading-message" aria-live="polite">
                    <span className="message-label">Referee</span>
                    <div className="bubble referee loading-bubble">
                      <span className="loading-dots" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                      </span>
                      {chatMode === "dispute" ? "Weighing both sides…" : "Reading the rulebook…"}
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} className="messages-anchor" aria-hidden="true" />
                  </>
                )}
              </div>

              {chatMode !== "search" && (
              <div className="chat-composer">
                {clarification && (
                  <div className="clarification-prompt" role="status">
                    <p className="clarification-prompt-label">Referee needs one detail</p>
                    <p className="clarification-prompt-question">{clarification.question}</p>
                    <button
                      type="button"
                      className="clarification-dismiss"
                      onClick={() => setClarificationFor(selected.id, null)}
                    >
                      Ask something else instead
                    </button>
                  </div>
                )}

                {chatMode === "ask" ? (
                  <form className="ask-form" onSubmit={handleAsk}>
                    <input
                      ref={inputRef}
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      placeholder={
                        clarification
                          ? "Your answer…"
                          : messages.length > 0
                            ? "Ask a follow-up…"
                            : "Ask a rules question…"
                      }
                      disabled={loading}
                    />
                    <button type="submit" disabled={loading || uploading || !question.trim()}>
                      {loading ? "Thinking…" : clarification ? "Send detail" : "Ask"}
                    </button>
                  </form>
                ) : (
                  <form className="dispute-form" onSubmit={handleDispute}>
                    <label className="field-label" htmlFor="dispute-situation">
                      What&apos;s in dispute?
                    </label>
                    <textarea
                      id="dispute-situation"
                      ref={disputeSituationRef}
                      value={disputeSituation}
                      onChange={(e) => setDisputeSituation(e.target.value)}
                      placeholder="e.g. Can I play this card after combat ends?"
                      rows={2}
                      disabled={loading}
                    />
                    <div className="dispute-players">
                      <div>
                        <label className="field-label" htmlFor="dispute-player-a">
                          Player A says
                        </label>
                        <textarea
                          id="dispute-player-a"
                          value={disputePlayerA}
                          onChange={(e) => setDisputePlayerA(e.target.value)}
                          placeholder="Their interpretation…"
                          rows={2}
                          disabled={loading}
                        />
                      </div>
                      <div>
                        <label className="field-label" htmlFor="dispute-player-b">
                          Player B says
                        </label>
                        <textarea
                          id="dispute-player-b"
                          value={disputePlayerB}
                          onChange={(e) => setDisputePlayerB(e.target.value)}
                          placeholder="Their interpretation…"
                          rows={2}
                          disabled={loading}
                        />
                      </div>
                    </div>
                    <button
                      type="submit"
                      className="dispute-submit"
                      disabled={
                        loading
                        || !disputeSituation.trim()
                        || !disputePlayerA.trim()
                        || !disputePlayerB.trim()
                      }
                    >
                      {loading ? "Weighing arguments…" : "Settle dispute"}
                    </button>
                  </form>
                )}
              </div>
              )}
            </>
          )}
        </main>
      </div>
      <div className="table-rail table-rail-bottom" aria-hidden="true" />
    </div>
  );
}

function RefereeAnswer({
  rulebookId,
  data,
  overlayDismissTick,
}: {
  rulebookId: string;
  data: AskResponse;
  overlayDismissTick: number;
}) {
  const { ruling, citation_check } = data;
  const needsInput = ruling.needs_clarification && ruling.clarification_question;
  const isDispute = data.mode === "dispute";
  const confidenceHint = data.confidence_hint;

  return (
    <div className={`bubble referee${needsInput ? " needs-clarification" : ""}`}>
      <div className="ruling-labels">
        {needsInput ? (
          <span className="badge clarify">Needs your input</span>
        ) : (
          <>
            {data.cached && <span className="badge cache">From cache</span>}
            {isDispute && ruling.favors && (
              <span className={`badge favors favors-${ruling.favors}`}>
                {favorsLabel(ruling.favors)}
              </span>
            )}
            <span className={`badge ${ruling.confidence}`}>{ruling.confidence} confidence</span>
            {!citation_check.all_valid && !confidenceHint && (
              <span className="badge warn">citations need review</span>
            )}
          </>
        )}
      </div>
      {needsInput ? (
        <div className="clarification-callout">
          <p className="clarification-question">{ruling.clarification_question}</p>
          <p className="clarification-hint">Reply below with the missing detail to get a final ruling.</p>
        </div>
      ) : null}

      {!needsInput && confidenceHint && (
        <ConfidenceHint hint={confidenceHint} />
      )}

      <p className={`ruling${needsInput ? " tentative" : ""}`}>{ruling.ruling}</p>
      <p className="reasoning">{ruling.reasoning}</p>

      {isDispute && (ruling.player_a_assessment || ruling.player_b_assessment) && (
        <div className="dispute-assessments">
          {ruling.player_a_assessment && (
            <div className="assessment">
              <h4>Player A</h4>
              <p>{ruling.player_a_assessment}</p>
            </div>
          )}
          {ruling.player_b_assessment && (
            <div className="assessment">
              <h4>Player B</h4>
              <p>{ruling.player_b_assessment}</p>
            </div>
          )}
        </div>
      )}

      {ruling.citations.length > 0 && (
        <CitationsList
          key={`${rulebookId}-${overlayDismissTick}`}
          rulebookId={rulebookId}
          data={data}
        />
      )}

      {!needsInput && (
        <div className="ruling-actions">
          <CopyShareRuling data={data} />
          <RulingFeedback rulebookId={rulebookId} data={data} />
        </div>
      )}

      <details>
        <summary>
          Agent trace ({data.retrieval.chunks_found} passages from pages {data.retrieval.pages.join(", ")})
        </summary>
        <pre>{JSON.stringify(data, null, 2)}</pre>
      </details>
    </div>
  );
}

function QuickSearchPanel({
  rulebookId,
  query,
  hits,
  loading,
  selectedIndex,
  disabled,
  inputRef,
  standalone = false,
  onQueryChange,
  onSubmit,
  onSelectHit,
}: {
  rulebookId: string;
  query: string;
  hits: SearchHit[] | null;
  loading: boolean;
  selectedIndex: number | null;
  disabled: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  standalone?: boolean;
  onQueryChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  onSelectHit: (index: number | null) => void;
}) {
  const selected = selectedIndex !== null ? hits?.[selectedIndex] ?? null : null;

  return (
    <section
      className={`quick-search${standalone ? " quick-search-standalone" : ""}`}
      aria-label="Quick search"
    >
      <div className="quick-search-header">
        <p className="quick-search-title">Search this rulebook</p>
        <p className="quick-search-hint">
          Find indexed passages before asking the referee — no LLM call.
        </p>
      </div>
      <form className="quick-search-form" onSubmit={onSubmit}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="e.g. setup, first turn, tie breaker"
          disabled={disabled || loading}
          minLength={2}
        />
        <button type="submit" disabled={disabled || loading || query.trim().length < 2}>
          {loading ? "Searching…" : "Search"}
        </button>
      </form>
      {hits && (
        <div className="quick-search-results" role="status">
          {hits.length === 0 ? (
            <p className="quick-search-empty">No passages matched those terms.</p>
          ) : (
            <ul className="quick-search-list">
              {hits.map((hit, index) => {
                const isSelected = selectedIndex === index;
                return (
                  <li key={`${hit.page}-${index}`}>
                    <button
                      type="button"
                      className={`quick-search-hit${isSelected ? " selected" : ""}`}
                      aria-expanded={isSelected}
                      onClick={() => onSelectHit(isSelected ? null : index)}
                    >
                      <span className="quick-search-hit-label">
                        Page {hit.page}
                        {hit.section ? ` · ${hit.section}` : ""}
                      </span>
                      <span className="quick-search-hit-excerpt">
                        {formatSearchExcerpt(hit.text)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      {selected && (
        <QuickSearchHitPanel
          rulebookId={rulebookId}
          hit={selected}
          onClose={() => onSelectHit(null)}
        />
      )}
    </section>
  );
}

function RulebookPagePreview({
  rulebookId,
  page,
}: {
  rulebookId: string;
  page: number;
}) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [largeUrl, setLargeUrl] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const closeLightbox = useCallback((event?: { stopPropagation?: () => void }) => {
    event?.stopPropagation?.();
    setExpanded(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const objectUrls: string[] = [];

    async function loadPreviews() {
      try {
        const [thumb, large] = await Promise.all([
          fetchRulebookPagePreviewBlob(rulebookId, page, { zoom: 2 }),
          fetchRulebookPagePreviewBlob(rulebookId, page, { zoom: 3.5 }),
        ]);
        if (cancelled) {
          URL.revokeObjectURL(thumb);
          URL.revokeObjectURL(large);
          return;
        }
        objectUrls.push(thumb, large);
        setThumbUrl(thumb);
        setLargeUrl(large);
      } catch {
        if (!cancelled) {
          setPreviewFailed(true);
        }
      }
    }

    void loadPreviews();
    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [rulebookId, page]);

  useEffect(() => {
    if (!expanded) {
      return;
    }
    document.documentElement.classList.add("page-preview-lightbox-open");
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.key === "Escape" || event.code === "Escape") && !event.isComposing) {
        event.stopImmediatePropagation();
        setExpanded(false);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.documentElement.classList.remove("page-preview-lightbox-open");
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [expanded]);

  if (previewFailed) {
    return (
      <figure className="source-panel-preview source-panel-preview-unavailable">
        <p className="source-panel-missing">Page preview unavailable for this passage.</p>
      </figure>
    );
  }

  if (!thumbUrl || !largeUrl) {
    return (
      <figure className="source-panel-preview source-panel-preview-unavailable">
        <p className="source-panel-missing">Loading page preview…</p>
      </figure>
    );
  }

  const lightbox = expanded ? (
    <div
      className="page-preview-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`Rulebook page ${page}`}
    >
      <button
        type="button"
        className="page-preview-lightbox-backdrop"
        onClick={(event) => closeLightbox(event)}
        aria-label="Close enlarged page"
      />
      <div
        className="page-preview-lightbox-frame"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="page-preview-lightbox-close"
          onClick={(event) => closeLightbox(event)}
        >
          Close
        </button>
        <img src={largeUrl} alt={`Rulebook page ${page} (enlarged)`} />
      </div>
    </div>
  ) : null;

  return (
    <>
      <figure className="source-panel-preview">
        <button
          type="button"
          className="source-panel-preview-trigger"
          onClick={() => setExpanded(true)}
          aria-label={`Enlarge rulebook page ${page}`}
        >
          <img
            src={thumbUrl}
            alt={`Rulebook page ${page}`}
            loading="lazy"
          />
          <span className="source-panel-preview-hint" aria-hidden="true">
            Tap to enlarge
          </span>
        </button>
      </figure>
      {lightbox && typeof document !== "undefined"
        ? createPortal(lightbox, document.body)
        : null}
    </>
  );
}

function QuickSearchHitPanel({
  rulebookId,
  hit,
  onClose,
}: {
  rulebookId: string;
  hit: SearchHit;
  onClose: () => void;
}) {
  return (
    <div className="source-panel" role="region" aria-label="Search result excerpt">
      <div className="source-panel-header">
        <div>
          <p className="source-panel-title">Rulebook passage</p>
          <p className="source-panel-meta">
            Page {hit.page}
            {hit.section ? ` · ${hit.section}` : ""}
          </p>
        </div>
        <button type="button" className="source-panel-close" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="source-panel-content">
        <RulebookPagePreview rulebookId={rulebookId} page={hit.page} />
        <blockquote className="source-panel-excerpt">{cleanSearchExcerpt(hit.text)}</blockquote>
      </div>
    </div>
  );
}

function RulebookHealthNotice({
  health,
  onDismiss,
}: {
  health: RulebookHealthSummary;
  onDismiss: () => void;
}) {
  const needsHelp = health.thinPages.length > 0 || !!health.ocrWarning;
  const thinLabel = formatThinPagesLabel(health.thinPages);
  const ocrLabel = health.ocrPages === 1
    ? "1 page scanned (OCR)"
    : `${health.ocrPages} pages scanned (OCR)`;

  return (
    <div
      className={`notice-banner ${needsHelp ? "health-warn" : "health-ok"}`}
      role="status"
    >
      <div className="notice-banner-copy">
        <p className="notice-banner-title">{health.name} indexed</p>
        <ul className="rulebook-health-list">
          <li>
            {health.pagesIndexed} of {health.totalPages} pages indexed · {health.chunksIndexed} passages
          </li>
          {health.ocrPages > 0 && <li>{ocrLabel}</li>}
          {health.thinPages.length > 0 && (
            <li>
              {health.thinPages.length} thin page{health.thinPages.length === 1 ? "" : "s"}
              {thinLabel ? ` (${thinLabel})` : ""} — may answer poorly there
            </li>
          )}
        </ul>
        {health.ocrWarning && <p className="notice-banner-hint">{health.ocrWarning}</p>}
        {needsHelp && (
          <p className="notice-banner-hint">
            <a href={CONTEXT_ENGINEERING_PDF_GUIDE_URL} target="_blank" rel="noreferrer">
              Troubleshooting graphical PDFs
            </a>
          </p>
        )}
      </div>
      <button type="button" className="notice-dismiss" onClick={onDismiss} aria-label="Dismiss message">
        <IconClose className="icon icon-sm" />
      </button>
    </div>
  );
}

function AppNotice({
  error,
  info,
  onDismissError,
  onDismissInfo,
}: {
  error: AppError | null;
  info: string | null;
  onDismissError: () => void;
  onDismissInfo: () => void;
}) {
  return (
    <>
      {info && (
        <div className="notice-banner info">
          <p>{info}</p>
          <button type="button" className="notice-dismiss" onClick={onDismissInfo} aria-label="Dismiss message">
            <IconClose className="icon icon-sm" />
          </button>
        </div>
      )}
      {error?.code === "rate_limit" && (
        <div className="notice-banner rate-limit" role="alert">
          <div className="notice-banner-copy">
            <p className="notice-banner-title">Referee needs a breather</p>
            <p>{error.message}</p>
            <p className="notice-banner-hint">
              If you asked this before, try the same wording again — cached answers skip the API.
              Otherwise wait a minute and ask again.
            </p>
          </div>
          <button type="button" className="notice-dismiss" onClick={onDismissError} aria-label="Dismiss message">
            <IconClose className="icon icon-sm" />
          </button>
        </div>
      )}
      {error?.code === "bgg_manual_download" && (
        <div className="notice-banner info" role="alert">
          <div className="notice-banner-copy">
            <p className="notice-banner-title">Download the PDF on BoardGameGeek</p>
            <p>{error.message}</p>
            {error.bggUrl && (
              <p className="notice-banner-hint">
                <a href={error.bggUrl} target="_blank" rel="noreferrer">
                  Open file on BoardGameGeek
                </a>
                {" · "}
                Then use Choose rulebook PDF above.
              </p>
            )}
          </div>
          <button type="button" className="notice-dismiss" onClick={onDismissError} aria-label="Dismiss message">
            <IconClose className="icon icon-sm" />
          </button>
        </div>
      )}
      {error && error.code !== "rate_limit" && error.code !== "bgg_manual_download" && (
        <div className="notice-banner error" role="alert">
          <p>{error.message}</p>
          <button type="button" className="notice-dismiss" onClick={onDismissError} aria-label="Dismiss error">
            <IconClose className="icon icon-sm" />
          </button>
        </div>
      )}
    </>
  );
}

function ConfidenceHint({ hint }: { hint: ConfidenceHintInfo }) {
  const title = hint.level === "low" ? "Low confidence" : "Check this ruling";

  return (
    <div
      className={`confidence-hint confidence-hint-${hint.level}`}
      role="status"
      aria-label={title}
    >
      <p className="confidence-hint-title">{title}</p>
      <ul className="confidence-hint-list">
        {hint.messages.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    </div>
  );
}

function CopyShareRuling({ data }: { data: AskResponse }) {
  const [status, setStatus] = useState<"idle" | "copied" | "shared">("idle");
  const shareText = formatRulingShareText(data);
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function copyRuling() {
    try {
      await navigator.clipboard.writeText(shareText);
      setStatus("copied");
      window.setTimeout(() => setStatus("idle"), 2000);
    } catch {
      // Clipboard may be blocked without a secure context or permission.
    }
  }

  async function shareRuling() {
    if (!canNativeShare) {
      return;
    }
    try {
      await navigator.share({
        title: `Rules Referee — ${data.rulebook_name}`,
        text: shareText,
      });
      setStatus("shared");
      window.setTimeout(() => setStatus("idle"), 2000);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      await copyRuling();
    }
  }

  return (
    <div className="ruling-share">
      <button
        type="button"
        className="ruling-share-btn"
        onClick={() => void copyRuling()}
      >
        <IconCopy className="icon icon-sm" />
        {status === "copied" ? "Copied!" : "Copy ruling"}
      </button>
      {canNativeShare && (
        <button
          type="button"
          className="ruling-share-btn"
          onClick={() => void shareRuling()}
        >
          <IconShare className="icon icon-sm" />
          {status === "shared" ? "Shared!" : "Share"}
        </button>
      )}
    </div>
  );
}

function RulingFeedback({ rulebookId, data }: { rulebookId: string; data: AskResponse }) {
  const [submitted, setSubmitted] = useState<"up" | "down" | null>(null);
  const [pending, setPending] = useState(false);

  if (!data.response_id) {
    return null;
  }

  async function submit(helpful: boolean) {
    if (submitted || pending) {
      return;
    }
    setPending(true);
    try {
      await submitRulingFeedback(rulebookId, {
        response_id: data.response_id!,
        helpful,
        mode: data.mode,
        cached: data.cached,
        confidence: data.ruling.confidence,
        question: data.question ?? data.situation,
        retrieved_pages: data.retrieval.pages,
      });
      setSubmitted(helpful ? "up" : "down");
    } catch {
      // Non-fatal: ruling still stands if feedback fails to save.
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="ruling-feedback" aria-live="polite">
      {submitted ? (
        <p className="ruling-feedback-thanks">Thanks for your feedback.</p>
      ) : (
        <>
          <span className="ruling-feedback-label">Was this helpful?</span>
          <div className="ruling-feedback-actions">
            <button
              type="button"
              className="ruling-feedback-btn"
              aria-label="Yes, this ruling was helpful"
              title="Helpful"
              disabled={pending}
              onClick={() => void submit(true)}
            >
              <IconThumbUp className="icon icon-sm" />
            </button>
            <button
              type="button"
              className="ruling-feedback-btn"
              aria-label="No, this ruling was not helpful"
              title="Not helpful"
              disabled={pending}
              onClick={() => void submit(false)}
            >
              <IconThumbDown className="icon icon-sm" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function CitationsList({
  rulebookId,
  data,
}: {
  rulebookId: string;
  data: AskResponse;
}) {
  const { ruling, citation_check } = data;
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const selected = selectedIndex !== null ? citation_check.citations[selectedIndex] : null;
  const selectedRuling = selectedIndex !== null ? ruling.citations[selectedIndex] : null;

  const list = (
    <>
      <p className="citations-hint">
        Tap a citation to view the PDF page and excerpt.
      </p>
      <ul className="citation-list">
        {ruling.citations.map((citation, index) => {
          const checked = citation_check.citations[index];
          const invalid = checked?.valid === false;
          const isSelected = selectedIndex === index;
          return (
            <li key={index}>
              <button
                type="button"
                className={`citation-link${invalid ? " invalid" : ""}${isSelected ? " selected" : ""}`}
                aria-expanded={isSelected}
                onClick={() => setSelectedIndex(isSelected ? null : index)}
              >
                <span className="citation-link-label">
                  Page {citation.page}
                  {citation.section ? ` · ${citation.section}` : ""}
                </span>
                <span className="citation-link-quote">&ldquo;{citation.quote}&rdquo;</span>
              </button>
            </li>
          );
        })}
      </ul>
      {selected && selectedRuling && (
        <SourcePanel
          key={`${rulebookId}-${selected.page}-${selectedIndex}`}
          rulebookId={rulebookId}
          citation={selected}
          quote={selectedRuling.quote}
          sources={data.retrieval.sources ?? []}
          onClose={() => setSelectedIndex(null)}
        />
      )}
    </>
  );

  return (
    <div className="citations">
      <h4>Citations</h4>
      {list}
    </div>
  );
}

function SourcePanel({
  rulebookId,
  citation,
  quote,
  sources,
  onClose,
}: {
  rulebookId: string;
  citation: Citation;
  quote: string;
  sources: SourceExcerpt[];
  onClose: () => void;
}) {
  const excerpt =
    citation.source_excerpt
    ?? sources.find((source) => source.page === citation.page)?.text
    ?? null;
  const section = citation.source_section ?? citation.section ?? sources.find((s) => s.page === citation.page)?.section;

  return (
    <div className="source-panel" role="region" aria-label="Source excerpt">
      <div className="source-panel-header">
        <div>
          <p className="source-panel-title">Rulebook source</p>
          <p className="source-panel-meta">
            Page {citation.page}
            {section ? ` · ${section}` : ""}
          </p>
        </div>
        <button type="button" className="source-panel-close" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="source-panel-content">
        <RulebookPagePreview rulebookId={rulebookId} page={citation.page} />
        {excerpt ? (
          <div className="source-panel-body">{highlightQuoteInExcerpt(excerpt, quote)}</div>
        ) : (
          <p className="source-panel-missing">
            This passage was not in the retrieved context for this question.
            {citation.issue ? ` (${citation.issue.replace(/_/g, " ")})` : ""}
          </p>
        )}
      </div>
    </div>
  );
}

function favorsLabel(favors: NonNullable<AskResponse["ruling"]["favors"]>): string {
  switch (favors) {
    case "player_a":
      return "Favors Player A";
    case "player_b":
      return "Favors Player B";
    case "split":
      return "Split — both partly right";
    case "neither":
      return "Neither player";
    case "unclear":
      return "Unclear from rules";
    default:
      return favors;
  }
}

function formatRulingShareText(data: AskResponse): string {
  const { ruling, rulebook_name, mode } = data;
  const lines: string[] = [`Rules Referee — ${rulebook_name}`, ""];

  if (mode === "ask" && data.question) {
    lines.push(`Question: ${data.question}`, "");
  }

  if (mode === "dispute") {
    if (data.situation) {
      lines.push(`Dispute: ${data.situation}`);
    }
    if (data.player_a) {
      lines.push(`Player A: ${data.player_a}`);
    }
    if (data.player_b) {
      lines.push(`Player B: ${data.player_b}`);
    }
    if (data.situation || data.player_a || data.player_b) {
      lines.push("");
    }
    if (ruling.favors) {
      lines.push(`Outcome: ${favorsLabel(ruling.favors)}`, "");
    }
  }

  lines.push(`Ruling: ${ruling.ruling}`, "", `Reasoning: ${ruling.reasoning}`);

  if (ruling.citations.length > 0) {
    lines.push("", "Citations:");
    for (const citation of ruling.citations) {
      const section = citation.section ? ` (${citation.section})` : "";
      lines.push(`• p.${citation.page}${section}: "${citation.quote}"`);
    }
  }

  return lines.join("\n");
}

function highlightQuoteInExcerpt(excerpt: string, quote: string): ReactNode {
  const trimmed = quote.trim();
  if (!trimmed) {
    return excerpt;
  }

  const lowerExcerpt = excerpt.toLowerCase();
  const lowerQuote = trimmed.toLowerCase();
  const index = lowerExcerpt.indexOf(lowerQuote);
  if (index === -1) {
    return excerpt;
  }

  return (
    <>
      {excerpt.slice(0, index)}
      <mark>{excerpt.slice(index, index + trimmed.length)}</mark>
      {excerpt.slice(index + trimmed.length)}
    </>
  );
}
