"""Tests for demo rulebook seeding."""

import importlib

from fastapi.testclient import TestClient

from services.demo_seed import seed_demo_rulebook_if_needed


def test_seed_demo_rulebook_creates_demo_book(tmp_path, monkeypatch):
    data = tmp_path / "data"
    rulebooks_dir = data / "rulebooks"
    chroma_dir = data / "chroma"
    monkeypatch.setattr("config.DATA_DIR", data)
    monkeypatch.setattr("config.RULEBOOKS_DIR", rulebooks_dir)
    monkeypatch.setattr("config.CHROMA_DIR", chroma_dir)
    monkeypatch.setattr("config.ANTHROPIC_API_KEY", "")
    monkeypatch.setattr("config.DEMO_MODE", True)
    monkeypatch.setattr("config.PRESEED_DEMO_RULEBOOK", True)
    monkeypatch.setattr("config.RATE_LIMIT_ENABLED", False)
    monkeypatch.setattr("services.vector_store.CHROMA_DIR", chroma_dir)
    monkeypatch.setattr("services.rulebook_store.RULEBOOKS_DIR", rulebooks_dir)

    import main

    importlib.reload(main)

    with TestClient(main.app) as client:
        res = client.get("/api/rulebooks")
        assert res.status_code == 200
        books = res.json()
        assert len(books) == 1
        assert books[0]["demo"] is True
        assert "Demo" in books[0]["name"]

    demo_books = [book for book in main.pipeline.store.list() if book.demo]
    assert len(demo_books) == 1

    book_id = seed_demo_rulebook_if_needed(main.pipeline)
    assert book_id == demo_books[0].id


def test_seed_does_not_mark_private_duplicate_as_demo(tmp_path, monkeypatch, sample_pdf):
    data = tmp_path / "data"
    rulebooks_dir = data / "rulebooks"
    chroma_dir = data / "chroma"
    monkeypatch.setattr("config.DATA_DIR", data)
    monkeypatch.setattr("config.RULEBOOKS_DIR", rulebooks_dir)
    monkeypatch.setattr("config.CHROMA_DIR", chroma_dir)
    monkeypatch.setattr("config.ANTHROPIC_API_KEY", "")
    monkeypatch.setattr("config.PRESEED_DEMO_RULEBOOK", True)
    monkeypatch.setattr("services.vector_store.CHROMA_DIR", chroma_dir)
    monkeypatch.setattr("services.rulebook_store.RULEBOOKS_DIR", rulebooks_dir)
    monkeypatch.setattr("services.demo_seed._demo_pdf_path", lambda: sample_pdf)

    from agents.pipeline import RefereePipeline

    pipeline = RefereePipeline()
    private = pipeline.upload_rulebook(
        "Private Game",
        "private.pdf",
        sample_pdf.read_bytes(),
        original_filename="sample-rulebook.pdf",
    )
    assert private["rulebook"].demo is False

    seeded_id = seed_demo_rulebook_if_needed(pipeline)
    assert seeded_id is None
    private_book = pipeline.store.get(private["rulebook"].id)
    assert private_book is not None
    assert private_book.demo is False
    assert not any(book.demo for book in pipeline.store.list())
