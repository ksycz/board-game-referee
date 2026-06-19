"""Tests for hybrid vector + keyword retrieval."""

from services.pdf_parser import TextChunk
from services.vector_store import VectorStore, _keyword_score, _query_terms


def test_query_terms_drop_stop_words():
    assert _query_terms("What happens on a tie?") == ["happens", "tie"]
    assert _query_terms("How do I set up the game?") == ["set", "setup"]


def test_keyword_score_matches_substrings():
    assert _keyword_score("BOARD SETUP: place the main board", ["set"]) == 1.0
    assert _keyword_score("If there is a tie, the winner is decided", ["tie", "happens"]) == 0.5
    assert _keyword_score("Perform the Courtier action", ["tie"]) == 0.0


def test_search_boosts_keyword_matches(isolated_data):
    vs = VectorStore()
    rulebook_id = "hybrid-book"
    vs.index_rulebook(
        rulebook_id,
        [
            TextChunk(page=1, text="Historical flavor about Portugal and trade routes."),
            TextChunk(
                page=20,
                text="Final scoring. If there is a tie, the winner will be the one who placed more Clan Seals.",
                section_hint="FINAL SCORING",
            ),
        ],
    )

    hits = vs.search(rulebook_id, "What happens on a tie?", top_k=1)

    assert len(hits) == 1
    assert hits[0].page == 20
    assert "tie" in hits[0].text.lower()


def test_reindex_replaces_existing_chunks(isolated_data):
    vs = VectorStore()
    rulebook_id = "reindex-book"
    vs.index_rulebook(
        rulebook_id,
        [TextChunk(page=1, text="Original setup rules about drawing cards.")],
    )
    vs.index_rulebook(
        rulebook_id,
        [TextChunk(page=2, text="Updated turn order with first turn restriction.")],
    )

    hits = vs.search(rulebook_id, "first turn", top_k=1)
    assert len(hits) == 1
    assert hits[0].page == 2
