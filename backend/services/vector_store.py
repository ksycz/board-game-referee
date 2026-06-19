"""Simple offline embeddings — no model download required."""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass

import chromadb
from chromadb.api.types import Documents, EmbeddingFunction, Embeddings
from chromadb.config import Settings

from config import CHROMA_DIR, ensure_dirs
from services.pdf_parser import TextChunk

_DIM = 256

_STOP_WORDS = frozenset(
    {
        "a",
        "an",
        "the",
        "is",
        "are",
        "was",
        "were",
        "what",
        "how",
        "when",
        "can",
        "could",
        "do",
        "does",
        "did",
        "my",
        "your",
        "on",
        "in",
        "to",
        "of",
        "for",
        "it",
        "that",
        "this",
        "during",
        "another",
        "player",
        "players",
        "game",
        "about",
        "there",
        "if",
        "and",
        "or",
        "at",
        "be",
        "with",
        "from",
        "i",
        "me",
        "we",
        "you",
        "up",
    }
)


def _query_terms(query: str) -> list[str]:
    terms: list[str] = []
    lowered = query.lower()
    for token in re.findall(r"\w+", lowered):
        if len(token) >= 3 and token not in _STOP_WORDS:
            terms.append(token)

    if "set up" in lowered or "setup" in lowered:
        terms.append("setup")
    if "win" in lowered or "victory" in lowered:
        terms.extend(["winner", "victory"])
    if "turn" in lowered:
        terms.append("turn")

    return list(dict.fromkeys(terms))


def _searchable_text(text: str, section_hint: str | None) -> str:
    if section_hint:
        return f"{section_hint}\n{text}"
    return text


def _term_matches(term: str, lowered: str) -> bool:
    if len(term) <= 4:
        if re.search(rf"\b{re.escape(term)}\b", lowered):
            return True
        if term == "set" and "setup" in lowered:
            return True
        return False
    return term in lowered


def _keyword_score(text: str, terms: list[str], term_doc_freq: dict[str, int] | None = None) -> float:
    if not terms:
        return 0.0
    lowered = text.lower()
    if term_doc_freq:
        score = 0.0
        for term in terms:
            if not _term_matches(term, lowered):
                continue
            df = max(term_doc_freq.get(term, 1), 1)
            score += 1.0 / df
        return min(1.0, score / len(terms))

    hits = sum(1 for term in terms if _term_matches(term, lowered))
    return hits / len(terms)


class SimpleEmbeddingFunction(EmbeddingFunction):
    def __init__(self) -> None:
        pass

    @staticmethod
    def name() -> str:
        return "simple_hash"

    def get_config(self) -> dict:
        return {"dim": _DIM}

    @staticmethod
    def build_from_config(config: dict) -> "SimpleEmbeddingFunction":
        return SimpleEmbeddingFunction()

    def __call__(self, input: Documents) -> Embeddings:
        return [self._embed(doc) for doc in input]

    def _embed(self, text: str) -> list[float]:
        vec = [0.0] * _DIM
        for token in re.findall(r"\w+", text.lower()):
            vec[hash(token) % _DIM] += 1.0
        norm = sum(v * v for v in vec) ** 0.5 or 1.0
        return [v / norm for v in vec]


@dataclass(frozen=True)
class StoredChunk:
    chunk_id: str
    page: int
    text: str
    section_hint: str | None
    score: float | None = None


