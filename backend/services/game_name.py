"""Derive a human-readable game name from uploads and rulebook PDFs."""

from __future__ import annotations

import re
from pathlib import Path

import fitz

_LANGUAGE_SUFFIX_RE = re.compile(r"_(?:ENG?|DE|FR|ES|PL|IT|NL|CS|HU|PT)(?:_[vV]\d+)?$", re.IGNORECASE)
_VERSION_SUFFIX_RE = re.compile(r"[_\s-]+v\d+$", re.IGNORECASE)

_TITLE_PATTERNS = [
    re.compile(r"ready to play\s+(The\s+[^!\n]+)!", re.IGNORECASE),
    re.compile(r"\bIn\s+(The\s+[\w\s']+?),", re.IGNORECASE),
    re.compile(r"\bWelcome to\s+(The\s+[\w\s']+)!", re.IGNORECASE),
    re.compile(r"\brules for\s+(The\s+[\w\s']+)", re.IGNORECASE),
]


def looks_like_filename(name: str) -> bool:
    """True when the stored name is probably an unedited upload filename."""
    if "_" in name:
        return True
    if _LANGUAGE_SUFFIX_RE.search(name):
        return True
    if _VERSION_SUFFIX_RE.search(name):
        return True
    return False


def prettify_filename_stem(stem: str) -> str:
    """Turn upload filenames into readable fallback titles."""
    cleaned = stem.strip()
    cleaned = _LANGUAGE_SUFFIX_RE.sub("", cleaned)
    cleaned = _VERSION_SUFFIX_RE.sub("", cleaned)
    cleaned = re.sub(r"[_-]+", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if not cleaned:
        return stem.replace("_", " ").strip()

    words = cleaned.split()
    # Drop a lone leading initial left from names like W_Castle_Duel.
    if len(words) > 1 and len(words[0]) == 1 and words[0].isalpha():
        words = words[1:]

    return " ".join(word.capitalize() for word in words)


def extract_game_name_from_pdf(pdf_path: Path, *, max_pages: int = 5) -> str | None:
    """Read the game title from PDF metadata or early rulebook text."""
    doc = fitz.open(pdf_path)
    try:
        metadata_title = (doc.metadata or {}).get("title", "").strip()
        if metadata_title and len(metadata_title) >= 3 and not metadata_title.lower().endswith(".pdf"):
            return _normalize_title(metadata_title)

        text = "\n".join(doc[i].get_text("text") for i in range(min(max_pages, len(doc))))
        for pattern in _TITLE_PATTERNS:
            match = pattern.search(text)
            if match:
                return _normalize_title(match.group(1))
    finally:
        doc.close()
    return None


def derive_game_name(
    pdf_path: Path,
    original_filename: str,
    user_name: str | None = None,
) -> str:
    """Pick the best display name for a newly uploaded rulebook."""
    if user_name and user_name.strip():
        return user_name.strip()

    extracted = extract_game_name_from_pdf(pdf_path)
    if extracted:
        return extracted

    stem = original_filename.rsplit(".", 1)[0]
    return prettify_filename_stem(stem)


def _normalize_title(title: str) -> str:
    title = re.sub(r"\s+", " ", title).strip(" .,:;")
    if not title:
        return title
    if title.lower().startswith("the "):
        return "The " + title[4:].strip()
    return title[0].upper() + title[1:]
