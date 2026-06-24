import { IconClose } from "../Icons";
import {
  CONTEXT_ENGINEERING_PDF_GUIDE_URL,
  formatRulebookHealthCopy,
  type RulebookHealthSummary,
} from "../api";
import type { AppError } from "../app/types";

export function RulebookHealthNotice({
  health,
  onDismiss,
}: {
  health: RulebookHealthSummary;
  onDismiss: () => void;
}) {
  const copy = formatRulebookHealthCopy(health);
  const needsHelp = copy.cautions.length > 0;

  return (
    <div
      className={`notice-banner ${needsHelp ? "health-warn" : "health-ok"}`}
      role="status"
    >
      <div className="notice-banner-copy">
        <p className="notice-banner-title">{copy.title}</p>
        <p className="notice-banner-hint">{copy.summary}</p>
        {copy.cautions.length > 0 && (
          <ul className="rulebook-health-list">
            {copy.cautions.map((caution) => (
              <li key={caution}>{caution}</li>
            ))}
          </ul>
        )}
        {needsHelp && (
          <p className="notice-banner-hint">
            <a href={CONTEXT_ENGINEERING_PDF_GUIDE_URL} target="_blank" rel="noreferrer">
              Tips for graphical PDFs
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

export function AppNotice({
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
