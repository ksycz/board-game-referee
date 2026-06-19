"""Ingestion agent – parse PDF and build the searchable index."""

from __future__ import annotations

from pathlib import Path

from services.pdf_parser import PageChunk, extract_pages
from services.vector_store import VectorStore


class IngestionAgent:
    def __init__(self, vector_store: VectorStore | None = None) -> None:
        self.vector_store = vector_store or VectorStore()

    def ingest(self, rulebook_id: str, pdf_path: Path) -> dict:
        pages: list[PageChunk] = extract_pages(pdf_path)
        indexed = self.vector_store.index_rulebook(rulebook_id, pages)
        return {
            "agent": "ingestion",
            "pages_extracted": len(pages),
            "chunks_indexed": indexed,
        }
