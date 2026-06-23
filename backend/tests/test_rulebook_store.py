"""Tests for rulebook path safety and persistence."""

import json

from config import RULEBOOKS_DIR
from services.rulebook_store import RulebookStore, resolve_rulebook_pdf_path


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
    assert not (rulebooks_dir / "index.json.tmp").exists()
