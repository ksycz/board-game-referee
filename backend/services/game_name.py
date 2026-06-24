"""Derive a human-readable game name from uploads and rulebook PDFs."""

from __future__ import annotations

import re
from pathlib import Path

import fitz

_LANGUAGE_SUFFIX_RE = re.compile(
    r"_(?:ENG?|DE|FR|ES|PL|IT|NL|CS|HU|PT)(?:_[vV]\d+)?$", re.IGNORECASE
)
_VERSION_SUFFIX_RE = re.compile(r"[_\s-]+v\d+$", re.IGNORECASE)
_CATALOG_CODE_RE = re.compile(r"^[A-Z]{2,}\d{3,}$", re.IGNORECASE)

_FILENAME_STOPWORDS = frozenset({
    "en",
    "eng",
    "de",
    "fr",
    "es",
    "web",
    "rulebook",
    "rules",
    "final",
    "print",
    "play",
})

_GENERIC_TITLES = frozenset({
    "game",
    "the game",
    "board game",
    "the board game",
    "card game",
    "the card game",
})

# "The" must be capitalized — avoids matching prose like "In the game, you…"
_TITLE_PATTERNS = [
    re.compile(r"ready to play (The [^!\n]+)!"),
    re.compile(r"\bIn (The [\w\s']+?),"),
    re.compile(r"\bWelcome to (The [\w\s']+)!"),
    re.compile(r"\brules for (The [\w\s']+)"),
]
_IS_A_GAME_PATTERN = re.compile(r"^([A-Z][\w'-]{2,})\s+is a game\b", re.MULTILINE)


def looks_like_filename(name: str) -> bool:
    """True when the stored name is probably an unedited upload filename."""
    if "_" in name:
        return True
    if _LANGUAGE_SUFFIX_RE.search(name):
        return True
    if _VERSION_SUFFIX_RE.search(name):
        return True
    return False


def is_plausible_game_title(title: str) -> bool:
    """False for generic phrases that often appear in rulebook body text."""
    normalized = re.sub(r"\s+", " ", title).strip().lower()
    if not normalized or len(normalized) < 3:
        return False
    if normalized in _GENERIC_TITLES:
        return False
    if normalized.startswith("the ") and normalized[4:] in _GENERIC_TITLES:
        return False
    return True


def prettify_filename_stem(stem: str) -> str:
    """Turn upload filenames into readable fallback titles."""
    hyphenated = re.split(r"[-_]+", stem.strip())
    meaningful = [
        part
        for part in hyphenated
        if part
        and not _CATALOG_CODE_RE.match(part)
        and part.lower() not in _FILENAME_STOPWORDS
        and not _VERSION_SUFFIX_RE.search(part)
        and not _LANGUAGE_SUFFIX_RE.search(part)
    ]
    if len(meaningful) == 1:
        return meaningful[0].capitalize()

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
    # Drop leading publisher/catalog tokens (e.g. ARFG007).
    while words and _CATALOG_CODE_RE.match(words[0]):
        words = words[1:]
    # Drop trailing rulebook / language tokens.
    while words and words[-1].lower() in _FILENAME_STOPWORDS:
        words = words[:-1]

    if not words:
        return stem.replace("_", " ").strip()
    return " ".join(word.capitalize() for word in words)


def extract_game_name_from_pdf(pdf_path: Path, *, max_pages: int = 5) -> str | None:
    """Read the game title from PDF metadata or early rulebook text."""
    doc = fitz.open(pdf_path)
    try:
        metadata_title = (doc.metadata or {}).get("title", "").strip()
        if (
            metadata_title
            and len(metadata_title) >= 3
            and not metadata_title.lower().endswith(".pdf")
        ):
            normalized = _normalize_title(metadata_title)
            if is_plausible_game_title(normalized):
                return normalized

        text = "\n".join(doc[i].get_text("text") for i in range(min(max_pages, len(doc))))

        match = _IS_A_GAME_PATTERN.search(text)
        if match:
            normalized = _normalize_title(match.group(1))
            if is_plausible_game_title(normalized):
                return normalized

        for pattern in _TITLE_PATTERNS:
            match = pattern.search(text)
            if match:
                normalized = _normalize_title(match.group(1))
                if is_plausible_game_title(normalized):
                    return normalized
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
    if extracted and is_plausible_game_title(extracted):
        return extracted

    stem = original_filename.rsplit(".", 1)[0]
    return prettify_filename_stem(stem)


def original_filename_from_stored(stored_filename: str) -> str:
    """Strip the upload UUID prefix from a stored rulebook filename."""
    if len(stored_filename) > 37 and stored_filename[36] == "_":
        return stored_filename[37:]
    return stored_filename


def _normalize_title(title: str) -> str:
    title = re.sub(r"\s+", " ", title).strip(" .,:;")
    if not title:
        return title
    if title.lower().startswith("the "):
        return "The " + title[4:].strip()
    return title[0].upper() + title[1:]
