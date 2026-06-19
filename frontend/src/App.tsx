import { useCallback, useEffect, useRef, useState } from "react";
import {
  AskResponse,
  Rulebook,
  askRulebook,
  deleteRulebook,
  listRulebooks,
  uploadRulebook,
} from "./api";

type Message =
  | { role: "user"; text: string }
  | { role: "referee"; data: AskResponse };

type ClarificationContext = {
  originalQuestion: string;
  question: string;
};

export default function App() {
  const [rulebooks, setRulebooks] = useState<Rulebook[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [uploadName, setUploadName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clarification, setClarification] = useState<ClarificationContext | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const books = await listRulebooks();
    setRulebooks(books);
    if (!selectedId && books.length > 0) {
      setSelectedId(books[0].id);
    }
  }, [selectedId]);

  useEffect(() => {
    refresh().catch((e) => setError(String(e)));
  }, [refresh]);

  useEffect(() => {
    if (clarification) {
      inputRef.current?.focus();
    }
  }, [clarification]);

  const selected = rulebooks.find((b) => b.id === selectedId);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const book = await uploadRulebook(file, uploadName || undefined);
      setUploadName("");
      setSelectedId(book.id);
      setMessages([]);
      setClarification(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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

    const asked = clarification
      ? `Original question: ${clarification.originalQuestion}\n\nClarification (${clarification.question}): ${reply}`
      : reply;

    setMessages((m) => [...m, { role: "user", text: reply }]);
    setLoading(true);
    setError(null);
    try {
      const answer = await askRulebook(selectedId, asked);
      if (answer.ruling.needs_clarification && answer.ruling.clarification_question) {
        setClarification({
          originalQuestion: clarification?.originalQuestion ?? reply,
          question: answer.ruling.clarification_question,
        });
      } else {
        setClarification(null);
      }
      setMessages((m) => [...m, { role: "referee", data: answer }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this rulebook?")) return;
    setLoading(true);
    try {
      await deleteRulebook(id);
      if (selectedId === id) {
        setSelectedId(null);
        setMessages([]);
        setClarification(null);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app">
      <header>
        <h1>Rules Referee</h1>
        <p>Upload a rulebook PDF, ask rules questions, get cited rulings.</p>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <section>
            <h2>Upload rulebook</h2>
            <input
              type="text"
              placeholder="Game name (optional)"
              value={uploadName}
              onChange={(e) => setUploadName(e.target.value)}
            />
            <label className="upload-btn">
              Choose PDF
              <input type="file" accept=".pdf" onChange={handleUpload} hidden />
            </label>
          </section>

          <section>
            <h2>Your rulebooks</h2>
            {rulebooks.length === 0 && <p className="muted">No rulebooks yet.</p>}
            <ul className="book-list">
              {rulebooks.map((book) => (
                <li key={book.id} className={book.id === selectedId ? "active" : ""}>
                  <button type="button" onClick={() => { setSelectedId(book.id); setMessages([]); setClarification(null); }}>
                    <strong>{book.name}</strong>
                    <span>{book.page_count} pages</span>
                  </button>
                  <button type="button" className="delete" onClick={() => handleDelete(book.id)}>×</button>
                </li>
              ))}
            </ul>
          </section>
        </aside>

        <main className="chat">
          {!selected ? (
            <div className="empty">Upload a rulebook to start asking questions.</div>
          ) : (
            <>
              <div className="chat-header">
                <h2>{selected.name}</h2>
                <span className="muted">Ask about timing, edge cases, disputes…</span>
              </div>

              <div className="messages">
                {messages.length === 0 && (
                  <div className="hint">
                    Try: &ldquo;Can I play this card during another player&apos;s turn?&rdquo;
                  </div>
                )}
                {messages.map((msg, i) =>
                  msg.role === "user" ? (
                    <div key={i} className="bubble user">{msg.text}</div>
                  ) : (
                    <RefereeAnswer key={i} data={msg.data} />
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
                    onClick={() => setClarification(null)}
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
          {error && <div className="error">{error}</div>}
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
