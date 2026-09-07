import { IconCycle, IconDice, IconLayoutGrid, IconTrophy } from "../Icons";
import type { QuickReferenceData } from "../api";

export function QuickReferencePanel({
  data,
  loading,
  error,
  onRetry,
}: {
  data: QuickReferenceData | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <div className="quick-reference-loading" aria-live="polite">
        <span className="loading-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        Building quick reference…
      </div>
    );
  }

  if (error) {
    return (
      <div className="quick-reference-error" role="alert">
        <p>{error}</p>
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="quick-reference-empty">
        <IconDice className="icon icon-lg" />
        <p>No quick reference available yet.</p>
      </div>
    );
  }

  return (
    <section className="quick-reference" aria-label="Quick reference">
      <div className="quick-reference-section">
        <div className="quick-reference-section-header">
          <span className="quick-reference-icon-chip">
            <IconLayoutGrid className="icon icon-sm" />
          </span>
          <h3 className="quick-reference-kicker">Setup</h3>
        </div>
        <ol>
          {data.setup.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
      </div>

      <div className="quick-reference-section">
        <div className="quick-reference-section-header">
          <span className="quick-reference-icon-chip">
            <IconCycle className="icon icon-sm" />
          </span>
          <h3 className="quick-reference-kicker">Turn order</h3>
        </div>
        <ol>
          {data.turn_order.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
      </div>

      <div className="quick-reference-section">
        <div className="quick-reference-section-header">
          <span className="quick-reference-icon-chip">
            <IconDice className="icon icon-sm" />
          </span>
          <h3 className="quick-reference-kicker">Key actions</h3>
        </div>
        <dl className="quick-reference-actions">
          {data.key_actions.map((action, index) => (
            <div key={action.name} className="quick-reference-action">
              <span className="quick-reference-action-index" aria-hidden="true">
                {index + 1}
              </span>
              <div className="quick-reference-action-copy">
                <dt>{action.name}</dt>
                <dd>{action.summary}</dd>
              </div>
            </div>
          ))}
        </dl>
      </div>

      <div className="quick-reference-section quick-reference-win-condition">
        <div className="quick-reference-section-header">
          <span className="quick-reference-icon-chip quick-reference-icon-chip-win">
            <IconTrophy className="icon icon-sm" />
          </span>
          <h3 className="quick-reference-kicker">Win condition</h3>
        </div>
        <p>{data.win_condition}</p>
      </div>
    </section>
  );
}
