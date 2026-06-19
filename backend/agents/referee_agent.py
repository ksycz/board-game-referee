"""Referee agent – answer rules questions using retrieved passages."""

from __future__ import annotations

import json
import re

import anthropic

from config import ANTHROPIC_API_KEY, MODEL
from services.vector_store import StoredChunk

SYSTEM_PROMPT = """You are a board game rules referee. Your job is to settle rules disputes clearly and fairly.

Rules:
- Answer ONLY from the provided rulebook excerpts. If the excerpts do not contain enough information, say so.
- Give a direct ruling first, then brief reasoning.
- Every factual claim must have a citation with the exact page number from the excerpts.
- Quote the relevant rule text briefly in each citation.
- If multiple interpretations exist, explain them and cite which passage supports each.
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


def _format_context(chunks: list[StoredChunk]) -> str:
    blocks: list[str] = []
    for chunk in chunks:
        section = f" — {chunk.section_hint}" if chunk.section_hint else ""
        blocks.append(
            f"[Page {chunk.page}{section}]\n{chunk.text}"
        )
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

    def rule_on(self, question: str, chunks: list[StoredChunk]) -> dict:
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

        try:
            message = self.client.messages.create(
                model=MODEL,
                max_tokens=1024,
                system=SYSTEM_PROMPT,
                messages=[
                    {
                        "role": "user",
                        "content": (
                            f"Question: {question}\n\n"
                            f"Rulebook excerpts:\n\n{_format_context(chunks)}"
                        ),
                    }
                ],
            )
        except anthropic.AuthenticationError as exc:
            raise ValueError("Invalid ANTHROPIC_API_KEY") from exc
        except anthropic.NotFoundError as exc:
            raise ValueError(
                f"Model '{MODEL}' not found. Update ANTHROPIC_MODEL in .env."
            ) from exc
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
