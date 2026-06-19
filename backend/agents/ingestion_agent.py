"""Ingestion agent – parse PDF and build the searchable index."""

from __future__ import annotations

from pathlib import Path

from services.pdf_parser import TextChunk, extract_chunks
from services.vector_store import VectorStore


class IngestionAgent:
    def __init__(self, vector_store: VectorStore | None = None) -> None:
        self.vector_store = vector_store or VectorStore()

    def ingest(self, rulebook_id: str, pdf_path: Path) -> dict:
        chunks: list[TextChunk]
        chunks, page_count = extract_chunks(pdf_path)
        indexed = self.vector_store.index_rulebook(rulebook_id, chunks)
        return {
            "agent": "ingestion",
            "pages_extracted": page_count,
            "chunks_indexed": indexed,
        }
