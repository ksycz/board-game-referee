"""Tests for referee agent prompt construction."""

from unittest.mock import MagicMock

from agents.referee_agent import RefereeAgent
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
