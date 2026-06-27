"""Deterministic referee stub for Playwright smoke tests (no Anthropic API)."""

from __future__ import annotations

from services.vector_store import StoredChunk

CLARIFY_TRIGGER = "clarify:"


def install_stub_referee(pipeline) -> None:
    pipeline._referee = StubReferee()


class StubReferee:
    def rule_on(
        self,
        question: str,
        chunks: list[StoredChunk],
        history: list[dict] | None = None,
    ) -> dict:
        if not chunks:
            return {
                "agent": "referee",
                "ruling": "No matching rule text was retrieved.",
                "confidence": "low",
                "reasoning": "Stub referee had no retrieved passages.",
                "citations": [],
                "needs_clarification": False,
                "clarification_question": None,
            }

        if CLARIFY_TRIGGER in question.lower() and not history:
            return {
                "agent": "referee",
                "ruling": "I need one detail before I can rule on that.",
                "confidence": "medium",
                "reasoning": "Stub referee requested clarification.",
                "citations": [],
                "needs_clarification": True,
                "clarification_question": "How many players are at the table?",
            }

        page, quote, section = _grounded_citation(chunks, "first turn")
        return {
            "agent": "referee",
            "ruling": "No, you may not attack on the first turn.",
            "confidence": "high",
            "reasoning": "Turn order section forbids attacking on the first turn.",
            "citations": [{"page": page, "quote": quote, "section": section}],
            "needs_clarification": False,
            "clarification_question": None,
        }

    def rule_dispute(
        self,
        situation: str,
        player_a: str,
        player_b: str,
        chunks: list[StoredChunk],
        history: list[dict] | None = None,
    ) -> dict:
        base = self.rule_on(situation, chunks, history)
        return {
            **base,
            "favors": "player_a",
            "player_a_assessment": "Matches the retrieved rule text.",
            "player_b_assessment": "Does not match the retrieved rule text.",
        }


def _grounded_citation(
    chunks: list[StoredChunk],
    needle: str,
) -> tuple[int, str, str | None]:
    needle_lower = needle.lower()
    for chunk in chunks:
        text_lower = chunk.text.lower()
        if needle_lower in text_lower:
            idx = text_lower.find(needle_lower)
            quote = chunk.text[idx : idx + len(needle) + 20].strip()
            if len(quote) < len(needle):
                quote = chunk.text[:80].strip()
            return chunk.page, quote, chunk.section_hint

    chunk = chunks[0]
    return chunk.page, chunk.text[:80].strip(), chunk.section_hint
