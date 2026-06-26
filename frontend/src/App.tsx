import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  BggRulebookFile,
  Rulebook,
  askRulebook,
  reindexRulebook,
  searchRulebook,
  deleteRulebook,
  disputeRulebook,
  fetchExampleQuestions,
  buildRulebookHealthSummary,
  formatUploadProgressMessage,
  formatFileSize,
  isDuplicateRulebookError,
  listRulebooks,
  lookupBggRulebooks,
  pinRulebook,
  uploadProgressPercent,
  uploadRulebook,
  type UploadProgress,
  type RulebookHealthSummary,
  type SearchHit,
  type AskResponse,
} from "./api";
import {
  IconBook,
  IconChevronLeft,
  IconClose,
  IconDice,
  IconLibrary,
  IconMenu,
  IconPin,
  IconScales,
  IconUpload,
} from "./Icons";
import {
  appendExchange,
  clearHistory,
  getHistoryExchange,
  listRecentExchanges,
  loadAllHistory,
  loadAllThreads,
  repairRaceCorruptedThread,
  setHistoryExchangePinned,
  removeHistoryExchange,
  removeRulebookStorage,
  saveHistory,
  saveThread,
  trimThread,
  type HistoryExchange,
} from "./conversationStorage";
import type { AppError, ChatMode, ClarificationContext, Message } from "./app/types";
import {
  DESKTOP_LAYOUT_QUERY,
  SIDEBAR_LIST_PREVIEW_LIMIT,
  appendRulingToThread,
  buildHistory,
  findLastDisputeMessage,
  getActiveClarification,
  getPendingClarification,
  isEditableTarget,
  loadSidebarCollapsed,
  messageDomKey,
  saveSidebarCollapsed,
  sortRulebooks,
  toAppError,
  visibleRecentExchanges,
  visibleRulebooks,
} from "./app/utils";
import { AppBrandHeader } from "./components/AppBrandHeader";
import { AppNotice, RulebookHealthNotice } from "./components/AppNotices";
import { QuickSearchPanel } from "./components/QuickSearch";
import { RefereeAnswer } from "./components/RefereeAnswer";

