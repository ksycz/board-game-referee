import { IconClose } from "../Icons";
import { CONTEXT_ENGINEERING_PDF_GUIDE_URL, formatThinPagesLabel, type RulebookHealthSummary } from "../api";
import type { AppError } from "../app/types";

export function RulebookHealthNotice({
  health,
  onDismiss,
}: {
  health: RulebookHealthSummary;
  onDismiss: () => void;
}) {
  const needsHelp = health.thinPages.length > 0 || !!health.ocrWarning;
  const thinLabel = formatThinPagesLabel(health.thinPages);
  const ocrLabel = health.ocrPages === 1
    ? "1 page scanned (OCR)"
    : `${health.ocrPages} pages scanned (OCR)`;

  return (
    <div
      className={`notice-banner ${needsHelp ? "health-warn" : "health-ok"}`}
      role="status"
    >
      <div className="notice-banner-copy">
        <p className="notice-banner-title">{health.name} indexed</p>
        <ul className="rulebook-health-list">
          <li>
            {health.pagesIndexed} of {health.totalPages} pages indexed · {health.chunksIndexed} passages
          </li>
          {health.ocrPages > 0 && <li>{ocrLabel}</li>}
          {health.thinPages.length > 0 && (
            <li>
              {health.thinPages.length} thin page{health.thinPages.length === 1 ? "" : "s"}
              {thinLabel ? ` (${thinLabel})` : ""} — may answer poorly there
            </li>
          )}
        </ul>
        {health.ocrWarning && <p className="notice-banner-hint">{health.ocrWarning}</p>}
        {needsHelp && (
          <p className="notice-banner-hint">
            <a href={CONTEXT_ENGINEERING_PDF_GUIDE_URL} target="_blank" rel="noreferrer">
              Troubleshooting graphical PDFs
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
