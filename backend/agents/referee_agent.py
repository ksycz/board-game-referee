"""Referee agent – answer rules questions using retrieved passages."""

from __future__ import annotations

import json
import re

import anthropic

from config import ANTHROPIC_API_KEY, MODEL
from services.conversation import format_history_block
from services.vector_store import StoredChunk

SYSTEM_PROMPT = """You are a board game rules referee. Your job is to settle rules disputes clearly and fairly.

Rules:
- Answer ONLY from the provided rulebook excerpts. If the excerpts do not contain enough information, say so.
- Give a direct ruling first, then brief reasoning.
- Every factual claim must have a citation with the exact page number from the excerpts.
- Quote the relevant rule text briefly in each citation.
- If multiple interpretations exist, explain them and cite which passage supports each.
- If conversation history is provided, treat the current question as a follow-up and use that context.
- Players often use informal names for components (e.g. "meeple", "piece", "pawn"). Map these to the official terms in the excerpts (e.g. token, courtier, marker) when answering.
- Be concise. Players at the table want a fast, confident answer.

Respond with valid JSON only (no markdown fences):
{
  "ruling": "One or two sentence direct answer",
  "confidence": "high" | "medium" | "low",
  "reasoning": "Short explanation of how you reached the ruling",
  "citations": [
    {
      "page": 12,
      "section": "Optional section name",
      "quote": "Exact or near-exact quote from the excerpt"
    }
  ],
  "needs_clarification": false,
  "clarification_question": null
}

Set needs_clarification to true only when the question is ambiguous and the answer depends on missing game state.
"""

DISPUTE_SYSTEM_PROMPT = """You are a board game rules referee. Two players disagree — settle the dispute clearly and fairly.

You will receive:
- The situation in dispute
- Player A's interpretation
- Player B's interpretation
- Rulebook excerpts

Rules:
- Answer ONLY from the provided rulebook excerpts. If the excerpts do not contain enough information, say so.
- Weigh both interpretations fairly against the rule text.
- Give a direct ruling first (who is right at the table), then brief reasoning.
- Assess each player's argument separately — what matches the rules and what does not.
- Every factual claim must have a citation with the exact page number from the excerpts.
- Quote the relevant rule text briefly in each citation.
- If conversation history is provided, treat the current dispute as a follow-up and use that context.
- Be concise. Players at the table want a fast, confident answer.

Respond with valid JSON only (no markdown fences):
{
  "ruling": "One or two sentence direct verdict for the table",
  "favors": "player_a" | "player_b" | "split" | "neither" | "unclear",
  "player_a_assessment": "Brief assessment of Player A's argument vs the rules",
  "player_b_assessment": "Brief assessment of Player B's argument vs the rules",
  "confidence": "high" | "medium" | "low",
  "reasoning": "Short explanation of how you reached the ruling",
  "citations": [
    {
      "page": 12,
      "section": "Optional section name",
      "quote": "Exact or near-exact quote from the excerpt"
    }
  ],
  "needs_clarification": false,
  "clarification_question": null
}

Use favors:
- player_a / player_b when one interpretation clearly matches the rules
- split when both are partially correct or the rule supports elements of each
- neither when both misread the rules
- unclear when the excerpts lack enough detail to decide

Set needs_clarification to true only when the dispute depends on missing game state.
"""


def _format_context(chunks: list[StoredChunk]) -> str:
    blocks: list[str] = []
    for chunk in chunks:
        section = f" — {chunk.section_hint}" if chunk.section_hint else ""
        blocks.append(f"[Page {chunk.page}{section}]\n{chunk.text}")
    return "\n\n---\n\n".join(blocks)


def _parse_response(raw: str) -> dict:
    text = raw.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
    if fence:
        text = fence.group(1)
    return json.loads(text)


