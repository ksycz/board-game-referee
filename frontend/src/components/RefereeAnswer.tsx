import { useState, type ReactNode } from "react";
import type { ConfidenceHint as ConfidenceHintInfo } from "../api";
import {
  AskResponse,
  Citation,
  SourceExcerpt,
  submitRulingFeedback,
} from "../api";
import { IconCopy, IconShare, IconThumbDown, IconThumbUp } from "../Icons";
import { RulebookPagePreview } from "./RulebookPagePreview";

export function RefereeAnswer({
  rulebookId,
  data,
  overlayDismissTick,
  awaitingClarification = false,
  onNotify,
}: {
  rulebookId: string;
  data: AskResponse;
  overlayDismissTick: number;
  awaitingClarification?: boolean;
  onNotify?: (message: string) => void;
}) {
  const { ruling } = data;
  const citation_check = data.citation_check ?? { all_valid: true, issues: [], citations: [] };
  const needsInput = awaitingClarification
    && ruling.needs_clarification
    && ruling.clarification_question;
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
          <CopyShareRuling data={data} onNotify={onNotify} />
          <RulingFeedback rulebookId={rulebookId} data={data} onNotify={onNotify} />
        </div>
      )}

      {import.meta.env.DEV && (
        <details>
          <summary>
            Agent trace ({data.retrieval.chunks_found} passages from pages {data.retrieval.pages.join(", ")})
          </summary>
          <pre>{JSON.stringify(data, null, 2)}</pre>
        </details>
      )}
    </div>
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

function CopyShareRuling({
  data,
  onNotify,
}: {
  data: AskResponse;
  onNotify?: (message: string) => void;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "shared">("idle");
  const shareText = formatRulingShareText(data);
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function copyRuling() {
    try {
      await navigator.clipboard.writeText(shareText);
      setStatus("copied");
      window.setTimeout(() => setStatus("idle"), 2000);
    } catch {
      onNotify?.("Could not copy — try selecting the text manually.");
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

function RulingFeedback({
  rulebookId,
  data,
  onNotify,
}: {
  rulebookId: string;
  data: AskResponse;
  onNotify?: (message: string) => void;
}) {
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
      onNotify?.("Could not save feedback — try again in a moment.");
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
  const { ruling } = data;
  const citation_check = data.citation_check ?? { all_valid: true, issues: [], citations: [] };
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
