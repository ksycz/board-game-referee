"""Simple offline embeddings — no model download required."""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass

import chromadb
from chromadb.api.types import Documents, EmbeddingFunction, Embeddings
from chromadb.config import Settings

from config import CHROMA_DIR, ensure_dirs
from services.pdf_parser import PageChunk

_DIM = 256


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

    def index_rulebook(self, rulebook_id: str, pages: list[PageChunk]) -> int:
        collection = self._collection(rulebook_id)
        if collection.count() > 0:
            self.delete_rulebook(rulebook_id)

        ids: list[str] = []
        documents: list[str] = []
        metadatas: list[dict] = []

        for page in pages:
            chunk_id = str(uuid.uuid4())
            ids.append(chunk_id)
            documents.append(page.text)
            metadatas.append(
                {
                    "page": page.page,
                    "section_hint": page.section_hint or "",
                }
            )

        if not ids:
            return 0

        collection.add(ids=ids, documents=documents, metadatas=metadatas)
        return len(ids)

    def search(self, rulebook_id: str, query: str, top_k: int) -> list[StoredChunk]:
        collection = self._collection(rulebook_id)
        if collection.count() == 0:
            return []

        result = collection.query(query_texts=[query], n_results=min(top_k, collection.count()))
        chunks: list[StoredChunk] = []

        ids = result.get("ids", [[]])[0]
        documents = result.get("documents", [[]])[0]
        metadatas = result.get("metadatas", [[]])[0]
        distances = result.get("distances", [[]])[0]

        for chunk_id, text, metadata, distance in zip(ids, documents, metadatas, distances):
            chunks.append(
                StoredChunk(
                    chunk_id=chunk_id,
                    page=int(metadata.get("page", 0)),
                    text=text,
                    section_hint=metadata.get("section_hint") or None,
                    score=1.0 - float(distance),
                )
            )
        return chunks

    def delete_rulebook(self, rulebook_id: str) -> None:
        try:
            self._client.delete_collection(f"rulebook_{rulebook_id}")
        except Exception:
            pass
