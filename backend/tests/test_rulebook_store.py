"""Tests for rulebook path safety and persistence."""

import json
import threading

import pytest

from config import RULEBOOKS_DIR
from services.rulebook_store import DuplicateRulebookError, RulebookStore, resolve_rulebook_pdf_path


def test_resolve_rulebook_pdf_path_stays_in_library():
    path = resolve_rulebook_pdf_path("../../evil.pdf")
    assert path.name == "evil.pdf"
    assert path.parent.resolve() == RULEBOOKS_DIR.resolve()


def test_rulebook_store_writes_index_atomically(tmp_path, monkeypatch):
    data = tmp_path / "data"
    rulebooks_dir = data / "rulebooks"
    rulebooks_dir.mkdir(parents=True)
    monkeypatch.setattr("config.RULEBOOKS_DIR", rulebooks_dir)
    monkeypatch.setattr("services.rulebook_store.RULEBOOKS_DIR", rulebooks_dir)

    store = RulebookStore()
    store.add("Game", "game.pdf", 4, content_hash="abc123")
    index_path = rulebooks_dir / "index.json"
    assert index_path.exists()
    payload = json.loads(index_path.read_text(encoding="utf-8"))
    assert payload[0]["name"] == "Game"
    assert not list(rulebooks_dir.glob("index.*.tmp"))


def test_add_raises_on_duplicate_content_hash(tmp_path, monkeypatch):
    data = tmp_path / "data"
    rulebooks_dir = data / "rulebooks"
    rulebooks_dir.mkdir(parents=True)
    monkeypatch.setattr("config.RULEBOOKS_DIR", rulebooks_dir)
    monkeypatch.setattr("services.rulebook_store.RULEBOOKS_DIR", rulebooks_dir)

    store = RulebookStore()
    store.add("Game A", "a.pdf", 4, content_hash="same-hash")
    with pytest.raises(DuplicateRulebookError):
        store.add("Game B", "b.pdf", 4, content_hash="same-hash")


def test_add_rejects_duplicate_content_hash_under_concurrency(tmp_path, monkeypatch):
    data = tmp_path / "data"
    rulebooks_dir = data / "rulebooks"
    rulebooks_dir.mkdir(parents=True)
    monkeypatch.setattr("config.RULEBOOKS_DIR", rulebooks_dir)
    monkeypatch.setattr("services.rulebook_store.RULEBOOKS_DIR", rulebooks_dir)

    store = RulebookStore()
    barrier = threading.Barrier(2)
    results: list[str] = []
    errors: list[DuplicateRulebookError] = []

    def add_book(name: str) -> None:
        barrier.wait()
        try:
            book = store.add(name, f"{name}.pdf", 1, content_hash="shared-hash")
            results.append(book.id)
        except DuplicateRulebookError as exc:
            errors.append(exc)

    threads = [threading.Thread(target=add_book, args=(f"Game {index}",)) for index in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert len(results) == 1
    assert len(errors) == 1
