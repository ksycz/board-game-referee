"""Tests for referee agent prompt construction."""

from unittest.mock import MagicMock

import pytest

from agents.referee_agent import (
    DISPUTE_SYSTEM_PROMPT,
    QUICK_REFERENCE_SYSTEM_PROMPT,
    RefereeAgent,
)
from services.vector_store import StoredChunk

VALID_RESPONSE = """{
  "ruling": "No, not on the first turn.",
  "confidence": "high",
  "reasoning": "Turn order section forbids it.",
  "citations": [{"page": 2, "quote": "may not attack on the first turn"}],
  "needs_clarification": false,
  "clarification_question": null
}"""


def test_rule_on_includes_conversation_history_in_prompt():
    mock_client = MagicMock()
    mock_message = MagicMock()
    mock_message.content = [MagicMock(text=VALID_RESPONSE)]
    mock_client.messages.create.return_value = mock_message

    agent = RefereeAgent(api_key="test-key")
    agent.client = mock_client

    chunks = [
        StoredChunk(
            chunk_id="1",
            page=2,
            text="You may not attack on the first turn.",
            section_hint="Turn Order",
        )
    ]
    history = [
        {"role": "user", "content": "Can I attack on my turn?"},
        {"role": "assistant", "content": "Yes, during your turn."},
    ]

    result = agent.rule_on("What about the first turn?", chunks, history)

    content = mock_client.messages.create.call_args.kwargs["messages"][0]["content"]
    assert "Conversation so far:" in content
    assert "Player: Can I attack on my turn?" in content
    assert "Referee: Yes, during your turn." in content
    assert "Current question: What about the first turn?" in content
    assert result["ruling"] == "No, not on the first turn."


DISPUTE_RESPONSE = """{
  "ruling": "Player A is correct.",
  "favors": "player_a",
  "player_a_assessment": "Matches the timing rule.",
  "player_b_assessment": "Misreads when the phase ends.",
  "confidence": "high",
  "reasoning": "The rule says immediately after combat.",
  "citations": [{"page": 2, "quote": "immediately after combat ends"}],
  "needs_clarification": false,
  "clarification_question": null
}"""


def test_rule_dispute_includes_both_players_in_prompt():
    mock_client = MagicMock()
    mock_message = MagicMock()
    mock_message.content = [MagicMock(text=DISPUTE_RESPONSE)]
    mock_client.messages.create.return_value = mock_message

    agent = RefereeAgent(api_key="test-key")
    agent.client = mock_client

    chunks = [
        StoredChunk(
            chunk_id="1",
            page=2,
            text="Play this card immediately after combat ends.",
            section_hint="Timing",
        )
    ]

    result = agent.rule_dispute(
        "Can I play this after combat?",
        "Yes, right after combat ends.",
        "No, only on my next turn.",
        chunks,
    )

    kwargs = mock_client.messages.create.call_args.kwargs
    assert kwargs["system"] == DISPUTE_SYSTEM_PROMPT
    content = kwargs["messages"][0]["content"]
    assert "Situation in dispute: Can I play this after combat?" in content
    assert "Player A says: Yes, right after combat ends." in content
    assert "Player B says: No, only on my next turn." in content
    assert result["favors"] == "player_a"


QUICK_REFERENCE_RESPONSE = """{
  "setup": ["Each player draws 5 cards."],
  "turn_order": ["Turn: take one action."],
  "key_actions": [{"name": "Attack", "summary": "Discard a card and roll the die."}],
  "win_condition": "Be the last player standing.",
  "citations": [{"page": 1, "section": "Setup"}]
}"""


def test_summarize_quick_reference_parses_structured_json():
    mock_client = MagicMock()
    mock_message = MagicMock()
    mock_message.content = [MagicMock(text=QUICK_REFERENCE_RESPONSE)]
    mock_client.messages.create.return_value = mock_message

    agent = RefereeAgent(api_key="test-key")
    agent.quick_reference_client = mock_client

    chunks = [
        StoredChunk(
            chunk_id="1",
            page=1,
            text="Each player draws 5 cards.",
            section_hint="Setup",
        )
    ]

    result = agent.summarize_quick_reference(chunks)

    kwargs = mock_client.messages.create.call_args.kwargs
    assert kwargs["system"] == QUICK_REFERENCE_SYSTEM_PROMPT
    content = kwargs["messages"][0]["content"]
    assert "Each player draws 5 cards." in content
    assert result["agent"] == "quick_reference"
    assert result["setup"] == ["Each player draws 5 cards."]
    assert result["win_condition"] == "Be the last player standing."


def test_summarize_quick_reference_requires_chunks():
    agent = RefereeAgent(api_key="test-key")
    with pytest.raises(ValueError):
        agent.summarize_quick_reference([])
