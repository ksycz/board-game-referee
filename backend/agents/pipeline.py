"""Connects ingestion → retrieval → referee → citation validation."""

from __future__ import annotations

from pathlib import Path

from agents.citation_agent import CitationAgent
from agents.ingestion_agent import IngestionAgent
from agents.referee_agent import RefereeAgent
from agents.retrieval_agent import RetrievalAgent
from config import TOP_K_CHUNKS
from services.rulebook_store import RulebookStore
from services.vector_store import VectorStore


class RefereePipeline:
    def __init__(
        self,
        store: RulebookStore | None = None,
        vector_store: VectorStore | None = None,
    ) -> None:
        self.store = store or RulebookStore()
        self.vector_store = vector_store or VectorStore()
        self.ingestion = IngestionAgent(self.vector_store)
        self.retrieval = RetrievalAgent(self.vector_store)
        self._referee: RefereeAgent | None = None
        self.citation = CitationAgent()

    @property
    def referee(self) -> RefereeAgent:
        if self._referee is None:
            self._referee = RefereeAgent()
        return self._referee

    def upload_rulebook(self, name: str, filename: str, pdf_bytes: bytes) -> dict:
        book = self.store.add(name=name, filename=filename, page_count=0)
        pdf_path = self.store.pdf_path(book.id)
        pdf_path.write_bytes(pdf_bytes)

        ingest_result = self.ingestion.ingest(book.id, pdf_path)
        book.page_count = ingest_result["pages_extracted"]
        self.store._save()

        return {
            "rulebook": book,
            "ingestion": ingest_result,
        }

    def ask(self, rulebook_id: str, question: str, top_k: int | None = None) -> dict:
        book = self.store.get(rulebook_id)
        if not book:
            raise KeyError(f"Rulebook not found: {rulebook_id}")

        k = top_k or TOP_K_CHUNKS
        retrieval = self.retrieval.retrieve(rulebook_id, question, k)
        chunks = retrieval["chunks"]

        ruling = self.referee.rule_on(question, chunks)
        validation = self.citation.validate(ruling, chunks)

        return {
            "rulebook_id": rulebook_id,
            "rulebook_name": book.name,
            "question": question,
            "retrieval": {
                "chunks_found": retrieval["chunks_found"],
                "pages": sorted({c.page for c in chunks}),
            },
            "ruling": ruling,
            "citation_check": validation,
        }

    def delete_rulebook(self, rulebook_id: str) -> bool:
        if not self.store.delete(rulebook_id):
            return False
        self.vector_store.delete_rulebook(rulebook_id)
        return True

    def reindex(self, rulebook_id: str) -> dict:
        pdf_path = self.store.pdf_path(rulebook_id)
        return self.ingestion.ingest(rulebook_id, Path(pdf_path))
