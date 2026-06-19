"""API smoke tests using FastAPI TestClient."""

import importlib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

SAMPLE_PDF = Path(__file__).parent / "fixtures" / "sample-rulebook.pdf"


@pytest.fixture
def client(tmp_path, monkeypatch):
    data = tmp_path / "data"
    monkeypatch.setattr("config.DATA_DIR", data)
    monkeypatch.setattr("config.RULEBOOKS_DIR", data / "rulebooks")
    monkeypatch.setattr("config.CHROMA_DIR", data / "chroma")
    monkeypatch.setattr("services.vector_store.CHROMA_DIR", data / "chroma")
    monkeypatch.setattr("config.ANTHROPIC_API_KEY", "")

    import main

    importlib.reload(main)
    return TestClient(main.app)


def test_health(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_upload_and_list(client):
    assert SAMPLE_PDF.exists()
    with SAMPLE_PDF.open("rb") as f:
        res = client.post(
            "/api/rulebooks",
            files={"file": ("sample-rulebook.pdf", f, "application/pdf")},
            data={"name": "Test Game"},
        )
    assert res.status_code == 200
    body = res.json()
    assert body["rulebook"]["name"] == "Test Game"
    assert body["ingestion"]["pages_extracted"] == 4

    listed = client.get("/api/rulebooks").json()
    assert len(listed) == 1
    assert listed[0]["page_count"] == 4


def test_ask_without_api_key_returns_error(client):
    with SAMPLE_PDF.open("rb") as f:
        upload = client.post(
            "/api/rulebooks",
            files={"file": ("sample-rulebook.pdf", f, "application/pdf")},
            data={"name": "Test Game"},
        )
    book_id = upload.json()["rulebook"]["id"]

    res = client.post(
        f"/api/rulebooks/{book_id}/ask",
        json={"question": "Can I attack on the first turn?"},
    )
    assert res.status_code in (400, 500)
    detail = res.json()["detail"].lower()
    assert "anthropic" in detail or "api_key" in detail


def test_ask_accepts_optional_history(client):
    with SAMPLE_PDF.open("rb") as f:
        upload = client.post(
            "/api/rulebooks",
            files={"file": ("sample-rulebook.pdf", f, "application/pdf")},
            data={"name": "Test Game"},
        )
    book_id = upload.json()["rulebook"]["id"]

    res = client.post(
        f"/api/rulebooks/{book_id}/ask",
        json={
            "question": "What about on the first turn?",
            "history": [
                {"role": "user", "content": "Can I attack on my turn?"},
                {"role": "assistant", "content": "Yes, during the attack phase."},
            ],
        },
    )
    assert res.status_code in (400, 500)
    detail = res.json()["detail"].lower()
    assert "anthropic" in detail or "api_key" in detail
