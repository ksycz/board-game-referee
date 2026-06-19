"""Benchmark queries with expected source pages for retrieval tuning."""

from __future__ import annotations

from dataclasses import dataclass

from services.conversation import retrieval_query


@dataclass(frozen=True)
class BenchmarkCase:
    name: str
    query: str
    expected_pages: list[int]
    history: list[dict] | None = None

    def search_query(self) -> str:
        if self.history:
            return retrieval_query(self.query, self.history)
        return self.query


SAMPLE_RULEBOOK_CASES: list[BenchmarkCase] = [
    BenchmarkCase(
        name="setup_draw",
        query="How many cards does each player draw at setup?",
        expected_pages=[1],
    ),
    BenchmarkCase(
        name="first_turn_attack",
        query="Can I attack on the first turn?",
        expected_pages=[2],
    ),
    BenchmarkCase(
        name="combat_roll",
        query="What die roll wins a fight?",
        expected_pages=[3],
    ),
    BenchmarkCase(
        name="interrupt_timing",
        query="When can I play an interrupt card during another player's turn?",
        expected_pages=[4],
    ),
    BenchmarkCase(
        name="follow_up_first_turn",
        query="What about on the first turn?",
        expected_pages=[2],
        history=[
            {"role": "user", "content": "Can I attack on my turn?"},
            {"role": "assistant", "content": "Yes, during the attack phase."},
        ],
    ),
]
