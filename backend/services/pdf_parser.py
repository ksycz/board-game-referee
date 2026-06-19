"""Extract text from rulebook PDFs with page-level metadata."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import fitz


@dataclass(frozen=True)
class PageChunk:
    page: int
    text: str
    section_hint: str | None = None


def _section_hint(text: str) -> str | None:
    """Best-effort heading from the first non-empty line on a page."""
    for line in text.splitlines():
        cleaned = line.strip()
        if not cleaned:
            continue
        if len(cleaned) <= 80:
            return cleaned
        break
    return None


def extract_pages(pdf_path: Path) -> list[PageChunk]:
    doc = fitz.open(pdf_path)
    chunks: list[PageChunk] = []
    try:
        for index in range(len(doc)):
            page = doc[index]
            text = page.get_text("text").strip()
            if not text:
                continue
            chunks.append(
                PageChunk(
                    page=index + 1,
                    text=text,
                    section_hint=_section_hint(text),
                )
            )
    finally:
        doc.close()
    return chunks
