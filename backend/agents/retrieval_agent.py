"""Retrieval agent – find rulebook passages relevant to a question."""

from __future__ import annotations

from services.vector_store import VectorStore


class RetrievalAgent:
    def __init__(self, vector_store: VectorStore | None = None) -> None:
        self.vector_store = vector_store or VectorStore()

    def retrieve(self, rulebook_id: str, question: str, top_k: int) -> dict:
        chunks = self.vector_store.search(rulebook_id, question, top_k)
        return {
            "agent": "retrieval",
            "query": question,
            "chunks_found": len(chunks),
            "chunks": chunks,
        }

    def quick_search(self, rulebook_id: str, query: str, limit: int) -> dict:
        chunks = self.vector_store.keyword_search(rulebook_id, query, limit)
        return {
            "agent": "quick_search",
            "query": query,
            "hits": [
                {
                    "page": chunk.page,
                    "section": chunk.section_hint,
                    "text": chunk.text,
                    "score": chunk.score,
                }
                for chunk in chunks
            ],
        }
