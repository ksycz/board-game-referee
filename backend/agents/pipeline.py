"""Connects ingestion → retrieval → referee → citation validation."""

from __future__ import annotations

import threading
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager

from agents.citation_agent import CitationAgent
from agents.ingestion_agent import IngestionAgent
from agents.referee_agent import RefereeAgent
from agents.retrieval_agent import RetrievalAgent
from config import TOP_K_CHUNKS
from services.conversation import dispute_retrieval_query, retrieval_query, sanitize_client_history
from services.example_questions import example_questions_for_rulebook
from services.faq_cache import FaqCache, ask_lookup_key, dispute_lookup_key
from services.game_name import derive_game_name
from services.retrieval_telemetry import (
    compute_confidence_hint,
    compute_retrieval_metrics,
    log_retrieval_event,
    log_ruling_feedback,
)
from services.rulebook_store import (
    DuplicateRulebookError,
    Rulebook,
    RulebookStore,
    pdf_content_hash,
)
from services.vector_store import VectorStore

_reindex_locks: dict[str, threading.Lock] = {}
_reindex_locks_guard = threading.Lock()


def _reindex_lock(rulebook_id: str) -> threading.Lock:
    with _reindex_locks_guard:
        lock = _reindex_locks.get(rulebook_id)
        if lock is None:
            lock = threading.Lock()
            _reindex_locks[rulebook_id] = lock
        return lock


@contextmanager
def _rulebook_query_lock(rulebook_id: str) -> Iterator[None]:
    """Hold the per-rulebook lock for the full ask/search/dispute query."""
    lock = _reindex_lock(rulebook_id)
    if not lock.acquire(blocking=False):
        raise ValueError("This rulebook is being re-indexed. Try again in a moment.")
    try:
        yield
    finally:
        lock.release()


