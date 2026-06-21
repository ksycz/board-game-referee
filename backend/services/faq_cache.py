"""Per-rulebook FAQ cache for repeat questions and disputes."""

from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from config import DATA_DIR, FAQ_CACHE_ENABLED, FAQ_CACHE_MAX_ENTRIES, ensure_dirs


def normalize_text(text: str) -> str:
    return " ".join(text.strip().lower().split())


def ask_lookup_key(question: str) -> str:
    return hashlib.sha256(normalize_text(question).encode("utf-8")).hexdigest()


def dispute_lookup_key(situation: str, player_a: str, player_b: str) -> str:
    payload = "|".join(normalize_text(value) for value in (situation, player_a, player_b))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def is_cacheable_response(response: dict[str, Any]) -> bool:
    ruling = response.get("ruling") or {}
    if ruling.get("needs_clarification"):
        return False
    ruling_text = (ruling.get("ruling") or "").strip()
    return bool(ruling_text)


class FaqCache:
    def __init__(
        self,
        *,
        cache_dir: Path | None = None,
        enabled: bool | None = None,
        max_entries: int | None = None,
    ) -> None:
        ensure_dirs()
        self._cache_dir = cache_dir or (DATA_DIR / "faq_cache")
        self._cache_dir.mkdir(parents=True, exist_ok=True)
        self.enabled = FAQ_CACHE_ENABLED if enabled is None else enabled
        self.max_entries = max_entries if max_entries is not None else FAQ_CACHE_MAX_ENTRIES
        self._books: dict[str, dict[str, Any]] = {}

    def _path(self, rulebook_id: str) -> Path:
        return self._cache_dir / f"{rulebook_id}.json"

    def _load_book(self, rulebook_id: str) -> dict[str, Any]:
        if rulebook_id in self._books:
            return self._books[rulebook_id]

        path = self._path(rulebook_id)
        if path.exists():
            book = json.loads(path.read_text(encoding="utf-8"))
        else:
            book = {"entries": {}}

        book.setdefault("entries", {})
        self._books[rulebook_id] = book
        return book

    def _save_book(self, rulebook_id: str) -> None:
        book = self._books.get(rulebook_id)
        if book is None:
            return
        self._path(rulebook_id).write_text(
            json.dumps(book, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

    def get(self, rulebook_id: str, lookup_key: str) -> dict[str, Any] | None:
        if not self.enabled:
            return None

        book = self._load_book(rulebook_id)
        entry = book["entries"].get(lookup_key)
        if not entry:
            return None

        response = deepcopy(entry["response"])
        response["cached"] = True
        response["cached_at"] = entry.get("created_at")
        return response

    def put(
        self,
        rulebook_id: str,
        lookup_key: str,
        response: dict[str, Any],
        *,
        label: str,
        mode: str,
    ) -> None:
        if not self.enabled or not is_cacheable_response(response):
            return

        book = self._load_book(rulebook_id)
        stored = deepcopy(response)
        stored.pop("cached", None)
        stored.pop("cached_at", None)

        book["entries"][lookup_key] = {
            "mode": mode,
            "label": label,
            "created_at": datetime.now(UTC).isoformat(),
            "response": stored,
        }
        self._evict_if_needed(book)
        self._save_book(rulebook_id)

    def _evict_if_needed(self, book: dict[str, Any]) -> None:
        entries: dict[str, Any] = book["entries"]
        overflow = len(entries) - self.max_entries
        if overflow <= 0:
            return

        oldest = sorted(
            entries.items(),
            key=lambda item: item[1].get("created_at", ""),
        )[:overflow]
        for key, _ in oldest:
            del entries[key]

    def delete_rulebook(self, rulebook_id: str) -> None:
        self._books.pop(rulebook_id, None)
        path = self._path(rulebook_id)
        if path.exists():
            path.unlink()

    def clear_rulebook(self, rulebook_id: str) -> int:
        book = self._load_book(rulebook_id)
        count = len(book.get("entries", {}))
        self.delete_rulebook(rulebook_id)
        return count

    def list_entries(self, rulebook_id: str) -> list[dict[str, Any]]:
        book = self._load_book(rulebook_id)
        items = []
        for key, entry in book["entries"].items():
            items.append(
                {
                    "key": key,
                    "mode": entry.get("mode"),
                    "label": entry.get("label"),
                    "created_at": entry.get("created_at"),
                }
            )
        items.sort(key=lambda item: item.get("created_at", ""), reverse=True)
        return items