class RefereeAgent:
    def __init__(self, api_key: str | None = None) -> None:
        key = api_key or ANTHROPIC_API_KEY
        if not key:
            raise ValueError("ANTHROPIC_API_KEY is required")
        self.client = anthropic.Anthropic(api_key=key)

    def rule_on(
        self,
        question: str,
        chunks: list[StoredChunk],
        history: list[dict] | None = None,
    ) -> dict:
        if not chunks:
            return {
                "agent": "referee",
                "ruling": "I could not find relevant passages in the rulebook for this question.",
                "confidence": "low",
                "reasoning": "No matching rule text was retrieved from the uploaded PDF.",
                "citations": [],
                "needs_clarification": False,
                "clarification_question": None,
            }

        history_block = format_history_block(history or [])
        try:
            message = self.client.messages.create(
                model=MODEL,
                max_tokens=1024,
                system=SYSTEM_PROMPT,
                messages=[
                    {
                        "role": "user",
                        "content": (
                            f"{history_block}"
                            f"Current question: {question}\n\n"
                            f"Rulebook excerpts:\n\n{_format_context(chunks)}"
                        ),
                    }
                ],
            )
        except anthropic.AuthenticationError as exc:
            raise ValueError("Invalid ANTHROPIC_API_KEY") from exc
        except anthropic.NotFoundError as exc:
            raise ValueError(f"Model '{MODEL}' not found. Update ANTHROPIC_MODEL in .env.") from exc
        except anthropic.RateLimitError as exc:
            raise ValueError("Anthropic rate limit exceeded. Try again shortly.") from exc
        except anthropic.APIConnectionError as exc:
            raise ValueError("Could not reach Anthropic API. Check your network.") from exc
        except anthropic.APIError as exc:
            raise ValueError(f"Anthropic API error: {exc.message}") from exc

        raw = message.content[0].text
        try:
            parsed = _parse_response(raw)
        except json.JSONDecodeError as exc:
            raise ValueError("Referee returned invalid JSON. Please try again.") from exc
        parsed["agent"] = "referee"
        return parsed

    def rule_dispute(
        self,
        situation: str,
        player_a: str,
        player_b: str,
        chunks: list[StoredChunk],
        history: list[dict] | None = None,
    ) -> dict:
        if not chunks:
            return {
                "agent": "referee",
                "ruling": "I could not find relevant passages in the rulebook for this dispute.",
                "favors": "unclear",
                "player_a_assessment": "Cannot assess without matching rule text.",
                "player_b_assessment": "Cannot assess without matching rule text.",
                "confidence": "low",
                "reasoning": "No matching rule text was retrieved from the uploaded PDF.",
                "citations": [],
                "needs_clarification": False,
                "clarification_question": None,
            }

        history_block = format_history_block(history or [])
        try:
            message = self.client.messages.create(
                model=MODEL,
                max_tokens=1200,
                system=DISPUTE_SYSTEM_PROMPT,
                messages=[
                    {
                        "role": "user",
                        "content": (
                            f"{history_block}"
                            f"Situation in dispute: {situation}\n\n"
                            f"Player A says: {player_a}\n\n"
                            f"Player B says: {player_b}\n\n"
                            f"Rulebook excerpts:\n\n{_format_context(chunks)}"
                        ),
                    }
                ],
            )
        except anthropic.AuthenticationError as exc:
            raise ValueError("Invalid ANTHROPIC_API_KEY") from exc
        except anthropic.NotFoundError as exc:
            raise ValueError(f"Model '{MODEL}' not found. Update ANTHROPIC_MODEL in .env.") from exc
        except anthropic.RateLimitError as exc:
            raise ValueError("Anthropic rate limit exceeded. Try again shortly.") from exc
        except anthropic.APIConnectionError as exc:
            raise ValueError("Could not reach Anthropic API. Check your network.") from exc
        except anthropic.APIError as exc:
            raise ValueError(f"Anthropic API error: {exc.message}") from exc

        raw = message.content[0].text
        try:
            parsed = _parse_response(raw)
        except json.JSONDecodeError as exc:
            raise ValueError("Referee returned invalid JSON. Please try again.") from exc
        parsed["agent"] = "referee"
        return parsed
