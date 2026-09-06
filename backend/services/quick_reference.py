"""Chunk selection for whole-rulebook quick-reference synthesis."""

from __future__ import annotations

from config import QUICK_REFERENCE_MAX_CHUNKS
from services.vector_store import StoredChunk, VectorStore

_ALL_CHUNKS_LIMIT = 1_000_000


def select_chunks_for_synthesis(
    vector_store: VectorStore,
    rulebook_id: str,
    *,
    max_chunks: int = QUICK_REFERENCE_MAX_CHUNKS,
) -> list[StoredChunk]:
    """Sample chunks across the whole rulebook so setup (start) and win
    conditions (often near the end) both survive truncation, unlike a plain
    head-truncated `list_chunks(limit=...)` call."""
    all_chunks = vector_store.list_chunks(rulebook_id, limit=_ALL_CHUNKS_LIMIT)
    if len(all_chunks) <= max_chunks:
        return all_chunks
    step = len(all_chunks) / max_chunks
    return [all_chunks[int(i * step)] for i in range(max_chunks)]
