"""Extract text from rulebook PDFs and split into searchable chunks."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import fitz

from config import CHUNK_MAX_CHARS, CHUNK_MIN_CHARS


@dataclass(frozen=True)
class TextChunk:
    page: int
    text: str
    section_hint: str | None = None


# Backward-compatible alias used elsewhere in the codebase.
PageChunk = TextChunk


def _is_heading(line: str) -> bool:
    """Best-effort heading detection for rulebook layout."""
    cleaned = line.strip()
    if not cleaned or len(cleaned) > 80:
        return False
    if cleaned.endswith((".", "!", "?")):
        return False

    words = cleaned.split()
    if not words or len(words) > 10:
        return False
    if all(len(word) <= 2 for word in words):
        return False
    if cleaned.isupper():
        return True

    title_like = all(word[0].isupper() for word in words if word)
    return title_like and len(words) <= 6


def _split_by_sentences(text: str, max_chars: int) -> list[str]:
    if len(text) <= max_chars:
        return [text]

    parts: list[str] = []
    current: list[str] = []
    current_len = 0

    for sentence in re.split(r"(?<=[.!?])\s+", text):
        if len(sentence) > max_chars:
            if current:
                parts.append(" ".join(current))
                current = []
                current_len = 0

            words = sentence.split()
            chunk_words: list[str] = []
            chunk_len = 0
            for word in words:
                extra = len(word) + (1 if chunk_words else 0)
                if chunk_len + extra > max_chars and chunk_words:
                    parts.append(" ".join(chunk_words))
                    chunk_words = [word]
                    chunk_len = len(word)
                else:
                    chunk_words.append(word)
                    chunk_len += extra
            if chunk_words:
                parts.append(" ".join(chunk_words))
            continue

        extra = len(sentence) + (1 if current else 0)
        if current_len + extra > max_chars and current:
            parts.append(" ".join(current))
            current = [sentence]
            current_len = len(sentence)
        else:
            current.append(sentence)
            current_len += extra

    if current:
        parts.append(" ".join(current))
    return parts


def _parse_page_segments(text: str) -> list[tuple[str | None, str]]:
    """Split a page into (section_hint, paragraph) segments."""
    segments: list[tuple[str | None, str]] = []
    section: str | None = None
    buffer: list[str] = []

    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            if buffer:
                segments.append((section, " ".join(buffer)))
                buffer = []
            continue

        if _is_heading(stripped):
            if buffer:
                segments.append((section, " ".join(buffer)))
                buffer = []
            section = stripped
            continue

        buffer.append(stripped)

    if buffer:
        segments.append((section, " ".join(buffer)))

    return segments


def chunk_page_text(
    page: int,
    text: str,
    *,
    max_chars: int = CHUNK_MAX_CHARS,
    min_chars: int = CHUNK_MIN_CHARS,
) -> list[TextChunk]:
    """Split one page into retrieval-sized chunks while keeping page metadata."""
    stripped = text.strip()
    if not stripped:
        return []

    segments = _parse_page_segments(stripped)
    if not segments:
        return [TextChunk(page=page, text=stripped)]

    chunks: list[TextChunk] = []
    current_section: str | None = None
    current_parts: list[str] = []
    current_len = 0

    def flush() -> None:
        nonlocal current_parts, current_len
        if not current_parts:
            return
        chunks.append(
            TextChunk(
                page=page,
                text="\n\n".join(current_parts),
                section_hint=current_section,
            )
        )
        current_parts = []
        current_len = 0

    for section, paragraph in segments:
        if section is not None:
            if current_parts and section != current_section:
                flush()
            current_section = section

        if len(paragraph) > max_chars:
            flush()
            for piece in _split_by_sentences(paragraph, max_chars):
                chunks.append(
                    TextChunk(page=page, text=piece, section_hint=current_section)
                )
            continue

        extra = len(paragraph) + (2 if current_parts else 0)
        if current_len + extra > max_chars and current_len >= min_chars:
            flush()

        current_parts.append(paragraph)
        current_len += extra

    flush()
    return chunks


def extract_chunks(pdf_path: Path) -> tuple[list[TextChunk], int]:
    """Extract searchable chunks from a PDF and return (chunks, page_count)."""
    doc = fitz.open(pdf_path)
    chunks: list[TextChunk] = []
    pages_with_text = 0
    try:
        for index in range(len(doc)):
            page = doc[index]
            text = page.get_text("text")
            page_chunks = chunk_page_text(index + 1, text)
            if page_chunks:
                pages_with_text += 1
                chunks.extend(page_chunks)
    finally:
        doc.close()
    return chunks, pages_with_text


def extract_pages(pdf_path: Path) -> list[TextChunk]:
    """Backward-compatible wrapper that returns chunks only."""
    chunks, _ = extract_chunks(pdf_path)
    return chunks
