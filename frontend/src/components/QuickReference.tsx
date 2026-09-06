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
    return <div className="quick-reference-empty">No quick reference available yet.</div>;
  }

  return (
    <section className="quick-reference" aria-label="Quick reference">
      <div className="quick-reference-section">
        <h3>Setup</h3>
        <ol>
          {data.setup.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
      </div>
      <div className="quick-reference-section">
        <h3>Turn order</h3>
        <ol>
          {data.turn_order.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
      </div>
      <div className="quick-reference-section">
        <h3>Key actions</h3>
        <dl className="quick-reference-actions">
          {data.key_actions.map((action) => (
            <div key={action.name} className="quick-reference-action">
              <dt>{action.name}</dt>
              <dd>{action.summary}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="quick-reference-section">
        <h3>Win condition</h3>
        <p>{data.win_condition}</p>
      </div>
    </section>
  );
}
