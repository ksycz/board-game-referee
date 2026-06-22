"""Ingestion agent – parse PDF and build the searchable index."""

from __future__ import annotations

import shutil
from collections.abc import Callable
from pathlib import Path
from typing import Any

from config import OCR_FALLBACK
from services.pdf_parser import TextChunk, ensure_tesseract_path, extract_chunks
from services.vector_store import VectorStore

ProgressCallback = Callable[[dict[str, Any]], None]


class IngestionAgent:
    def __init__(self, vector_store: VectorStore | None = None) -> None:
        self.vector_store = vector_store or VectorStore()

    def ingest(
        self,
        rulebook_id: str,
        pdf_path: Path,
        *,
        on_progress: ProgressCallback | None = None,
    ) -> dict:
        chunks: list[TextChunk]
        chunks, total_pages, pages_indexed, ocr_pages, thin_pages = extract_chunks(
            pdf_path,
            on_progress=on_progress,
        )
        if on_progress is not None:
            on_progress({"phase": "indexing", "page": 0, "total_pages": total_pages})
        indexed = self.vector_store.index_rulebook(rulebook_id, chunks)
        result = {
            "agent": "ingestion",
            "total_pages": total_pages,
            "pages_indexed": pages_indexed,
            "pages_extracted": pages_indexed,
            "chunks_indexed": indexed,
            "thin_pages": thin_pages,
            "thin_page_count": len(thin_pages),
        }
        if ocr_pages:
            result["ocr_pages"] = ocr_pages
        elif OCR_FALLBACK and not shutil.which("tesseract"):
            ensure_tesseract_path()
            if not shutil.which("tesseract"):
                result["ocr_warning"] = (
                    "Scanning is turned on, but Tesseract is not installed. "
                    "Run: brew install tesseract — then delete this game and upload again."
                )
        return result
