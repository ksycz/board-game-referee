"""Integration test: ingest PDF and retrieve passages (no LLM needed)."""

from pathlib import Path

import pytest

from agents.ingestion_agent import IngestionAgent
from agents.retrieval_agent import RetrievalAgent
from services.vector_store import VectorStore


@pytest.fixture
def sample_pdf(tmp_path: Path) -> Path:
    from tests.fixtures.make_sample_pdf import main

    pdf = tmp_path / "sample-rulebook.pdf"
    # generate into tmp_path by running maker then copying logic inline
    import fitz

    pages = [
        ("Setup", "Each player draws 5 cards. The youngest player goes first."),
        (
            "Turn Order",
            "On your turn you may take one action. You may not attack on the first turn.",
        ),
        (
            "Combat",
            "To attack, discard one card and roll the die. A result of 4 or higher wins.",
        ),
        (
            "Special Cards",
            "Interrupt cards may be played during another player's turn only when that player declares an attack.",
        ),
    ]
    doc = fitz.open()
    for title, body in pages:
        page = doc.new_page()
        page.insert_text((72, 72), title, fontsize=18)
        page.insert_text((72, 110), body, fontsize=12)
    doc.save(pdf)
    doc.close()
    return pdf


def test_ingest_and_retrieve_first_turn_attack_rule(sample_pdf: Path, tmp_path: Path, monkeypatch):
    chroma_dir = tmp_path / "chroma"
    monkeypatch.setattr("config.CHROMA_DIR", chroma_dir)
    monkeypatch.setattr("services.vector_store.CHROMA_DIR", chroma_dir)

    vs = VectorStore()
    ingestion = IngestionAgent(vs)
    retrieval = RetrievalAgent(vs)

    rulebook_id = "test-book"
    result = ingestion.ingest(rulebook_id, sample_pdf)
    assert result["pages_extracted"] == 4
    assert result["chunks_indexed"] == 4

    hits = retrieval.retrieve(rulebook_id, "Can I attack on the first turn?", top_k=3)
    assert hits["chunks_found"] > 0
    pages = {c.page for c in hits["chunks"]}
    texts = " ".join(c.text.lower() for c in hits["chunks"])
    assert "first turn" in texts or 2 in pages
