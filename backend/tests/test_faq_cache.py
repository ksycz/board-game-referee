"""Tests for per-rulebook FAQ cache."""

from services.faq_cache import (
    FaqCache,
    ask_lookup_key,
    dispute_lookup_key,
    is_cacheable_response,
    normalize_text,
)


def test_normalize_text_collapses_case_and_whitespace():
    assert normalize_text("  Can I   Attack?  ") == "can i attack?"


def test_ask_lookup_key_is_stable_for_equivalent_questions():
    assert ask_lookup_key("Can I attack?") == ask_lookup_key("  can i attack?  ")


def test_dispute_lookup_key_changes_when_arguments_differ():
    first = dispute_lookup_key("Who wins?", "Player A", "Player B")
    second = dispute_lookup_key("Who wins?", "Player A", "Player C")
    assert first != second


def test_put_and_get_round_trip(tmp_path):
    cache = FaqCache(cache_dir=tmp_path / "faq", enabled=True, max_entries=10)
    key = ask_lookup_key("Can I attack on the first turn?")
    response = {
        "mode": "ask",
        "question": "Can I attack on the first turn?",
        "ruling": {"ruling": "No.", "needs_clarification": False},
        "citation_check": {"all_valid": True},
        "retrieval": {"pages": [2], "metrics": {}},
    }

    cache.put("book-1", key, response, label=response["question"], mode="ask")
    cached = cache.get("book-1", key)

    assert cached is not None
    assert cached["cached"] is True
    assert cached["ruling"]["ruling"] == "No."
    assert "cached_at" in cached


def test_does_not_cache_clarification_responses(tmp_path):
    cache = FaqCache(cache_dir=tmp_path / "faq", enabled=True)
    key = ask_lookup_key("Can I attack?")
    response = {
        "ruling": {"ruling": "Maybe.", "needs_clarification": True},
        "citation_check": {"all_valid": True},
    }

    cache.put("book-1", key, response, label="Can I attack?", mode="ask")
    assert cache.get("book-1", key) is None


def test_evicts_oldest_entries_when_over_limit(tmp_path):
    cache = FaqCache(cache_dir=tmp_path / "faq", enabled=True, max_entries=2)
    base = {
        "ruling": {"ruling": "Yes.", "needs_clarification": False},
        "citation_check": {"all_valid": True},
        "retrieval": {"pages": [1]},
    }

    cache.put("book-1", "one", {**base, "question": "one"}, label="one", mode="ask")
    cache.put("book-1", "two", {**base, "question": "two"}, label="two", mode="ask")
    cache.put("book-1", "three", {**base, "question": "three"}, label="three", mode="ask")

    entries = cache.list_entries("book-1")
    assert len(entries) == 2
    labels = {entry["label"] for entry in entries}
    assert "one" not in labels
    assert {"two", "three"} == labels


def test_clear_rulebook_returns_entry_count(tmp_path):
    cache = FaqCache(cache_dir=tmp_path / "faq", enabled=True)
    base = {
        "ruling": {"ruling": "Yes.", "needs_clarification": False},
        "citation_check": {"all_valid": True},
        "retrieval": {"pages": [1]},
    }
    cache.put("book-1", "one", {**base, "question": "one"}, label="one", mode="ask")
    cache.put("book-1", "two", {**base, "question": "two"}, label="two", mode="ask")

    cleared = cache.clear_rulebook("book-1")

    assert cleared == 2
    assert cache.get("book-1", "one") is None
    assert not (tmp_path / "faq" / "book-1.json").exists()


def test_delete_rulebook_removes_cache_file(tmp_path):
    cache = FaqCache(cache_dir=tmp_path / "faq", enabled=True)
    key = ask_lookup_key("Question?")
    cache.put(
        "book-1",
        key,
        {
            "ruling": {"ruling": "Answer.", "needs_clarification": False},
            "citation_check": {"all_valid": True},
            "retrieval": {"pages": [1]},
        },
        label="Question?",
        mode="ask",
    )

    cache.delete_rulebook("book-1")
    assert cache.get("book-1", key) is None
    assert not (tmp_path / "faq" / "book-1.json").exists()


def test_is_cacheable_response_requires_final_ruling():
    assert is_cacheable_response(
        {"ruling": {"ruling": "Yes.", "needs_clarification": False}}
    )
    assert not is_cacheable_response(
        {"ruling": {"ruling": "", "needs_clarification": False}}
    )