class RefereePipeline:
    def __init__(
        self,
        store: RulebookStore | None = None,
        vector_store: VectorStore | None = None,
        faq_cache: FaqCache | None = None,
    ) -> None:
        self.store = store or RulebookStore()
        self.vector_store = vector_store or VectorStore()
        self.faq_cache = faq_cache if faq_cache is not None else FaqCache()
        self.ingestion = IngestionAgent(self.vector_store)
        self.retrieval = RetrievalAgent(self.vector_store)
        self._referee: RefereeAgent | None = None
        self.citation = CitationAgent()

    @property
    def referee(self) -> RefereeAgent:
        if self._referee is None:
            self._referee = RefereeAgent()
        return self._referee

    @staticmethod
    def _retrieval_payload(chunks) -> dict:
        return {
            "chunks_found": len(chunks),
            "pages": sorted({chunk.page for chunk in chunks}),
            "sources": [
                {
                    "page": chunk.page,
                    "section": chunk.section_hint,
                    "text": chunk.text,
                }
                for chunk in chunks
            ],
        }

    def _finalize_response(
        self,
        response: dict,
        *,
        top_k: int,
        search_query: str,
    ) -> dict:
        metrics = compute_retrieval_metrics(
            response["retrieval"]["pages"],
            response["ruling"],
            response["citation_check"],
        )
        response["response_id"] = str(uuid.uuid4())
        response["retrieval"]["metrics"] = metrics
        hint = compute_confidence_hint(
            chunks_found=response["retrieval"]["chunks_found"],
            ruling=response["ruling"],
            citation_check=response["citation_check"],
            metrics=metrics,
        )
        if hint:
            response["confidence_hint"] = hint
        log_retrieval_event(
            {
                "response_id": response["response_id"],
                "mode": response.get("mode", "ask"),
                "rulebook_id": response["rulebook_id"],
                "rulebook_name": response["rulebook_name"],
                "top_k": top_k,
                "search_query": search_query,
                "question": response.get("question"),
                "situation": response.get("situation"),
                "metrics": metrics,
            }
        )
        return response

    @staticmethod
    def _with_response_id(response: dict) -> dict:
        if response.get("response_id"):
            return response
        return {**response, "response_id": str(uuid.uuid4())}

    def upload_rulebook(
        self,
        name: str | None,
        filename: str,
        pdf_bytes: bytes,
        *,
        original_filename: str,
        on_progress: Callable[[dict], None] | None = None,
        demo: bool = False,
    ) -> dict:
        content_hash = pdf_content_hash(pdf_bytes)
        book = self.store.add(
            name=name or "Rulebook",
            filename=filename,
            page_count=0,
            content_hash=content_hash,
            demo=demo,
        )
        pdf_path = self.store.pdf_path(book.id)
        try:
            pdf_path.write_bytes(pdf_bytes)
            book.name = derive_game_name(pdf_path, original_filename, name)
            ingest_result = self.ingestion.ingest(
                book.id,
                pdf_path,
                on_progress=on_progress,
            )
        except Exception:
            self.vector_store.delete_rulebook(book.id)
            self.store.delete(book.id)
            raise
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

    def quick_search(self, rulebook_id: str, query: str, *, limit: int = 8) -> dict:
        if not self.store.get(rulebook_id):
            raise KeyError(f"Rulebook not found: {rulebook_id}")
        trimmed = query.strip()
        if len(trimmed) < 2:
            raise ValueError("Enter at least two characters to search.")
        with _rulebook_query_lock(rulebook_id):
            return self.retrieval.quick_search(rulebook_id, trimmed, limit)

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

        with _rulebook_query_lock(rulebook_id):
            prior = sanitize_client_history(history or [])
            if not prior:
                cached = self.faq_cache.get(rulebook_id, ask_lookup_key(question))
                if cached:
                    return self._with_response_id(cached)

            k = top_k or TOP_K_CHUNKS
            search_query = retrieval_query(question, prior)
            retrieval = self.retrieval.retrieve(rulebook_id, search_query, k)
            chunks = retrieval["chunks"]

            ruling = self.referee.rule_on(question, chunks, prior)
            validation = self.citation.validate(ruling, chunks)

            response = self._finalize_response(
                {
                    "mode": "ask",
                    "rulebook_id": rulebook_id,
                    "rulebook_name": book.name,
                    "question": question,
                    "retrieval": self._retrieval_payload(chunks),
                    "ruling": ruling,
                    "citation_check": validation,
                },
                top_k=k,
                search_query=search_query,
            )
            if not prior:
                self.faq_cache.put(
                    rulebook_id,
                    ask_lookup_key(question),
                    response,
                    label=question,
                    mode="ask",
                )
            return response

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

        with _rulebook_query_lock(rulebook_id):
            prior = sanitize_client_history(history or [])
            if not prior:
                cached = self.faq_cache.get(
                    rulebook_id,
                    dispute_lookup_key(situation, player_a, player_b),
                )
                if cached:
                    return self._with_response_id(cached)

            k = top_k or TOP_K_CHUNKS
            search_query = dispute_retrieval_query(situation, player_a, player_b)
            retrieval = self.retrieval.retrieve(rulebook_id, search_query, k)
            chunks = retrieval["chunks"]

            ruling = self.referee.rule_dispute(situation, player_a, player_b, chunks, prior)
            validation = self.citation.validate(ruling, chunks)

            response = self._finalize_response(
                {
                    "mode": "dispute",
                    "rulebook_id": rulebook_id,
                    "rulebook_name": book.name,
                    "situation": situation,
                    "player_a": player_a,
                    "player_b": player_b,
                    "retrieval": self._retrieval_payload(chunks),
                    "ruling": ruling,
                    "citation_check": validation,
                },
                top_k=k,
                search_query=search_query,
            )
            if not prior:
                self.faq_cache.put(
                    rulebook_id,
                    dispute_lookup_key(situation, player_a, player_b),
                    response,
                    label=situation,
                    mode="dispute",
                )
            return response

    def record_feedback(self, rulebook_id: str, payload: dict) -> None:
        if not self.store.get(rulebook_id):
            raise KeyError(f"Rulebook not found: {rulebook_id}")
        log_ruling_feedback({"rulebook_id": rulebook_id, **payload})

    def delete_rulebook(self, rulebook_id: str) -> bool:
        lock = _reindex_lock(rulebook_id)
        if not lock.acquire(blocking=False):
            raise ValueError("This rulebook is being re-indexed. Try again in a moment.")
        try:
            if not self.store.delete(rulebook_id):
                return False
            self.vector_store.delete_rulebook(rulebook_id)
            self.faq_cache.delete_rulebook(rulebook_id)
            return True
        finally:
            lock.release()

    def set_rulebook_pinned(self, rulebook_id: str, pinned: bool) -> Rulebook | None:
        return self.store.set_pinned(rulebook_id, pinned)

    def render_page_preview(self, rulebook_id: str, page: int, *, zoom: float = 1.5) -> bytes:
        from services.pdf_page_preview import render_page_png

        book = self.store.get(rulebook_id)
        if not book:
            raise KeyError(f"Rulebook not found: {rulebook_id}")
        pdf_path = self.store.pdf_path(rulebook_id)
        if not pdf_path.exists():
            raise FileNotFoundError(f"PDF not found for rulebook: {rulebook_id}")
        return render_page_png(pdf_path, page, zoom=zoom)

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

    def reindex(
        self,
        rulebook_id: str,
        *,
        on_progress: Callable[[dict], None] | None = None,
    ) -> dict:
        book = self.store.get(rulebook_id)
        if not book:
            raise KeyError(f"Rulebook not found: {rulebook_id}")

        pdf_path = self.store.pdf_path(rulebook_id)
        if not pdf_path.exists():
            raise FileNotFoundError(f"PDF not found for rulebook: {rulebook_id}")

        lock = _reindex_lock(rulebook_id)
        if not lock.acquire(blocking=False):
            raise ValueError("This rulebook is already being re-indexed. Please wait.")

        try:
            ingest_result = self.ingestion.ingest(
                rulebook_id,
                pdf_path,
                on_progress=on_progress,
            )
            book.page_count = ingest_result["pages_extracted"]
            self.store._save()
            faq_cache_cleared = self.faq_cache.clear_rulebook(rulebook_id)

            return {
                "rulebook": book,
                "ingestion": ingest_result,
                "example_questions": self.example_questions(rulebook_id),
                "faq_cache_cleared": faq_cache_cleared,
            }
        finally:
            lock.release()
