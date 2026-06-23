"""Tests for public demo mode."""

import importlib

import pytest
from fastapi.testclient import TestClient


def _demo_client(tmp_path, monkeypatch, *, api_key: str = "") -> TestClient:
    data = tmp_path / "data"
    rulebooks_dir = data / "rulebooks"
    chroma_dir = data / "chroma"
    monkeypatch.setattr("config.DATA_DIR", data)
    monkeypatch.setattr("config.RULEBOOKS_DIR", rulebooks_dir)
    monkeypatch.setattr("config.CHROMA_DIR", chroma_dir)
    monkeypatch.setattr("config.ANTHROPIC_API_KEY", "")
    monkeypatch.setattr("config.API_ACCESS_KEY", api_key)
    monkeypatch.setattr("config.DEMO_MODE", True)
    monkeypatch.setattr("config.PRESEED_DEMO_RULEBOOK", False)
    monkeypatch.setattr("config.RATE_LIMIT_ENABLED", False)
    monkeypatch.setattr("services.vector_store.CHROMA_DIR", chroma_dir)
    monkeypatch.setattr("services.rulebook_store.RULEBOOKS_DIR", rulebooks_dir)

    import main

    importlib.reload(main)
    return TestClient(main.app)


def test_config_reports_demo_mode(tmp_path, monkeypatch):
    client = _demo_client(tmp_path, monkeypatch)
    res = client.get("/api/config")
    assert res.status_code == 200
    body = res.json()
    assert body["demo_mode"] is True
    assert body["full_access"] is False


def test_demo_blocks_upload_without_key(tmp_path, monkeypatch, sample_pdf):
    client = _demo_client(tmp_path, monkeypatch)
    with sample_pdf.open("rb") as f:
        res = client.post(
            "/api/rulebooks/upload-stream",
            files={"file": ("sample-rulebook.pdf", f, "application/pdf")},
        )
    assert res.status_code == 403
    assert res.json()["detail"]["code"] == "demo_readonly"


def test_demo_lists_only_demo_rulebooks(tmp_path, monkeypatch, sample_pdf):
    import main
    from services.rulebook_store import pdf_content_hash

    client = _demo_client(tmp_path, monkeypatch)
    store = main.pipeline.store
    pdf_bytes = sample_pdf.read_bytes()
    content_hash = pdf_content_hash(pdf_bytes)

    demo_book = store.add(
        "Demo Game",
        "demo.pdf",
        4,
        content_hash=content_hash,
        demo=True,
    )
    personal_book = store.add(
        "Private Game",
        "private.pdf",
        4,
        content_hash=content_hash + "x",
        demo=False,
    )
    rulebooks_dir = store._index_path.parent
    (rulebooks_dir / demo_book.filename).write_bytes(pdf_bytes)
    (rulebooks_dir / personal_book.filename).write_bytes(pdf_bytes)

    res = client.get("/api/rulebooks")
    assert res.status_code == 200
    ids = {book["id"] for book in res.json()}
    assert demo_book.id in ids
    assert personal_book.id not in ids


def test_demo_allows_ask_on_demo_book(tmp_path, monkeypatch, sample_pdf):
    import main
    from services.rulebook_store import pdf_content_hash

    client = _demo_client(tmp_path, monkeypatch)
    store = main.pipeline.store
    pdf_bytes = sample_pdf.read_bytes()
    demo_book = store.add(
        "Demo Game",
        "demo.pdf",
        4,
        content_hash=pdf_content_hash(pdf_bytes),
        demo=True,
    )
    (store._index_path.parent / demo_book.filename).write_bytes(pdf_bytes)

    def fake_ask(*args, **kwargs):
        return {
            "response_id": "demo-response",
            "mode": "ask",
            "rulebook_id": demo_book.id,
            "rulebook_name": demo_book.name,
            "question": kwargs.get("question", args[1] if len(args) > 1 else ""),
            "retrieval": {"chunks_found": 1, "pages": [1]},
            "ruling": {
                "ruling": "Yes.",
                "confidence": "high",
                "reasoning": "Rules say so.",
                "citations": [],
                "needs_clarification": False,
                "clarification_question": None,
            },
            "citation_check": {"all_valid": True, "issues": [], "citations": []},
        }

    monkeypatch.setattr(main.pipeline, "ask", fake_ask)

    res = client.post(
        f"/api/rulebooks/{demo_book.id}/ask",
        json={"question": "Can I attack on the first turn?"},
    )
    assert res.status_code == 200


def test_demo_blocks_ask_on_private_book(tmp_path, monkeypatch, sample_pdf):
    import main
    from services.rulebook_store import pdf_content_hash

    client = _demo_client(tmp_path, monkeypatch)
    store = main.pipeline.store
    pdf_bytes = sample_pdf.read_bytes()
    private_book = store.add(
        "Private Game",
        "private.pdf",
        4,
        content_hash=pdf_content_hash(pdf_bytes),
        demo=False,
    )
    (store._index_path.parent / private_book.filename).write_bytes(pdf_bytes)

    res = client.post(
        f"/api/rulebooks/{private_book.id}/ask",
        json={"question": "Can I attack on the first turn?"},
    )
    assert res.status_code == 403
    assert res.json()["detail"]["code"] == "demo_rulebook_only"


def test_api_key_grants_full_access_in_demo_mode(tmp_path, monkeypatch, sample_pdf):
    client = _demo_client(tmp_path, monkeypatch, api_key="household-secret")
    with sample_pdf.open("rb") as f:
        res = client.post(
            "/api/rulebooks/upload-stream",
            files={"file": ("sample-rulebook.pdf", f, "application/pdf")},
            headers={"X-API-Key": "household-secret"},
        )
    assert res.status_code == 200

    config_res = client.get("/api/config", headers={"X-API-Key": "household-secret"})
    assert config_res.json()["full_access"] is True
