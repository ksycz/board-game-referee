"""Tests for referee agent prompt construction."""

from unittest.mock import MagicMock

from agents.referee_agent import DISPUTE_SYSTEM_PROMPT, RefereeAgent
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
