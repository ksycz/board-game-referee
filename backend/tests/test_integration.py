"""Integration test: ingest PDF and retrieve passages (no LLM needed)."""

from agents.ingestion_agent import IngestionAgent
from agents.retrieval_agent import RetrievalAgent
from services.conversation import retrieval_query
from services.vector_store import VectorStore


def test_ingest_and_retrieve_first_turn_attack_rule(sample_pdf, isolated_data):
    vs = VectorStore()
    ingestion = IngestionAgent(vs)
    retrieval = RetrievalAgent(vs)

    rulebook_id = "test-book"
    result = ingestion.ingest(rulebook_id, sample_pdf)
    assert result["pages_extracted"] == 4
    assert result["chunks_indexed"] >= 4

    hits = retrieval.retrieve(rulebook_id, "Can I attack on the first turn?", top_k=3)
    assert hits["chunks_found"] > 0
    pages = {c.page for c in hits["chunks"]}
    texts = " ".join(c.text.lower() for c in hits["chunks"])
    assert "first turn" in texts or 2 in pages


def test_follow_up_retrieval_uses_conversation_context(sample_pdf, isolated_data):
    vs = VectorStore()
    ingestion = IngestionAgent(vs)
    retrieval = RetrievalAgent(vs)

    rulebook_id = "test-book"
    ingestion.ingest(rulebook_id, sample_pdf)

    history = [
        {"role": "user", "content": "Can I attack on my turn?"},
        {"role": "assistant", "content": "Yes, during the attack phase."},
    ]
    query = retrieval_query("What about the first turn?", history)
    hits = retrieval.retrieve(rulebook_id, query, top_k=3)

    assert hits["chunks_found"] > 0
    texts = " ".join(chunk.text.lower() for chunk in hits["chunks"])
    assert "first turn" in texts
