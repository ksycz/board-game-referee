import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  AskResponse,
  Citation,
  HistoryMessage,
  Rulebook,
  SourceExcerpt,
  askRulebook,
  deleteRulebook,
  disputeRulebook,
  fetchExampleQuestions,
  formatUploadProgressMessage,
  formatUploadSuccessMessage,
  isDuplicateRulebookError,
  listRulebooks,
  pinRulebook,
  submitRulingFeedback,
  uploadProgressPercent,
  uploadRulebook,
  type UploadProgress,
} from "./api";
import {
  IconBook,
  IconClose,
  IconCopy,
  IconLibrary,
  IconMenu,
  IconPin,
  IconScales,
  IconShare,
  IconThumbDown,
  IconThumbUp,
  IconUpload,
  DieD20,
  DieD6,
} from "./Icons";

type ChatMode = "ask" | "dispute";

type Message =
  | { role: "user"; text: string }
  | { role: "dispute"; situation: string; playerA: string; playerB: string }
  | { role: "referee"; data: AskResponse };

type ClarificationContext = {
  originalQuestion: string;
  question: string;
};

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

const RULEBOOKS_PREVIEW_LIMIT = 5;

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
  if (showAll || ordered.length <= RULEBOOKS_PREVIEW_LIMIT) {
    return ordered;
  }

  const preview = ordered.slice(0, RULEBOOKS_PREVIEW_LIMIT);
  if (selectedId && !preview.some((book) => book.id === selectedId)) {
    const selected = ordered.find((book) => book.id === selectedId);
    if (selected) {
      return [...ordered.slice(0, RULEBOOKS_PREVIEW_LIMIT - 1), selected];
    }
  }

  return preview;
}

