"""Extract text from rulebook PDFs and split into searchable chunks."""

from __future__ import annotations

import logging
import os
import re
import shutil
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import fitz

from config import (
    CHUNK_MAX_CHARS,
    CHUNK_MIN_CHARS,
    OCR_DPI,
    OCR_FALLBACK,
    OCR_LANGUAGE,
    OCR_MIN_INDEXABLE_CHARS,
)

logger = logging.getLogger(__name__)
_tesseract_missing_logged = False
_TESSERACT_SEARCH_DIRS = (
    "/opt/homebrew/bin",
    "/usr/local/bin",
)


def ensure_tesseract_path() -> bool:
    """Put a Homebrew or system Tesseract install on PATH if needed."""
    if shutil.which("tesseract"):
        return True

    path_entries = os.environ.get("PATH", "").split(os.pathsep)
    for directory in _TESSERACT_SEARCH_DIRS:
        if directory in path_entries:
            continue
        if (Path(directory) / "tesseract").is_file():
            os.environ["PATH"] = f"{directory}{os.pathsep}{os.environ.get('PATH', '')}"
            break
    return shutil.which("tesseract") is not None


@dataclass(frozen=True)
class TextChunk:
    page: int
    text: str
    section_hint: str | None = None


# Backward-compatible alias used elsewhere in the codebase.
PageChunk = TextChunk

ProgressCallback = Callable[[dict[str, Any]], None]


def _emit_progress(on_progress: ProgressCallback | None, event: dict[str, Any]) -> None:
    if on_progress is not None:
        on_progress(event)


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


def _is_junk_paragraph(text: str) -> bool:
    """Drop page numbers, headers without body text, and other PDF noise."""
    stripped = text.strip()
    if not stripped:
        return True
    if re.fullmatch(r"[\d\s\-–—]+", stripped):
        return True
    if re.fullmatch(r"\d{1,3}", stripped):
        return True

    words = re.findall(r"\w+", stripped)
    has_sentence = any(mark in stripped for mark in ".?!")
    if len(words) < 3 and not has_sentence:
        return True
    if len(stripped) < 24 and len(words) < 5 and not has_sentence:
        return True
    return False


def _extract_page_text(page: fitz.Page) -> str:
    """Extract page text in reading order (top-to-bottom, left-to-right)."""
    blocks = page.get_text("blocks")
    lines: list[str] = []
    for block in sorted(blocks, key=lambda item: (round(item[1]), round(item[0]))):
        if block[6] != 0:
            continue
        text = block[4].strip()
        if text:
            lines.append(text)
    if lines:
        return "\n".join(lines)
    return page.get_text("text")


def _indexable_char_count(text: str) -> int:
    """Approximate how much non-junk text a page contributes to retrieval."""
    total = 0
    for _, paragraph in _parse_page_segments(text):
        if not _is_junk_paragraph(paragraph):
            total += len(paragraph.strip())
    return total


def _chunk_has_substance(chunk: TextChunk) -> bool:
    """True when a chunk looks like real rules text, not layout noise."""
    words = re.findall(r"\w+", chunk.text)
    has_sentence = any(mark in chunk.text for mark in ".?!")
    if len(words) >= 8:
        return True
    return has_sentence and len(words) >= 5 and len(chunk.text) >= 30


def _page_needs_ocr(text: str, chunks: list[TextChunk]) -> bool:
    """True when normal extraction left little usable rules text."""
    if any(_chunk_has_substance(chunk) for chunk in chunks):
        return False
    if chunks and sum(len(chunk.text) for chunk in chunks) >= OCR_MIN_INDEXABLE_CHARS:
        return False
    return _indexable_char_count(text) < OCR_MIN_INDEXABLE_CHARS


