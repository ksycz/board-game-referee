import { useCallback, useEffect, useRef, useState } from "react";
import {
  AskResponse,
  HistoryMessage,
  Rulebook,
  askRulebook,
  deleteRulebook,
  fetchExampleQuestions,
  isDuplicateRulebookError,
  listRulebooks,
  uploadRulebook,
} from "./api";
import { IconBook, IconLibrary, IconScales, IconUpload } from "./Icons";

type Message =
  | { role: "user"; text: string }
  | { role: "referee"; data: AskResponse };

type ClarificationContext = {
  originalQuestion: string;
  question: string;
};

function buildHistory(messages: Message[]): HistoryMessage[] {
  return messages.map((msg) =>
    msg.role === "user"
      ? { role: "user", content: msg.text }
      : { role: "assistant", content: msg.data.ruling.ruling },
  );
}

const RULEBOOKS_PREVIEW_LIMIT = 5;

function visibleRulebooks(
  books: Rulebook[],
  selectedId: string | null,
  showAll: boolean,
): Rulebook[] {
  if (showAll || books.length <= RULEBOOKS_PREVIEW_LIMIT) {
    return books;
  }

  const preview = books.slice(0, RULEBOOKS_PREVIEW_LIMIT);
  if (selectedId && !preview.some((book) => book.id === selectedId)) {
    const selected = books.find((book) => book.id === selectedId);
    if (selected) {
      return [...books.slice(0, RULEBOOKS_PREVIEW_LIMIT - 1), selected];
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
  const [uploadName, setUploadName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showAllRulebooks, setShowAllRulebooks] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
    setError(null);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const upload = await uploadRulebook(file, uploadName || undefined);
      setUploadName("");
      setSelectedId(upload.rulebook.id);
      setExamples((current) => ({
        ...current,
        [upload.rulebook.id]: upload.example_questions,
      }));
      clearConversation(upload.rulebook.id);
      await refresh();
    } catch (err) {
      if (isDuplicateRulebookError(err)) {
        setUploadName("");
        setSelectedId(err.rulebook.id);
        setExamples((current) => ({
          ...current,
          [err.rulebook.id]: err.example_questions,
        }));
        await refresh();
        setInfo(`"${err.rulebook.name}" is already in your library — opened the existing copy.`);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setLoading(false);
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
      <header className="site-header">
        <div className="brand-mark" aria-hidden="true">
          <IconScales className="icon icon-lg" />
        </div>
        <div className="brand-copy">
          <h1>Rules Referee</h1>
          <p>Your table-side rules lawyer — upload a rulebook, settle disputes with cited rulings.</p>
        </div>
      </header>

      {(error || info) && (
        <div className="app-notice" role="status">
          {info && <div className="info">{info}</div>}
          {error && <div className="error">{error}</div>}
        </div>
      )}

      <div className="layout">
        <aside className="sidebar panel">
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
            />
            <label className="upload-btn">
              <IconUpload className="icon icon-sm" />
              Choose rulebook PDF
              <input type="file" accept=".pdf" onChange={handleUpload} hidden />
            </label>
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
                  <button type="button" onClick={() => setSelectedId(book.id)}>
                    <span className="book-icon">
                      <IconBook className="icon icon-sm" />
                    </span>
                    <span className="book-details">
                      <strong>{book.name}</strong>
                      <span className="book-pages">{book.page_count} pages</span>
                    </span>
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
              <div className="empty-board" aria-hidden="true">
                <span /><span /><span />
                <span /><span /><span />
                <span /><span /><span />
              </div>
              <h3>Ready to play?</h3>
              <p className="muted">Upload a rulebook PDF to ask timing questions, edge cases, and disputes.</p>
            </div>
          ) : (
            <>
              <div className="chat-header">
                <div className="chat-header-row">
                  <div>
                    <h2>{selected.name}</h2>
                    <span className="chat-subtitle">
                      Ask about timing, edge cases, disputes…
                    </span>
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
                  ) : (
                    <div key={i} className="message-wrap referee">
                      <span className="message-label">Referee</span>
                      <RefereeAnswer data={msg.data} />
                    </div>
                  )
                )}
              </div>

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
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function RefereeAnswer({ data }: { data: AskResponse }) {
  const { ruling, citation_check } = data;
  const needsInput = ruling.needs_clarification && ruling.clarification_question;

  return (
    <div className={`bubble referee${needsInput ? " needs-clarification" : ""}`}>
      <div className="referee-stamp" aria-hidden="true">
        <IconScales className="icon icon-xs" />
        Official ruling
      </div>
      {needsInput ? (
        <div className="clarification-callout">
          <span className="badge clarify">Needs your input</span>
          <p className="clarification-question">{ruling.clarification_question}</p>
          <p className="clarification-hint">Reply below with the missing detail to get a final ruling.</p>
        </div>
      ) : (
        <div className="ruling-header">
          <span className={`badge ${ruling.confidence}`}>{ruling.confidence} confidence</span>
          {!citation_check.all_valid && (
            <span className="badge warn">citations need review</span>
          )}
        </div>
      )}

      <p className={`ruling${needsInput ? " tentative" : ""}`}>{ruling.ruling}</p>
      <p className="reasoning">{ruling.reasoning}</p>

      {ruling.citations.length > 0 && (
        <div className="citations">
          <h4>Citations</h4>
          {ruling.citations.map((c, i) => (
            <blockquote key={i} className={citation_check.citations[i]?.valid === false ? "invalid" : ""}>
              <footer>
                Page {c.page}
                {c.section ? ` · ${c.section}` : ""}
              </footer>
              &ldquo;{c.quote}&rdquo;
            </blockquote>
          ))}
        </div>
      )}

      <details>
        <summary>Agent trace ({data.retrieval.chunks_found} passages from pages {data.retrieval.pages.join(", ")})</summary>
        <pre>{JSON.stringify(data, null, 2)}</pre>
      </details>
    </div>
  );
}
