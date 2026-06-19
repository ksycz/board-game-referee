"""Helpers for multi-turn rules conversations."""

from __future__ import annotations

MAX_HISTORY_MESSAGES = 12


def trim_history(history: list[dict], *, max_messages: int = MAX_HISTORY_MESSAGES) -> list[dict]:
    return history[-max_messages:]


def retrieval_query(question: str, history: list[dict]) -> str:
    """Build a search query that includes recent user questions for follow-ups."""
    if not history:
        return question

    user_messages = [msg["content"] for msg in history if msg.get("role") == "user"]
    parts = user_messages[-2:] + [question]
    return " ".join(parts)


def dispute_retrieval_query(situation: str, player_a: str, player_b: str) -> str:
    """Build a search query from a two-sided rules dispute."""
    return " ".join(part.strip() for part in (situation, player_a, player_b) if part.strip())


def format_history_block(history: list[dict]) -> str:
    if not history:
        return ""

    lines: list[str] = []
    for msg in history:
        label = "Player" if msg.get("role") == "user" else "Referee"
        lines.append(f"{label}: {msg['content']}")
    return "Conversation so far:\n" + "\n".join(lines) + "\n\n"
