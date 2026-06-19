"""Tests for conversation helpers."""

from services.conversation import format_history_block, retrieval_query, trim_history


def test_retrieval_query_includes_recent_user_messages():
    history = [
        {"role": "user", "content": "Can I attack on my turn?"},
        {"role": "assistant", "content": "Yes, during the attack phase."},
    ]
    query = retrieval_query("What about on the first turn?", history)
    assert "attack on my turn" in query
    assert "first turn" in query


def test_retrieval_query_without_history_returns_question():
    assert retrieval_query("Can I pass?", []) == "Can I pass?"


def test_format_history_block_labels_roles():
    history = [
        {"role": "user", "content": "Can I draw twice?"},
        {"role": "assistant", "content": "No, one draw per turn."},
    ]
    block = format_history_block(history)
    assert "Player: Can I draw twice?" in block
    assert "Referee: No, one draw per turn." in block


def test_format_history_block_empty():
    assert format_history_block([]) == ""


def test_trim_history_keeps_most_recent_messages():
    history = [{"role": "user", "content": f"message {i}"} for i in range(20)]
    trimmed = trim_history(history, max_messages=5)
    assert len(trimmed) == 5
    assert trimmed[0]["content"] == "message 15"