class VectorStore:
    def __init__(self) -> None:
        ensure_dirs()
        self._client = chromadb.PersistentClient(
            path=str(CHROMA_DIR),
            settings=Settings(anonymized_telemetry=False),
        )

    def _collection(self, rulebook_id: str):
        return self._client.get_or_create_collection(
            name=f"rulebook_{rulebook_id}",
            metadata={"hnsw:space": "cosine"},
            embedding_function=SimpleEmbeddingFunction(),
        )

    def index_rulebook(self, rulebook_id: str, chunks: list[TextChunk]) -> int:
        collection = self._collection(rulebook_id)
        if collection.count() > 0:
            self.delete_rulebook(rulebook_id)

        ids: list[str] = []
        documents: list[str] = []
        metadatas: list[dict] = []

        for chunk in chunks:
            chunk_id = str(uuid.uuid4())
            ids.append(chunk_id)
            documents.append(chunk.text)
            metadatas.append(
                {
                    "page": chunk.page,
                    "section_hint": chunk.section_hint or "",
                }
            )

        if not ids:
            return 0

        collection.add(ids=ids, documents=documents, metadatas=metadatas)
        return len(ids)

    def search(self, rulebook_id: str, query: str, top_k: int) -> list[StoredChunk]:
        collection = self._collection(rulebook_id)
        count = collection.count()
        if count == 0:
            return []

        terms = _query_terms(query)
        merged: dict[str, StoredChunk] = {}

        vector_n = min(max(top_k * 2, top_k), count)
        result = collection.query(query_texts=[query], n_results=vector_n)
        ids = result.get("ids", [[]])[0]
        documents = result.get("documents", [[]])[0]
        metadatas = result.get("metadatas", [[]])[0]
        distances = result.get("distances", [[]])[0]

        for chunk_id, text, metadata, distance in zip(ids, documents, metadatas, distances):
            vector_score = 1.0 - float(distance)
            merged[chunk_id] = StoredChunk(
                chunk_id=chunk_id,
                page=int(metadata.get("page", 0)),
                text=text,
                section_hint=metadata.get("section_hint") or None,
                score=0.5 * vector_score,
            )

        if terms:
            all_result = collection.get(include=["documents", "metadatas"])
            all_ids = all_result.get("ids") or []
            all_documents = all_result.get("documents") or []
            all_metadatas = all_result.get("metadatas") or []

            term_doc_freq: dict[str, int] = {}
            for term in terms:
                term_doc_freq[term] = sum(
                    1
                    for text, metadata in zip(all_documents, all_metadatas)
                    if _term_matches(
                        term,
                        _searchable_text(text, metadata.get("section_hint") or None).lower(),
                    )
                )

            for chunk_id, text, metadata in zip(all_ids, all_documents, all_metadatas):
                section_hint = metadata.get("section_hint") or None
                searchable = _searchable_text(text, section_hint)
                keyword_score = _keyword_score(searchable, terms, term_doc_freq)
                if keyword_score <= 0:
                    continue

                vector_score = merged[chunk_id].score if chunk_id in merged else None
                if vector_score is not None:
                    combined = 0.35 * vector_score + 0.65 * keyword_score
                else:
                    combined = 0.65 * keyword_score

                merged[chunk_id] = StoredChunk(
                    chunk_id=chunk_id,
                    page=int(metadata.get("page", 0)),
                    text=text,
                    section_hint=metadata.get("section_hint") or None,
                    score=combined,
                )

        ranked = sorted(merged.values(), key=lambda chunk: chunk.score or 0.0, reverse=True)
        return ranked[:top_k]

    def list_chunks(self, rulebook_id: str, limit: int = 24) -> list[StoredChunk]:
        collection = self._collection(rulebook_id)
        if collection.count() == 0:
            return []

        result = collection.get(include=["documents", "metadatas"])
        chunks: list[StoredChunk] = []
        ids = result.get("ids") or []
        documents = result.get("documents") or []
        metadatas = result.get("metadatas") or []

        for chunk_id, text, metadata in zip(ids, documents, metadatas):
            chunks.append(
                StoredChunk(
                    chunk_id=chunk_id,
                    page=int(metadata.get("page", 0)),
                    text=text,
                    section_hint=metadata.get("section_hint") or None,
                )
            )

        chunks.sort(key=lambda chunk: (chunk.page, chunk.chunk_id))
        return chunks[:limit]

    def delete_rulebook(self, rulebook_id: str) -> None:
        try:
            self._client.delete_collection(f"rulebook_{rulebook_id}")
        except Exception:
            pass
