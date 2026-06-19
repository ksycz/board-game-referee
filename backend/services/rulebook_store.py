"""Registry of uploaded rulebooks (metadata + file paths)."""

from __future__ import annotations

import json
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

from config import RULEBOOKS_DIR, ensure_dirs


@dataclass
class Rulebook:
    id: str
    name: str
    filename: str
    page_count: int
    created_at: str


class RulebookStore:
    def __init__(self) -> None:
        ensure_dirs()
        self._index_path = RULEBOOKS_DIR / "index.json"
        self._rulebooks: dict[str, Rulebook] = {}
        self._load()

    def _load(self) -> None:
        if not self._index_path.exists():
            return
        raw = json.loads(self._index_path.read_text(encoding="utf-8"))
        for item in raw:
            book = Rulebook(**item)
            self._rulebooks[book.id] = book

    def _save(self) -> None:
        payload = [asdict(book) for book in self._rulebooks.values()]
        self._index_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def list(self) -> list[Rulebook]:
        return sorted(self._rulebooks.values(), key=lambda b: b.created_at, reverse=True)

    def get(self, rulebook_id: str) -> Rulebook | None:
        return self._rulebooks.get(rulebook_id)

    def add(self, name: str, filename: str, page_count: int) -> Rulebook:
        book = Rulebook(
            id=str(uuid.uuid4()),
            name=name,
            filename=filename,
            page_count=page_count,
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        self._rulebooks[book.id] = book
        self._save()
        return book

    def delete(self, rulebook_id: str) -> bool:
        book = self._rulebooks.pop(rulebook_id, None)
        if not book:
            return False
        pdf_path = RULEBOOKS_DIR / book.filename
        if pdf_path.exists():
            pdf_path.unlink()
        self._save()
        return True

    def pdf_path(self, rulebook_id: str) -> Path:
        book = self.get(rulebook_id)
        if not book:
            raise KeyError(rulebook_id)
        return RULEBOOKS_DIR / book.filename
