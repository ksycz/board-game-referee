"""Tests for hybrid vector + keyword retrieval."""

from services.pdf_parser import TextChunk
from services.vector_store import VectorStore, _keyword_score, _query_terms


def test_query_terms_drop_stop_words():
    assert _query_terms("What happens on a tie?") == ["happens", "tie"]
    assert _query_terms("How do I set up the game?") == ["set", "setup"]


def test_query_terms_expand_component_aliases():
    terms = _query_terms("can I grab lucern meeple from the board whenever I want?")
    assert "lantern" in terms
    assert "token" in terms
    assert "courtier" in terms
    assert "take" in terms or "collect" in terms


def test_keyword_score_matches_substrings():
    assert _keyword_score("BOARD SETUP: place the main board", ["set"]) == 1.0
    assert _keyword_score("If there is a tie, the winner is decided", ["tie", "happens"]) == 0.5
    assert _keyword_score("Perform the Courtier action", ["tie"]) == 0.0
    assert _keyword_score("picking up 1 Lantern token from the board", ["pick", "lantern"]) == 1.0


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


def test_search_maps_informal_component_names(isolated_data):
    vs = VectorStore()
    rulebook_id = "lantern-book"
    vs.index_rulebook(
        rulebook_id,
        [
            TextChunk(page=1, text="Historical flavor and setup overview."),
            TextChunk(
                page=11,
                text=(
                    "During the Return Round, the players take turns picking up 1 Lantern token "
                    "from the top of any stack on the main board and putting it on their own "
                    "Domain board."
                ),
                section_hint="RETURN ROUND",
            ),
        ],
    )

    hits = vs.search(
        rulebook_id,
        "can I grab lucern meeple from the board whenever I want?",
        top_k=1,
    )

    assert len(hits) == 1
    assert hits[0].page == 11
    assert "Lantern token" in hits[0].text


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


def test_keyword_search_finds_matching_passages_without_vector_query(isolated_data):
    vs = VectorStore()
    rulebook_id = "keyword-only-book"
    vs.index_rulebook(
        rulebook_id,
        [
            TextChunk(page=1, text="Setup: each player draws five cards at the start."),
            TextChunk(
                page=4,
                text="On your turn, choose one action. You may not attack on the first turn.",
                section_hint="Turn Order",
            ),
        ],
    )

    hits = vs.keyword_search(rulebook_id, "first turn", top_k=3)

    assert len(hits) == 1
    assert hits[0].page == 4
    assert "first turn" in hits[0].text.lower()


def test_keyword_search_skips_number_heavy_junk(isolated_data):
    vs = VectorStore()
    rulebook_id = "keyword-junk-book"
    vs.index_rulebook(
        rulebook_id,
        [
            TextChunk(
                page=5,
                text="14 14 3 11 11 Shuffle the Lantern cards, reveal 3 of them, and lay them face-up.",
            ),
            TextChunk(
                page=8,
                text="At the end of your turn, you may discard one card to draw another from the deck.",
            ),
        ],
    )

    hits = vs.keyword_search(rulebook_id, "discard draw deck", top_k=3)

    assert len(hits) == 1
    assert hits[0].page == 8
    assert hits[0].text.startswith("At the end of your turn")


def test_search_deprioritizes_very_short_chunks(isolated_data):
    vs = VectorStore()
    rulebook_id = "substance-book"
    vs.index_rulebook(
        rulebook_id,
        [
            TextChunk(page=10, text="2", section_hint="Choose Actions"),
            TextChunk(
                page=10,
                text=(
                    "On your turn, choose one action. Each turn has multiple phases "
                    "including choosing actions and resolving effects."
                ),
                section_hint="Choose Actions",
            ),
        ],
    )

    hits = vs.search(rulebook_id, "What are the turn types?", top_k=1)

    assert len(hits) == 1
    assert "choose one action" in hits[0].text.lower()
