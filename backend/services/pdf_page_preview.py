"""Render rulebook PDF pages as PNG previews."""

from __future__ import annotations

from pathlib import Path

import fitz


def render_page_png(pdf_path: Path, page: int, *, zoom: float = 1.5) -> bytes:
    """Return a PNG image for a 1-based PDF page number."""
    try:
        doc = fitz.open(pdf_path)
    except Exception as exc:
        raise ValueError(f"Could not open PDF: {exc}") from exc
    try:
        if page < 1 or page > len(doc):
            raise ValueError(f"Page {page} out of range (1-{len(doc)})")
        pixmap = doc[page - 1].get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        return pixmap.tobytes("png")
    finally:
        doc.close()
