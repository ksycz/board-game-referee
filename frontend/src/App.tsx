import { useCallback, useEffect, useState } from "react";
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

export default function App() {
  const [rulebooks, setRulebooks] = useState<Rulebook[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [uploadName, setUploadName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    const q = question.trim();
    setQuestion("");
    setMessages((m) => [...m, { role: "user", text: q }]);
    setLoading(true);
    setError(null);
    try {
      const answer = await askRulebook(selectedId, q);
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
                  <button type="button" onClick={() => { setSelectedId(book.id); setMessages([]); }}>
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

              <form className="ask-form" onSubmit={handleAsk}>
                <input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Ask a rules question…"
                  disabled={loading}
                />
                <button type="submit" disabled={loading || !question.trim()}>
                  {loading ? "Thinking…" : "Ask"}
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
  return (
    <div className="bubble referee">
      <div className="ruling-header">
        <span className={`badge ${ruling.confidence}`}>{ruling.confidence} confidence</span>
        {!citation_check.all_valid && (
          <span className="badge warn">citations need review</span>
        )}
      </div>
      <p className="ruling">{ruling.ruling}</p>
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

      {ruling.needs_clarification && ruling.clarification_question && (
        <p className="clarify"><strong>Need clarification:</strong> {ruling.clarification_question}</p>
      )}

      <details>
        <summary>Agent trace ({data.retrieval.chunks_found} passages from pages {data.retrieval.pages.join(", ")})</summary>
        <pre>{JSON.stringify(data, null, 2)}</pre>
      </details>
    </div>
  );
}
