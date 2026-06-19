"""Tests for citation validation."""

from agents.citation_agent import CitationAgent
from services.vector_store import StoredChunk


def test_citation_valid_when_page_and_quote_match():
    chunks = [
        StoredChunk(chunk_id="1", page=5, text="You may not attack on the first turn.", section_hint=None),
    ]
    ruling = {
        "citations": [{"page": 5, "quote": "may not attack on the first turn"}],
    }
    result = CitationAgent().validate(ruling, chunks)
    assert result["all_valid"] is True
    assert result["issues"] == []


def test_citation_invalid_when_page_not_retrieved():
    chunks = [
        StoredChunk(chunk_id="1", page=3, text="Setup: each player draws 5 cards.", section_hint=None),
    ]
    ruling = {
        "citations": [{"page": 99, "quote": "something"}],
    }
    result = CitationAgent().validate(ruling, chunks)
    assert result["all_valid"] is False
    assert any("Page 99" in issue for issue in result["issues"])
