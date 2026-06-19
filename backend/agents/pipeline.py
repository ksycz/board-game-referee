"""Connects ingestion → retrieval → referee → citation validation."""

from __future__ import annotations

from pathlib import Path

from agents.citation_agent import CitationAgent
from agents.ingestion_agent import IngestionAgent
from agents.referee_agent import RefereeAgent
from agents.retrieval_agent import RetrievalAgent
from config import TOP_K_CHUNKS
from services.conversation import dispute_retrieval_query, retrieval_query, trim_history
from services.example_questions import example_questions_for_rulebook
from services.game_name import derive_game_name, extract_game_name_from_pdf, looks_like_filename
from services.rulebook_store import DuplicateRulebookError, RulebookStore, pdf_content_hash
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

    def upload_rulebook(
        self,
        name: str | None,
        filename: str,
        pdf_bytes: bytes,
        *,
        original_filename: str,
    ) -> dict:
        content_hash = pdf_content_hash(pdf_bytes)
        existing = self.store.find_by_content_hash(content_hash)
        if existing:
            raise DuplicateRulebookError(existing)

        book = self.store.add(
            name=name or "Rulebook",
            filename=filename,
            page_count=0,
            content_hash=content_hash,
        )
        pdf_path = self.store.pdf_path(book.id)
        pdf_path.write_bytes(pdf_bytes)

        book.name = derive_game_name(pdf_path, original_filename, name)
        ingest_result = self.ingestion.ingest(book.id, pdf_path)
        book.page_count = ingest_result["pages_extracted"]
        self.store._save()

        return {
            "rulebook": book,
            "ingestion": ingest_result,
            "example_questions": self.example_questions(book.id),
        }

    def example_questions(self, rulebook_id: str) -> list[str]:
        if not self.store.get(rulebook_id):
            raise KeyError(f"Rulebook not found: {rulebook_id}")
        return example_questions_for_rulebook(self.vector_store, rulebook_id)

    def ask(
        self,
        rulebook_id: str,
        question: str,
        top_k: int | None = None,
        history: list[dict] | None = None,
    ) -> dict:
        book = self.store.get(rulebook_id)
        if not book:
            raise KeyError(f"Rulebook not found: {rulebook_id}")

        prior = trim_history(history or [])
        k = top_k or TOP_K_CHUNKS
        search_query = retrieval_query(question, prior)
        retrieval = self.retrieval.retrieve(rulebook_id, search_query, k)
        chunks = retrieval["chunks"]

        ruling = self.referee.rule_on(question, chunks, prior)
        validation = self.citation.validate(ruling, chunks)

        return {
            "mode": "ask",
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

    def dispute(
        self,
        rulebook_id: str,
        situation: str,
        player_a: str,
        player_b: str,
        top_k: int | None = None,
        history: list[dict] | None = None,
    ) -> dict:
        book = self.store.get(rulebook_id)
        if not book:
            raise KeyError(f"Rulebook not found: {rulebook_id}")

        prior = trim_history(history or [])
        k = top_k or TOP_K_CHUNKS
        search_query = dispute_retrieval_query(situation, player_a, player_b)
        retrieval = self.retrieval.retrieve(rulebook_id, search_query, k)
        chunks = retrieval["chunks"]

        ruling = self.referee.rule_dispute(situation, player_a, player_b, chunks, prior)
        validation = self.citation.validate(ruling, chunks)

        return {
            "mode": "dispute",
            "rulebook_id": rulebook_id,
            "rulebook_name": book.name,
            "situation": situation,
            "player_a": player_a,
            "player_b": player_b,
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

    def dedupe_rulebooks(self) -> int:
        """Remove extra copies of the same PDF, keeping the oldest upload per hash."""
        self.store._backfill_content_hashes()
        keep_hashes: set[str] = set()
        removed = 0
        for book in sorted(self.store._rulebooks.values(), key=lambda book: book.created_at):
            if not book.content_hash:
                continue
            if book.content_hash in keep_hashes:
                if self.delete_rulebook(book.id):
                    removed += 1
            else:
                keep_hashes.add(book.content_hash)
        return removed

    def reindex(self, rulebook_id: str) -> dict:
        pdf_path = self.store.pdf_path(rulebook_id)
        return self.ingestion.ingest(rulebook_id, Path(pdf_path))
