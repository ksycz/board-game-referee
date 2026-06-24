import type { RefObject } from "react";
import { cleanSearchExcerpt, formatSearchExcerpt, type SearchHit } from "../api";
import { RulebookPagePreview } from "./RulebookPagePreview";

export function QuickSearchPanel({
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
  inputRef?: RefObject<HTMLInputElement | null>;
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