export default function App() {
  const [rulebooks, setRulebooks] = useState<Rulebook[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [threads, setThreads] = useState<Record<string, Message[]>>({});
  const [clarifications, setClarifications] = useState<Record<string, ClarificationContext | null>>({});
  const [examples, setExamples] = useState<Record<string, string[]>>({});
  const [question, setQuestion] = useState("");
  const [chatMode, setChatMode] = useState<ChatMode>("ask");
  const [disputeSituation, setDisputeSituation] = useState("");
  const [disputePlayerA, setDisputePlayerA] = useState("");
  const [disputePlayerB, setDisputePlayerB] = useState("");
  const [uploadName, setUploadName] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showAllRulebooks, setShowAllRulebooks] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function selectRulebook(id: string) {
    setSelectedId(id);
    setLibraryOpen(false);
  }

  const displayedRulebooks = visibleRulebooks(rulebooks, selectedId, showAllRulebooks);
  const hiddenRulebookCount = showAllRulebooks
    ? 0
    : Math.max(0, rulebooks.length - RULEBOOKS_PREVIEW_LIMIT);

  const messages = selectedId ? threads[selectedId] ?? [] : [];
  const clarification = selectedId ? clarifications[selectedId] ?? null : null;
  const exampleQuestions = selectedId ? examples[selectedId] ?? [] : [];

  const updateThread = useCallback((rulebookId: string, updater: (prev: Message[]) => Message[]) => {
    setThreads((current) => ({
      ...current,
      [rulebookId]: updater(current[rulebookId] ?? []),
    }));
  }, []);

  const setClarificationFor = useCallback((rulebookId: string, value: ClarificationContext | null) => {
    setClarifications((current) => ({
      ...current,
      [rulebookId]: value,
    }));
  }, []);

  const refresh = useCallback(async () => {
    const books = await listRulebooks();
    setRulebooks(books);
    return books;
  }, []);

  useEffect(() => {
    refresh()
      .then((books) => {
        setSelectedId((current) => current ?? books[0]?.id ?? null);
      })
      .catch((e) => setError(String(e)));
  }, [refresh]);

  useEffect(() => {
    if (clarification) {
      inputRef.current?.focus();
    }
  }, [clarification]);

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

  function clearConversation(rulebookId: string) {
    updateThread(rulebookId, () => []);
    setClarificationFor(rulebookId, null);
    setQuestion("");
    setDisputeSituation("");
    setDisputePlayerA("");
    setDisputePlayerB("");
    setError(null);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadProgress({ phase: "starting", page: 0, total_pages: 0 });
    setError(null);
    setInfo(null);
    try {
      const upload = await uploadRulebook(file, uploadName || undefined, (progress) => {
        setUploadProgress(progress);
      });
      setUploadName("");
      setSelectedId(upload.rulebook.id);
      setExamples((current) => ({
        ...current,
        [upload.rulebook.id]: upload.example_questions,
      }));
      clearConversation(upload.rulebook.id);
      await refresh();
      setInfo(formatUploadSuccessMessage(upload.rulebook.name, upload.ingestion));
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
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setUploading(false);
      setUploadProgress(null);
      e.target.value = "";
    }
  }

  async function handleAsk(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !question.trim()) return;

    const reply = question.trim();
    setQuestion("");

    const history = buildHistory(messages);
    updateThread(selectedId, (current) => [...current, { role: "user", text: reply }]);

    setLoading(true);
    setError(null);
    try {
      const answer = await askRulebook(selectedId, reply, history);
      if (answer.ruling.needs_clarification && answer.ruling.clarification_question) {
        setClarificationFor(selectedId, {
          originalQuestion: clarification?.originalQuestion ?? reply,
          question: answer.ruling.clarification_question,
        });
      } else {
        setClarificationFor(selectedId, null);
      }
      updateThread(selectedId, (current) => [...current, { role: "referee", data: answer }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleDispute(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId) return;

    const situation = disputeSituation.trim();
    const playerA = disputePlayerA.trim();
    const playerB = disputePlayerB.trim();
    if (!situation || !playerA || !playerB) return;

    setDisputeSituation("");
    setDisputePlayerA("");
    setDisputePlayerB("");

    const history = buildHistory(messages);
    updateThread(selectedId, (current) => [
      ...current,
      { role: "dispute", situation, playerA, playerB },
    ]);

    setLoading(true);
    setError(null);
    try {
      const answer = await disputeRulebook(selectedId, situation, playerA, playerB, history);
      if (answer.ruling.needs_clarification && answer.ruling.clarification_question) {
        setClarificationFor(selectedId, {
          originalQuestion: situation,
          question: answer.ruling.clarification_question,
        });
      } else {
        setClarificationFor(selectedId, null);
      }
      updateThread(selectedId, (current) => [...current, { role: "referee", data: answer }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
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
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this rulebook?")) return;
    setLoading(true);
    setError(null);
    try {
      await deleteRulebook(id);
      setThreads((current) => {
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
      setRulebooks((current) => {
        const next = current.filter((book) => book.id !== id);
        setSelectedId((selected) => (selected === id ? (next[0]?.id ?? null) : selected));
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app">
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
          <p>Settle arguments with cited rulings — upload a rulebook and roll.</p>
        </div>
        <div className="header-dice" aria-hidden="true">
          <DieD6 className="die-svg die-svg-sm" pip="six" />
          <DieD20 className="die-svg die-svg-lg" value={20} />
        </div>
      </header>

      {(error || info) && (
        <div className="app-notice" role="status">
          {info && <div className="info">{info}</div>}
          {error && <div className="error">{error}</div>}
        </div>
      )}

      <div className="layout">
        {libraryOpen && (
          <button
            type="button"
            className="sidebar-backdrop"
            aria-label="Close library"
            onClick={() => setLibraryOpen(false)}
          />
        )}

        <aside className={`sidebar panel${libraryOpen ? " open" : ""}`}>
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
              placeholder="Optional — we&apos;ll detect it from the PDF"
              value={uploadName}
              onChange={(e) => setUploadName(e.target.value)}
              disabled={uploading}
            />
            <label className={`upload-btn${uploading ? " upload-btn-busy" : ""}`}>
              <IconUpload className="icon icon-sm" />
              {uploading ? "Processing…" : "Choose rulebook PDF"}
              <input type="file" accept=".pdf" onChange={handleUpload} hidden disabled={uploading} />
            </label>
            {uploading && uploadProgress && (
              <div className="upload-progress" role="status" aria-live="polite">
                <p className="upload-progress-label">
                  {formatUploadProgressMessage(uploadProgress)}
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

          <section className="panel-section">
            <h2 className="panel-title">
              <span className="panel-title-icon">
                <IconLibrary className="icon" />
              </span>
              Your library
            </h2>
            {rulebooks.length === 0 && <p className="muted">No rulebooks yet — add one to start.</p>}
            <ul className="book-list">
              {displayedRulebooks.map((book) => (
                <li key={book.id} className={book.id === selectedId ? "active" : ""}>
                  <button type="button" onClick={() => selectRulebook(book.id)}>
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
                  <button
                    type="button"
                    className="delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDelete(book.id);
                    }}
                  >
                    ×
                  </button>
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
            {showAllRulebooks && rulebooks.length > RULEBOOKS_PREVIEW_LIMIT && (
              <button
                type="button"
                className="book-list-toggle"
                onClick={() => setShowAllRulebooks(false)}
              >
                Show less
              </button>
            )}
          </section>
        </aside>

        <main className="chat panel">
          {!selected ? (
            <div className="empty-state">
              <div className="empty-dice" aria-hidden="true">
                <DieD6 className="die-svg die-svg-xl" pip="six" />
                <DieD20 className="die-svg die-svg-lg" value={20} />
              </div>
              <h3>The table awaits</h3>
              <p className="muted">Drop a rulebook PDF into your library — then roll for rulings on timing, edge cases, and disputes.</p>
              <button
                type="button"
                className="open-library-btn"
                onClick={() => setLibraryOpen(true)}
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
                <span className="mobile-game-name">{selected.name}</span>
              </div>

              <div className="chat-header">
                <div className="chat-header-row">
                  <div>
                    <h2>{selected.name}</h2>
                    <span className="chat-subtitle">
                      {chatMode === "ask"
                        ? "Ask about timing, edge cases, disputes…"
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
                        aria-selected={chatMode === "dispute"}
                        className={chatMode === "dispute" ? "active" : ""}
                        onClick={() => setChatMode("dispute")}
                      >
                        Dispute
                      </button>
                    </div>
                    {messages.length > 0 && (
                      <button
                        type="button"
                        className="new-conversation"
                        onClick={() => clearConversation(selected.id)}
                      >
                        New conversation
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="messages">
                {messages.length === 0 && exampleQuestions.length > 0 && (
                  <div className="example-questions">
                    <p className="example-questions-label">Try asking</p>
                    <div className="example-questions-list">
                      {exampleQuestions.map((example) => (
                        <button
                          key={example}
                          type="button"
                          className="example-question"
                          disabled={loading}
                          onClick={() => {
                            setQuestion(example);
                            inputRef.current?.focus();
                          }}
                        >
                          {example}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {messages.length === 0 && exampleQuestions.length === 0 && (
                  <div className="hint">
                    Try: &ldquo;Can I play this card during another player&apos;s turn?&rdquo;
                    Follow up with: &ldquo;What about on the first turn?&rdquo;
                  </div>
                )}
                {messages.map((msg, i) =>
                  msg.role === "user" ? (
                    <div key={i} className="message-wrap user">
                      <span className="message-label">You</span>
                      <div className="bubble user">{msg.text}</div>
                    </div>
                  ) : msg.role === "dispute" ? (
                    <div key={i} className="message-wrap dispute">
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
                    <div key={i} className="message-wrap referee">
                      <span className="message-label">Referee</span>
                      <RefereeAnswer rulebookId={selected.id} data={msg.data} />
                    </div>
                  )
                )}
              </div>

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
                    <button type="submit" disabled={loading || !question.trim()}>
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
            </>
          )}
        </main>
      </div>
      <div className="table-rail table-rail-bottom" aria-hidden="true" />
    </div>
  );
}

function RefereeAnswer({ rulebookId, data }: { rulebookId: string; data: AskResponse }) {
  const { ruling, citation_check } = data;
  const needsInput = ruling.needs_clarification && ruling.clarification_question;
  const isDispute = data.mode === "dispute";

  return (
    <div className={`bubble referee${needsInput ? " needs-clarification" : ""}`}>
      <div className="referee-stamp" aria-hidden="true">
        <IconScales className="icon icon-xs" />
        {isDispute ? "Dispute ruling" : "House ruling"}
      </div>
      {needsInput ? (
        <div className="clarification-callout">
          <span className="badge clarify">Needs your input</span>
          <p className="clarification-question">{ruling.clarification_question}</p>
          <p className="clarification-hint">Reply below with the missing detail to get a final ruling.</p>
        </div>
      ) : (
        <div className="ruling-header">
          {data.cached && <span className="badge cache">From cache</span>}
          {isDispute && ruling.favors && (
            <span className={`badge favors favors-${ruling.favors}`}>
              {favorsLabel(ruling.favors)}
            </span>
          )}
          <span className={`badge ${ruling.confidence}`}>{ruling.confidence} confidence</span>
          {!citation_check.all_valid && (
            <span className="badge warn">citations need review</span>
          )}
        </div>
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
        <CitationsList data={data} />
      )}

      {!needsInput && (
        <div className="ruling-actions">
          <CopyShareRuling data={data} />
          <RulingFeedback rulebookId={rulebookId} data={data} />
        </div>
      )}

      <details>
        <summary>Agent trace ({data.retrieval.chunks_found} passages from pages {data.retrieval.pages.join(", ")})</summary>
        <pre>{JSON.stringify(data, null, 2)}</pre>
      </details>
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

function CitationsList({ data }: { data: AskResponse }) {
  const { ruling, citation_check } = data;
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const selected = selectedIndex !== null ? citation_check.citations[selectedIndex] : null;
  const selectedRuling = selectedIndex !== null ? ruling.citations[selectedIndex] : null;

  return (
    <div className="citations">
      <h4>Citations</h4>
      <p className="citations-hint">Tap a citation to view the rulebook excerpt.</p>
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
          citation={selected}
          quote={selectedRuling.quote}
          sources={data.retrieval.sources ?? []}
          onClose={() => setSelectedIndex(null)}
        />
      )}
    </div>
  );
}

function SourcePanel({
  citation,
  quote,
  sources,
  onClose,
}: {
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
      {excerpt ? (
        <div className="source-panel-body">{highlightQuoteInExcerpt(excerpt, quote)}</div>
      ) : (
        <p className="source-panel-missing">
          This passage was not in the retrieved context for this question.
          {citation.issue ? ` (${citation.issue.replace(/_/g, " ")})` : ""}
        </p>
      )}
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
