"""Registry of uploaded rulebooks (metadata + file paths)."""

from __future__ import annotations

import hashlib
import json
import threading
import uuid
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

from config import RULEBOOKS_DIR, ensure_dirs
from services.upload_utils import safe_stored_filename
from services.game_name import (
    extract_game_name_from_pdf,
    looks_like_filename,
    prettify_filename_stem,
)


def pdf_content_hash(pdf_bytes: bytes) -> str:
    return hashlib.sha256(pdf_bytes).hexdigest()


class DuplicateRulebookError(Exception):
    def __init__(self, existing: Rulebook) -> None:
        self.existing = existing
        super().__init__(f'Rulebook "{existing.name}" is already in your library.')


def resolve_rulebook_pdf_path(filename: str) -> Path:
    """Resolve a stored filename to an absolute path inside RULEBOOKS_DIR."""
    safe_name = safe_stored_filename(filename)
    path = (RULEBOOKS_DIR / safe_name).resolve()
    root = RULEBOOKS_DIR.resolve()
    if path != root and root not in path.parents:
        raise ValueError(f"Invalid rulebook filename: {filename}")
    return path


@dataclass
class Rulebook:
    id: str
    name: str
    filename: str
    page_count: int
    created_at: str
    content_hash: str = ""
    pinned: bool = False
    demo: bool = False


class RulebookStore:
    def __init__(self) -> None:
        ensure_dirs()
        self._index_path = RULEBOOKS_DIR / "index.json"
        self._rulebooks: dict[str, Rulebook] = {}
        self._lock = threading.Lock()
        self._load()

    def _load(self) -> None:
        if not self._index_path.exists():
            return
        raw = json.loads(self._index_path.read_text(encoding="utf-8"))
        for item in raw:
            item.setdefault("content_hash", "")
            item.setdefault("pinned", False)
            item.setdefault("demo", False)
            book = Rulebook(**item)
            self._rulebooks[book.id] = book

    def _save(self) -> None:
        with self._lock:
            self._save_unlocked()

    def _backfill_content_hashes(self) -> None:
        with self._lock:
            changed = False
            for book in self._rulebooks.values():
                if book.content_hash:
                    continue
                pdf_path = resolve_rulebook_pdf_path(book.filename)
                if not pdf_path.exists():
                    continue
                book.content_hash = pdf_content_hash(pdf_path.read_bytes())
                changed = True
            if changed:
                self._save_unlocked()

    def _save_unlocked(self) -> None:
        payload = [asdict(book) for book in self._rulebooks.values()]
        temp_path = self._index_path.with_name(f"index.{uuid.uuid4()}.tmp")
        temp_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        temp_path.replace(self._index_path)

    def find_by_content_hash(self, content_hash: str) -> Rulebook | None:
        self._backfill_content_hashes()
        with self._lock:
            for book in self._rulebooks.values():
                if book.content_hash == content_hash:
                    return book
        return None

    def list(self) -> list[Rulebook]:
        self._backfill_content_hashes()
        with self._lock:
            changed = False
            for book in self._rulebooks.values():
                if not looks_like_filename(book.name):
                    continue
                pdf_path = resolve_rulebook_pdf_path(book.filename)
                if not pdf_path.exists():
                    continue
                resolved = extract_game_name_from_pdf(pdf_path)
                if not resolved:
                    resolved = prettify_filename_stem(book.name)
                if resolved and resolved != book.name:
                    book.name = resolved
                    changed = True
            if changed:
                self._save_unlocked()
            return sorted(
                self._rulebooks.values(),
                key=lambda book: (book.pinned, book.created_at),
                reverse=True,
            )

    def get(self, rulebook_id: str) -> Rulebook | None:
        with self._lock:
            return self._rulebooks.get(rulebook_id)

    def set_pinned(self, rulebook_id: str, pinned: bool) -> Rulebook | None:
        with self._lock:
            book = self._rulebooks.get(rulebook_id)
            if not book:
                return None
            book.pinned = pinned
            self._save_unlocked()
            return book

    def add(
        self,
        name: str,
        filename: str,
        page_count: int,
        *,
        content_hash: str,
        demo: bool = False,
    ) -> Rulebook:
        with self._lock:
            book = Rulebook(
                id=str(uuid.uuid4()),
                name=name,
                filename=safe_stored_filename(filename),
                page_count=page_count,
                created_at=datetime.now(UTC).isoformat(),
                content_hash=content_hash,
                demo=demo,
            )
            self._rulebooks[book.id] = book
            self._save_unlocked()
        return book

    def delete(self, rulebook_id: str) -> bool:
        with self._lock:
            book = self._rulebooks.pop(rulebook_id, None)
            if not book:
                return False
            self._save_unlocked()
        pdf_path = resolve_rulebook_pdf_path(book.filename)
        if pdf_path.exists():
            pdf_path.unlink()
        return True

    def pdf_path(self, rulebook_id: str) -> Path:
        book = self.get(rulebook_id)
        if not book:
            raise KeyError(rulebook_id)
        return resolve_rulebook_pdf_path(book.filename)
