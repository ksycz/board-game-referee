"""Generate starter questions from indexed rulebook content."""

from __future__ import annotations

import re

from services.vector_store import StoredChunk, VectorStore

DEFAULT_QUESTIONS = [
    "Can I play this card during another player's turn?",
    "What can I do on my turn?",
    "How do I win the game?",
]

SECTION_QUESTIONS: list[tuple[str, str]] = [
    ("setup", "How do I set up the game?"),
    ("turn", "What can I do on my turn?"),
    ("combat", "How does combat work?"),
    ("attack", "When can I attack?"),
    ("play cards", "When can I play cards?"),
    ("card play", "When can I play cards?"),
    ("special", "How do special cards work?"),
    ("win", "How do I win the game?"),
    ("victory", "How do I win the game?"),
    ("scoring", "How is scoring calculated?"),
    ("end of the round", "What happens at the end of the round?"),
]

TEXT_QUESTIONS: list[tuple[str, str]] = [
    ("first turn", "Can I do that on the first turn?"),
    ("another player", "Can I act during another player's turn?"),
    ("draw", "How many cards do I draw?"),
    ("if there is a tie", "What happens on a tie?"),
]


def _looks_like_component_list(section_hint: str) -> bool:
    """Skip component inventory lines like '12 ORIGAMI CARDS (CORAL)'."""
    if re.match(r"^\d+\s", section_hint):
        return True
    if re.search(r"\(\w+\)\s*$", section_hint):
        return True
    if re.search(r"\d+\s+\w+\s+cards\b", section_hint, re.IGNORECASE):
        return True
    return False


def _is_meaningful_section(section_hint: str) -> bool:
    """Ignore PDF noise like single letters, numbers, or very short labels."""
    cleaned = section_hint.strip().rstrip(".")
    if len(cleaned) < 4:
        return False
    words = [word for word in re.split(r"\s+", cleaned) if word]
    if not words:
        return False
    return any(len(re.sub(r"[^a-zA-Z]", "", word)) >= 3 for word in words)


def _question_from_section(section_hint: str | None) -> str | None:
    if not section_hint or not _is_meaningful_section(section_hint):
        return None
    lowered = section_hint.lower()
    if _looks_like_component_list(section_hint):
        return None
    for keyword, question in SECTION_QUESTIONS:
        if keyword in lowered:
            return question
    return None


def _question_from_text(text: str) -> str | None:
    lowered = text.lower()
    for keyword, question in TEXT_QUESTIONS:
        if keyword in lowered:
            return question
    return None


def suggest_questions(chunks: list[StoredChunk], *, limit: int = 3) -> list[str]:
    """Build a short list of starter questions from early rulebook chunks."""
    suggestions: list[str] = []
    seen: set[str] = set()

    def add(question: str | None) -> None:
        if not question or question in seen or len(suggestions) >= limit:
            return
        suggestions.append(question)
        seen.add(question)

    ordered = sorted(chunks, key=lambda chunk: (chunk.page, chunk.chunk_id))
    for chunk in ordered:
        add(_question_from_section(chunk.section_hint))
        add(_question_from_text(chunk.text))

    for question in DEFAULT_QUESTIONS:
        add(question)
        if len(suggestions) >= limit:
            break

    return suggestions[:limit]


def example_questions_for_rulebook(
    vector_store: VectorStore, rulebook_id: str, *, limit: int = 3
) -> list[str]:
    chunks = vector_store.list_chunks(rulebook_id)
    return suggest_questions(chunks, limit=limit)
