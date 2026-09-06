"""Tests for quick-reference chunk selection."""

from services.quick_reference import select_chunks_for_synthesis
from services.vector_store import StoredChunk


class FakeVectorStore:
    def __init__(self, chunks: list[StoredChunk]) -> None:
        self._chunks = chunks

    def list_chunks(self, rulebook_id: str, limit: int = 24) -> list[StoredChunk]:
        return self._chunks[:limit]


def _chunk(page: int) -> StoredChunk:
    return StoredChunk(chunk_id=str(page), page=page, text=f"Page {page} text.", section_hint=None)


def test_select_chunks_for_synthesis_passes_through_when_under_cap():
    chunks = [_chunk(page) for page in range(1, 6)]
    store = FakeVectorStore(chunks)

    result = select_chunks_for_synthesis(store, "book-1", max_chunks=200)

    assert result == chunks


def test_select_chunks_for_synthesis_samples_evenly_when_over_cap():
    chunks = [_chunk(page) for page in range(1, 1001)]
    store = FakeVectorStore(chunks)

    result = select_chunks_for_synthesis(store, "book-1", max_chunks=100)

    assert len(result) == 100
    assert result[0].page == 1
    pages = [chunk.page for chunk in result]
    assert pages == sorted(pages)
    assert pages[-1] > 900
