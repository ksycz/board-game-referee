"""Shared helpers for rulebook PDF uploads."""

from __future__ import annotations

import re
from pathlib import Path

from config import MAX_PDF_BYTES


def safe_stored_filename(name: str) -> str:
    """Return a single-segment filename safe for storage under RULEBOOKS_DIR."""
    base = Path(name).name
    cleaned = re.sub(r"[^\w.\-]+", "_", base).strip("._")
    return cleaned or "rulebook.pdf"


def ensure_pdf_size(content: bytes, *, max_bytes: int | None = None) -> None:
    limit = max_bytes if max_bytes is not None else MAX_PDF_BYTES
    if len(content) > limit:
        mb = limit // (1024 * 1024)
        raise ValueError(f"PDF is too large (max {mb} MB).")


__all__ = ["MAX_PDF_BYTES", "ensure_pdf_size", "safe_stored_filename"]
