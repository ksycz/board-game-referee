"""Shared helpers for rulebook PDF uploads."""

from __future__ import annotations

import re
from pathlib import Path

from config import MAX_PDF_BYTES

PDF_MAGIC = b"%PDF"
_READ_CHUNK_SIZE = 1024 * 1024


def safe_stored_filename(name: str) -> str:
    """Return a single-segment filename safe for storage under RULEBOOKS_DIR."""
    base = Path(name).name
    cleaned = re.sub(r"[^\w.\-]+", "_", base).strip("._")
    return cleaned or "rulebook.pdf"


def ensure_pdf_magic(content: bytes) -> None:
    if not content.startswith(PDF_MAGIC):
        raise ValueError("File is not a valid PDF.")


def ensure_pdf_size(content: bytes, *, max_bytes: int | None = None) -> None:
    limit = max_bytes if max_bytes is not None else MAX_PDF_BYTES
    if len(content) > limit:
        mb = limit // (1024 * 1024)
        raise ValueError(f"PDF is too large (max {mb} MB).")


async def read_bounded_pdf_upload(file, *, max_bytes: int | None = None) -> bytes:
    """Read an upload stream with a byte cap and PDF magic-byte validation."""
    limit = max_bytes if max_bytes is not None else MAX_PDF_BYTES
    parts: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(_READ_CHUNK_SIZE)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            mb = limit // (1024 * 1024)
            raise ValueError(f"PDF is too large (max {mb} MB).")
        parts.append(chunk)

    content = b"".join(parts)
    if not content:
        raise ValueError("Empty file")
    ensure_pdf_magic(content)
    return content


__all__ = [
    "MAX_PDF_BYTES",
    "PDF_MAGIC",
    "ensure_pdf_magic",
    "ensure_pdf_size",
    "read_bounded_pdf_upload",
    "safe_stored_filename",
]