export default function App({
  fullAccess = true,
  demoMode = false,
}: {
  fullAccess?: boolean;
  demoMode?: boolean;
}) {
  const [rulebooks, setRulebooks] = useState<Rulebook[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [threads, setThreads] = useState<Record<string, Message[]>>(() => {
    const loaded = loadAllThreads();
    const repaired: Record<string, Message[]> = {};
    for (const [rulebookId, thread] of Object.entries(loaded)) {
      const fixed = repairRaceCorruptedThread(thread);
      if (fixed !== thread) {
        saveThread(rulebookId, fixed);
      }
      repaired[rulebookId] = fixed;
    }
    return repaired;
  });
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
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia(DESKTOP_LAYOUT_QUERY).matches,
  );
  const [overlayDismissTick, setOverlayDismissTick] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const quickSearchInputRef = useRef<HTMLInputElement>(null);
  const disputeSituationRef = useRef<HTMLTextAreaElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const activeRequestRulebookRef = useRef<string | null>(null);
  const quickSearchSeqRef = useRef(0);

  const effectiveSidebarCollapsed = isDesktop && sidebarCollapsed;

  function selectRulebook(id: string) {
    if (loadingRef.current || id === selectedId) {
      if (id === selectedId) {
        setLibraryOpen(false);
      }
      return;
    }
    setSelectedId(id);
    setLibraryOpen(false);
    setQuestion("");
    setDisputeSituation("");
    setDisputePlayerA("");
    setDisputePlayerB("");
    setError(null);
  }

  const showLibraryPanel = useCallback(() => {
    setSidebarCollapsed(false);
    saveSidebarCollapsed(false);
  }, []);

  const hideLibraryPanel = useCallback(() => {
    if (window.matchMedia(DESKTOP_LAYOUT_QUERY).matches) {
      setSidebarCollapsed(true);
      saveSidebarCollapsed(true);
    }
    setLibraryOpen(false);
  }, []);

  const displayedRulebooks = visibleRulebooks(rulebooks, selectedId, showAllRulebooks);
  const hiddenRulebookCount = showAllRulebooks
    ? 0
    : Math.max(0, rulebooks.length - SIDEBAR_LIST_PREVIEW_LIMIT);

  const messages = selectedId ? threads[selectedId] ?? [] : [];
  const clarificationOverride = selectedId && selectedId in clarifications
    ? clarifications[selectedId]
    : undefined;
  const activeClarification = getActiveClarification(messages, chatMode, clarificationOverride);
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

  const clearClarificationOverride = useCallback((rulebookId: string) => {
    setClarifications((current) => {
      if (!(rulebookId in current)) {
        return current;
      }
      const next = { ...current };
      delete next[rulebookId];
      return next;
    });
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
    clearClarificationOverride(rulebookId);
    setQuestion("");
    setDisputeSituation("");
    setDisputePlayerA("");
    setDisputePlayerB("");
    setError(null);
  }, [updateThread, clearClarificationOverride]);

  const startNewConversation = useCallback((rulebookId: string) => {
    clearConversation(rulebookId);
    setChatMode((mode) => (mode === "search" ? "ask" : mode));
  }, [clearConversation]);

  const focusChatInput = useCallback((mode: ChatMode) => {
    window.requestAnimationFrame(() => {
      if (mode === "ask") {
        inputRef.current?.focus();
      } else if (mode === "dispute") {
        disputeSituationRef.current?.focus();
      }
    });
  }, []);

  const refresh = useCallback(async () => {
    const books = await listRulebooks();
    setRulebooks(books);
    return books;
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia(DESKTOP_LAYOUT_QUERY);
    const onChange = () => setIsDesktop(mediaQuery.matches);
    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
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
    if (activeClarification) {
      inputRef.current?.focus();
    } else if (chatMode === "dispute") {
      disputeSituationRef.current?.focus();
    }
  }, [activeClarification, chatMode, selectedId]);

  useEffect(() => {
    quickSearchSeqRef.current += 1;
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
          } else if (selectedId && activeClarification) {
            setClarificationFor(selectedId, null);
            handled = true;
          } else if (error) {
            setError(null);
            handled = true;
          } else if (info) {
            setInfo(null);
            handled = true;
          } else if (
            !effectiveSidebarCollapsed
            && isDesktop
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
        } else if (chatMode === "ask" || activeClarification) {
          inputRef.current?.focus();
        } else {
          disputeSituationRef.current?.focus();
        }
        return;
      }

      if ((event.key === "n" || event.key === "N") && selectedId && !loading) {
        event.preventDefault();
        const nextMode = chatMode === "search" ? "ask" : chatMode;
        startNewConversation(selectedId);
        focusChatInput(nextMode);
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    chatMode,
    activeClarification,
    clearConversation,
    error,
    effectiveSidebarCollapsed,
    focusChatInput,
    hideLibraryPanel,
    info,
    isDesktop,
    libraryOpen,
    loading,
    selectedId,
    setClarificationFor,
    startNewConversation,
  ]);

  useEffect(() => {
    if (chatMode === "search") {
      quickSearchInputRef.current?.focus();
    }
  }, [chatMode, selectedId]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }
    container.scrollTop = container.scrollHeight;
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
    clearClarificationOverride(rulebookId);
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

  function commitRuling(
    rulebookId: string,
    prompt: Extract<Message, { role: "user" } | { role: "dispute" }>,
    answer: AskResponse,
  ): Message[] {
    let threadWithRuling: Message[] = [];
    flushSync(() => {
      setThreads((current) => {
        const existing = current[rulebookId] ?? [];
        threadWithRuling = appendRulingToThread(existing, prompt, answer);
        saveThread(rulebookId, threadWithRuling);
        return { ...current, [rulebookId]: threadWithRuling };
      });
    });
    return threadWithRuling;
  }

  async function submitQuestion(reply: string) {
    if (!selectedId || !reply.trim() || loadingRef.current) {
      return;
    }

    const requestRulebookId = selectedId;
    const trimmed = reply.trim();
    const priorMessages = threads[requestRulebookId] ?? [];
    const history = buildHistory(priorMessages);
    const userMessage = { role: "user" as const, text: trimmed };

    loadingRef.current = true;
    activeRequestRulebookRef.current = requestRulebookId;
    setLoading(true);
    setError(null);
    try {
      const priorClarification = requestRulebookId in clarifications
        ? clarifications[requestRulebookId]
        : getPendingClarification(priorMessages);
      const answer = await askRulebook(requestRulebookId, trimmed, history);
      if (activeRequestRulebookRef.current !== requestRulebookId) {
        return;
      }
      if (answer.ruling.needs_clarification && answer.ruling.clarification_question) {
        setClarificationFor(requestRulebookId, {
          originalQuestion: priorClarification?.originalQuestion ?? trimmed,
          question: answer.ruling.clarification_question,
          mode: priorClarification?.mode ?? "ask",
        });
      } else {
        setClarificationFor(requestRulebookId, null);
      }
      const threadWithRuling = commitRuling(requestRulebookId, userMessage, answer);
      persistThreadAndHistory(requestRulebookId, threadWithRuling);
      setQuestion("");
    } catch (err) {
      if (activeRequestRulebookRef.current === requestRulebookId) {
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

  async function submitClarification(reply: string) {
    if (!selectedId || !reply.trim() || loadingRef.current) {
      return;
    }

    const requestRulebookId = selectedId;
    const trimmed = reply.trim();
    const priorMessages = threads[requestRulebookId] ?? [];
    const clarificationContext = requestRulebookId in clarifications
      ? clarifications[requestRulebookId]
      : getPendingClarification(priorMessages);

    if (clarificationContext?.mode !== "dispute") {
      await submitQuestion(trimmed);
      return;
    }

    const lastDispute = findLastDisputeMessage(priorMessages);
    if (!lastDispute) {
      await submitQuestion(trimmed);
      return;
    }

    const userMessage = { role: "user" as const, text: trimmed };

    const history = buildHistory(priorMessages);
    history.push({ role: "user", content: trimmed });

    loadingRef.current = true;
    activeRequestRulebookRef.current = requestRulebookId;
    setLoading(true);
    setError(null);
    try {
      const answer = await disputeRulebook(
        requestRulebookId,
        lastDispute.situation,
        lastDispute.playerA,
        lastDispute.playerB,
        history,
      );
      if (activeRequestRulebookRef.current !== requestRulebookId) {
        return;
      }
      if (answer.ruling.needs_clarification && answer.ruling.clarification_question) {
        setClarificationFor(requestRulebookId, {
          originalQuestion: lastDispute.situation,
          question: answer.ruling.clarification_question,
          mode: "dispute",
        });
      } else {
        setClarificationFor(requestRulebookId, null);
        setDisputeSituation("");
        setDisputePlayerA("");
        setDisputePlayerB("");
      }
      const threadWithRuling = commitRuling(requestRulebookId, userMessage, answer);
      persistThreadAndHistory(requestRulebookId, threadWithRuling);
      setQuestion("");
    } catch (err) {
      if (activeRequestRulebookRef.current === requestRulebookId) {
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
    if (activeClarification) {
      await submitClarification(reply);
      return;
    }
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

    const priorMessages = threads[requestRulebookId] ?? [];
    const history = buildHistory(priorMessages);
    const disputeMessage = { role: "dispute" as const, situation, playerA, playerB };

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
          mode: "dispute",
        });
      } else {
        setClarificationFor(requestRulebookId, null);
      }
      const threadWithRuling = commitRuling(requestRulebookId, disputeMessage, answer);
      persistThreadAndHistory(requestRulebookId, threadWithRuling);
      if (!answer.ruling.needs_clarification || !answer.ruling.clarification_question) {
        setDisputeSituation("");
        setDisputePlayerA("");
        setDisputePlayerB("");
      }
    } catch (err) {
      if (activeRequestRulebookRef.current === requestRulebookId) {
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

  async function handleQuickSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !quickSearchQuery.trim()) {
      return;
    }
    const searchForId = selectedId;
    const seq = ++quickSearchSeqRef.current;
    setQuickSearchLoading(true);
    setQuickSearchSelected(null);
    setError(null);
    try {
      const result = await searchRulebook(searchForId, quickSearchQuery.trim());
      if (seq !== quickSearchSeqRef.current || searchForId !== selectedId) {
        return;
      }
      setQuickSearchHits(result.hits);
    } catch (err) {
      if (seq !== quickSearchSeqRef.current) {
        return;
      }
      setQuickSearchHits(null);
      setError(toAppError(err));
    } finally {
      if (seq === quickSearchSeqRef.current) {
        setQuickSearchLoading(false);
      }
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
    <div className={`app${selected ? " app-active" : ""}`}>
      <div className="table-rail table-rail-top" aria-hidden="true" />
      <header className="site-header panel">
        <AppBrandHeader demoMode={demoMode} fullAccess={fullAccess} />
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

      <div className={`layout${effectiveSidebarCollapsed ? " sidebar-collapsed" : ""}`}>
        {libraryOpen && (
          <button
            type="button"
            className="sidebar-backdrop"
            aria-label="Close library"
            onClick={() => setLibraryOpen(false)}
          />
        )}

        {effectiveSidebarCollapsed ? (
          <aside className="sidebar panel sidebar-rail" aria-label="Library">
            <div className="sidebar-desktop-header sidebar-rail-header">
              <button
                type="button"
                className="sidebar-expand-rail"
                aria-label="Show library panel"
                title="Show library panel"
                onClick={showLibraryPanel}
              >
                <IconLibrary className="icon icon-sm" />
              </button>
            </div>
          </aside>
        ) : (
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
        )}

        <main
          className={`chat panel${
            selected && chatMode === "dispute" && messages.length === 0 && !loading
              ? " chat-dispute-idle"
              : ""
          }`}
        >
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
                  onClick={() => {
                    showLibraryPanel();
                    setLibraryOpen(true);
                  }}
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
                        disabled={loading}
                        onClick={() => {
                          const nextMode = chatMode === "search" ? "ask" : chatMode;
                          startNewConversation(selected.id);
                          focusChatInput(nextMode);
                        }}
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
                    </div>
                  </div>
                </div>
              </div>

              <div
                ref={messagesContainerRef}
                className={`messages${chatMode === "search" ? " search-mode" : ""}`}
                aria-busy={loading || uploading}
                aria-live="polite"
              >
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
                    <div key={messageDomKey(msg, i)} id={`message-${i}`} className="message-wrap user">
                      <span className="message-label">You</span>
                      <div className="bubble user">{msg.text}</div>
                    </div>
                  ) : msg.role === "dispute" ? (
                    <div key={messageDomKey(msg, i)} id={`message-${i}`} className="message-wrap dispute">
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
                    <div key={messageDomKey(msg, i)} id={`message-${i}`} className="message-wrap referee">
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
                  </>
                )}
              </div>

              {chatMode !== "search" && (
              <div className="chat-composer">
                {activeClarification && (
                  <div className="clarification-prompt" role="status">
                    <p className="clarification-prompt-label">Referee needs one detail</p>
                    <p className="clarification-prompt-question">{activeClarification.question}</p>
                    <button
                      type="button"
                      className="clarification-dismiss"
                      onClick={() => setClarificationFor(selected.id, null)}
                    >
                      {activeClarification.mode === "dispute"
                        ? "Settle a different dispute instead"
                        : "Ask something else instead"}
                    </button>
                  </div>
                )}

                {chatMode === "ask" || activeClarification ? (
                  <form className="ask-form" onSubmit={handleAsk}>
                    <input
                      ref={inputRef}
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      placeholder={
                        activeClarification
                          ? "Your answer…"
                          : messages.length > 0
                            ? "Ask a follow-up…"
                            : "Ask a rules question…"
                      }
                      disabled={loading}
                    />
                    <button type="submit" disabled={loading || uploading || !question.trim()}>
                      {loading ? "Thinking…" : activeClarification ? "Send detail" : "Ask"}
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
