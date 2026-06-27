import { useCallback, useEffect, useId, useRef, useState } from "react";

export type ConfirmDialogRequest = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
};

type PendingConfirm = ConfirmDialogRequest & {
  resolve: (confirmed: boolean) => void;
};

function ConfirmDialogView({
  title,
  message,
  confirmLabel = "OK",
  cancelLabel = "Cancel",
  tone = "default",
  onCancel,
  onConfirm,
}: ConfirmDialogRequest & {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const messageId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div className="confirm-dialog" role="presentation">
      <button
        type="button"
        className="confirm-dialog-backdrop"
        aria-label="Close dialog"
        onClick={onCancel}
      />
      <div
        className="confirm-dialog-panel panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
      >
        <h2 id={titleId} className="confirm-dialog-title">
          {title ?? "Are you sure?"}
        </h2>
        <p id={messageId} className="confirm-dialog-message">
          {message}
        </p>
        <div className="confirm-dialog-actions">
          <button
            ref={cancelRef}
            type="button"
            className="confirm-dialog-btn confirm-dialog-btn-cancel"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`confirm-dialog-btn confirm-dialog-btn-confirm${
              tone === "danger" ? " confirm-dialog-btn-danger" : ""
            }`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function useConfirmDialog() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback((request: ConfirmDialogRequest | string) => {
    const options: ConfirmDialogRequest =
      typeof request === "string" ? { message: request } : request;

    return new Promise<boolean>((resolve) => {
      setPending((current) => {
        current?.resolve(false);
        return { ...options, resolve };
      });
    });
  }, []);

  const close = useCallback((confirmed: boolean) => {
    setPending((current) => {
      current?.resolve(confirmed);
      return null;
    });
  }, []);

  useEffect(() => {
    if (!pending) {
      return;
    }

    document.documentElement.classList.add("confirm-dialog-open");

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.documentElement.classList.remove("confirm-dialog-open");
    };
  }, [pending, close]);

  const dialog = pending ? (
    <ConfirmDialogView
      title={pending.title}
      message={pending.message}
      confirmLabel={pending.confirmLabel}
      cancelLabel={pending.cancelLabel}
      tone={pending.tone}
      onCancel={() => close(false)}
      onConfirm={() => close(true)}
    />
  ) : null;

  return { confirm, dialog };
}