def _extract_page_text_ocr(page: fitz.Page) -> str | None:
    """OCR a page image when Tesseract is available; otherwise return None."""
    global _tesseract_missing_logged
    if not ensure_tesseract_path():
        if not _tesseract_missing_logged:
            logger.warning(
                "OCR_FALLBACK is enabled but Tesseract was not found on PATH "
                "(install with Homebrew: brew install tesseract)",
            )
            _tesseract_missing_logged = True
        return None
    try:
        textpage = page.get_textpage_ocr(
            language=OCR_LANGUAGE,
            full=True,
            dpi=OCR_DPI,
        )
        text = page.get_text("text", textpage=textpage).strip()
        return text or None
    except RuntimeError as exc:
        if "Tesseract" in str(exc) and not _tesseract_missing_logged:
            logger.warning(
                "OCR_FALLBACK is enabled but Tesseract is not installed: %s",
                exc,
            )
            _tesseract_missing_logged = True
        return None
    except Exception:
        logger.exception("OCR failed for page %s", page.number + 1)
        return None


def _extract_page_chunks(
    page: fitz.Page,
    page_number: int,
    *,
    max_chars: int,
    min_chars: int,
    total_pages: int = 0,
    on_progress: ProgressCallback | None = None,
) -> tuple[list[TextChunk], bool]:
    """Extract chunks for one page, optionally falling back to OCR."""
    text = _extract_page_text(page)
    page_chunks = chunk_page_text(
        page_number,
        text,
        max_chars=max_chars,
        min_chars=min_chars,
    )
    used_ocr = False
    if OCR_FALLBACK and _page_needs_ocr(text, page_chunks):
        _emit_progress(
            on_progress,
            {
                "phase": "scanning",
                "page": page_number,
                "total_pages": total_pages,
            },
        )
        ocr_text = _extract_page_text_ocr(page)
        if ocr_text and _indexable_char_count(ocr_text) > _indexable_char_count(text):
            text = ocr_text
            page_chunks = chunk_page_text(
                page_number,
                text,
                max_chars=max_chars,
                min_chars=min_chars,
            )
            used_ocr = True
    return page_chunks, used_ocr


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

        if _is_junk_paragraph(paragraph):
            continue

        if len(paragraph) > max_chars:
            flush()
            for piece in _split_by_sentences(paragraph, max_chars):
                chunks.append(TextChunk(page=page, text=piece, section_hint=current_section))
            continue

        extra = len(paragraph) + (2 if current_parts else 0)
        if current_len + extra > max_chars and current_len >= min_chars:
            flush()

        current_parts.append(paragraph)
        current_len += extra

    flush()
    return [chunk for chunk in chunks if not _is_junk_paragraph(chunk.text)]


def extract_chunks(
    pdf_path: Path,
    *,
    max_chars: int = CHUNK_MAX_CHARS,
    min_chars: int = CHUNK_MIN_CHARS,
    on_progress: ProgressCallback | None = None,
) -> tuple[list[TextChunk], int, int]:
    """Extract searchable chunks from a PDF.

    Returns (chunks, pages_with_text, ocr_pages).
    """
    doc = fitz.open(pdf_path)
    chunks: list[TextChunk] = []
    pages_with_text = 0
    ocr_pages = 0
    total_pages = len(doc)
    if OCR_FALLBACK:
        ensure_tesseract_path()
    _emit_progress(
        on_progress,
        {"phase": "starting", "page": 0, "total_pages": total_pages},
    )
    try:
        for index in range(total_pages):
            page_number = index + 1
            _emit_progress(
                on_progress,
                {
                    "phase": "reading",
                    "page": page_number,
                    "total_pages": total_pages,
                },
            )
            page = doc[index]
            page_chunks, used_ocr = _extract_page_chunks(
                page,
                page_number,
                max_chars=max_chars,
                min_chars=min_chars,
                total_pages=total_pages,
                on_progress=on_progress,
            )
            if used_ocr:
                ocr_pages += 1
            if page_chunks:
                pages_with_text += 1
                chunks.extend(page_chunks)
    finally:
        doc.close()
    return chunks, pages_with_text, ocr_pages


def extract_pages(pdf_path: Path) -> list[TextChunk]:
    """Backward-compatible wrapper that returns chunks only."""
    chunks, _, _ = extract_chunks(pdf_path)
    return chunks
