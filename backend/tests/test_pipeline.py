"""Tests for the referee pipeline."""

from __future__ import annotations

from agents.pipeline import RefereePipeline
from services.conversation import retrieval_query
from services.vector_store import StoredChunk


class CapturingReferee:
    def __init__(self) -> None:
        self.question: str | None = None
        self.history: list[dict] | None = None
        self.chunks: list[StoredChunk] | None = None

    def rule_on(self, question: str, chunks: list[StoredChunk], history: list[dict] | None = None) -> dict:
        self.question = question
        self.history = history
        self.chunks = chunks
        quote = chunks[0].text[:40] if chunks else "none"
        page = chunks[0].page if chunks else 1
        return {
            "agent": "referee",
            "ruling": f"Ruling for {question}",
            "confidence": "high",
            "reasoning": "test",
            "citations": [{"page": page, "quote": quote}],
            "needs_clarification": False,
            "clarification_question": None,
        }


def test_pipeline_ask_passes_trimmed_history_to_referee(sample_pdf, isolated_data):
    pipeline = RefereePipeline()
    upload = pipeline.upload_rulebook(
        "Test Game", "test.pdf", sample_pdf.read_bytes(), original_filename="sample-rulebook.pdf"
    )
    book_id = upload["rulebook"].id

    long_history = [{"role": "user", "content": f"question {i}"} for i in range(20)]
    long_history.extend(
        [
            {"role": "assistant", "content": "Earlier ruling."},
            {"role": "user", "content": "Can I attack on my turn?"},
            {"role": "assistant", "content": "Yes, during your turn."},
        ]
    )

    capturing = CapturingReferee()
    pipeline._referee = capturing

    result = pipeline.ask(book_id, "What about the first turn?", history=long_history)

    assert capturing.question == "What about the first turn?"
    assert capturing.history is not None
    assert len(capturing.history) == 12
    assert capturing.history[-2]["content"] == "Can I attack on my turn?"
    assert result["ruling"]["ruling"] == "Ruling for What about the first turn?"


def test_pipeline_ask_retrieves_with_follow_up_query(sample_pdf, isolated_data):
    pipeline = RefereePipeline()
    upload = pipeline.upload_rulebook(
        "Test Game", "test.pdf", sample_pdf.read_bytes(), original_filename="sample-rulebook.pdf"
    )
    book_id = upload["rulebook"].id

    capturing = CapturingReferee()
    pipeline._referee = capturing

    history = [
        {"role": "user", "content": "Can I attack on my turn?"},
        {"role": "assistant", "content": "Yes, during the attack phase."},
    ]
    pipeline.ask(book_id, "What about the first turn?", history=history)

    assert capturing.chunks is not None
    assert capturing.chunks
    combined = " ".join(chunk.text.lower() for chunk in capturing.chunks)
    assert "first turn" in combined


def test_retrieval_query_improves_follow_up_hits(sample_pdf, isolated_data):
    pipeline = RefereePipeline()
    upload = pipeline.upload_rulebook(
        "Test Game", "test.pdf", sample_pdf.read_bytes(), original_filename="sample-rulebook.pdf"
    )
    book_id = upload["rulebook"].id

    history = [
        {"role": "user", "content": "Can I attack on my turn?"},
        {"role": "assistant", "content": "Yes, during the attack phase."},
    ]
    follow_up_query = retrieval_query("What about the first turn?", history)

    hits = pipeline.retrieval.retrieve(book_id, follow_up_query, 3)
    texts = " ".join(chunk.text.lower() for chunk in hits["chunks"])
    assert "first turn" in texts
