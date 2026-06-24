import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { fetchRulebookPagePreviewBlob } from "../api";

export function RulebookPagePreview({
  rulebookId,
  page,
}: {
  rulebookId: string;
  page: number;
}) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [largeUrl, setLargeUrl] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const closeLightbox = useCallback((event?: { stopPropagation?: () => void }) => {
    event?.stopPropagation?.();
    setExpanded(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const objectUrls: string[] = [];

    async function loadPreviews() {
      try {
        const [thumb, large] = await Promise.all([
          fetchRulebookPagePreviewBlob(rulebookId, page, { zoom: 2 }),
          fetchRulebookPagePreviewBlob(rulebookId, page, { zoom: 3.5 }),
        ]);
        if (cancelled) {
          URL.revokeObjectURL(thumb);
          URL.revokeObjectURL(large);
          return;
        }
        objectUrls.push(thumb, large);
        setThumbUrl(thumb);
        setLargeUrl(large);
      } catch {
        if (!cancelled) {
          setPreviewFailed(true);
        }
      }
    }

    void loadPreviews();
    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [rulebookId, page]);

  useEffect(() => {
    if (!expanded) {
      return;
    }
    document.documentElement.classList.add("page-preview-lightbox-open");
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.key === "Escape" || event.code === "Escape") && !event.isComposing) {
        event.stopImmediatePropagation();
        setExpanded(false);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.documentElement.classList.remove("page-preview-lightbox-open");
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [expanded]);

  if (previewFailed) {
    return (
      <figure className="source-panel-preview source-panel-preview-unavailable">
        <p className="source-panel-missing">Page preview unavailable for this passage.</p>
      </figure>
    );
  }

  if (!thumbUrl || !largeUrl) {
    return (
      <figure className="source-panel-preview source-panel-preview-unavailable">
        <p className="source-panel-missing">Loading page preview…</p>
      </figure>
    );
  }

  const lightbox = expanded ? (
    <div
      className="page-preview-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`Rulebook page ${page}`}
    >
      <button
        type="button"
        className="page-preview-lightbox-backdrop"
        onClick={(event) => closeLightbox(event)}
        aria-label="Close enlarged page"
      />
      <div
        className="page-preview-lightbox-frame"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="page-preview-lightbox-close"
          onClick={(event) => closeLightbox(event)}
        >
          Close
        </button>
        <img src={largeUrl} alt={`Rulebook page ${page} (enlarged)`} />
      </div>
    </div>
  ) : null;

  return (
    <>
      <figure className="source-panel-preview">
        <button
          type="button"
          className="source-panel-preview-trigger"
          onClick={() => setExpanded(true)}
          aria-label={`Enlarge rulebook page ${page}`}
        >
          <img
            src={thumbUrl}
            alt={`Rulebook page ${page}`}
            loading="lazy"
          />
          <span className="source-panel-preview-hint" aria-hidden="true">
            Tap to enlarge
          </span>
        </button>
      </figure>
      {lightbox && typeof document !== "undefined"
        ? createPortal(lightbox, document.body)
        : null}
    </>
  );
}
