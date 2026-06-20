"""Tests for rulebook metadata store."""

from services.rulebook_store import RulebookStore, pdf_content_hash


def test_find_by_content_hash_detects_duplicate(tmp_path, monkeypatch):
    rulebooks_dir = tmp_path / "rulebooks"
    rulebooks_dir.mkdir()
    monkeypatch.setattr("config.RULEBOOKS_DIR", rulebooks_dir)
    monkeypatch.setattr("services.rulebook_store.RULEBOOKS_DIR", rulebooks_dir)

    store = RulebookStore()
    pdf_bytes = b"%PDF-1.4 duplicate test"
    content_hash = pdf_content_hash(pdf_bytes)
    book = store.add(name="Test Game", filename="test.pdf", page_count=2, content_hash=content_hash)
    pdf_path = rulebooks_dir / book.filename
    pdf_path.write_bytes(pdf_bytes)

    assert store.find_by_content_hash(content_hash) == book
    assert store.find_by_content_hash("other-hash") is None


def test_delete_removes_rulebook_and_pdf(tmp_path, monkeypatch):
    rulebooks_dir = tmp_path / "rulebooks"
    rulebooks_dir.mkdir()
    monkeypatch.setattr("config.RULEBOOKS_DIR", rulebooks_dir)
    monkeypatch.setattr("services.rulebook_store.RULEBOOKS_DIR", rulebooks_dir)

    store = RulebookStore()
    pdf_bytes = b"%PDF-1.4 test"
    content_hash = pdf_content_hash(pdf_bytes)
    book = store.add(name="Test Game", filename="test.pdf", page_count=2, content_hash=content_hash)
    pdf_path = rulebooks_dir / book.filename
    pdf_path.write_bytes(b"%PDF-1.4")

    assert store.delete(book.id) is True
    assert store.get(book.id) is None
    assert not pdf_path.exists()


def test_delete_unknown_rulebook_returns_false(tmp_path, monkeypatch):
    rulebooks_dir = tmp_path / "rulebooks"
    rulebooks_dir.mkdir()
    monkeypatch.setattr("config.RULEBOOKS_DIR", rulebooks_dir)
    monkeypatch.setattr("services.rulebook_store.RULEBOOKS_DIR", rulebooks_dir)

    store = RulebookStore()
    assert store.delete("missing-id") is False


def test_pinned_rulebooks_sort_to_top(tmp_path, monkeypatch):
    rulebooks_dir = tmp_path / "rulebooks"
    rulebooks_dir.mkdir()
    monkeypatch.setattr("config.RULEBOOKS_DIR", rulebooks_dir)
    monkeypatch.setattr("services.rulebook_store.RULEBOOKS_DIR", rulebooks_dir)

    store = RulebookStore()
    pdf_bytes = b"%PDF-1.4 test"
    content_hash = pdf_content_hash(pdf_bytes)
    older = store.add(name="Older", filename="older.pdf", page_count=2, content_hash=content_hash)
    newer = store.add(
        name="Newer",
        filename="newer.pdf",
        page_count=2,
        content_hash=pdf_content_hash(b"%PDF-1.4 newer"),
    )
    (rulebooks_dir / older.filename).write_bytes(pdf_bytes)
    (rulebooks_dir / newer.filename).write_bytes(b"%PDF-1.4 newer")

    store.set_pinned(older.id, True)

    listed = store.list()
    assert listed[0].id == older.id
    assert listed[0].pinned is True


def test_set_pinned_unknown_rulebook_returns_none(tmp_path, monkeypatch):
    rulebooks_dir = tmp_path / "rulebooks"
    rulebooks_dir.mkdir()
    monkeypatch.setattr("config.RULEBOOKS_DIR", rulebooks_dir)
    monkeypatch.setattr("services.rulebook_store.RULEBOOKS_DIR", rulebooks_dir)

    store = RulebookStore()
    assert store.set_pinned("missing", True) is None
