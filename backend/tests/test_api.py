"""API smoke tests using FastAPI TestClient."""

import importlib

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    data = tmp_path / "data"
    rulebooks_dir = data / "rulebooks"
    chroma_dir = data / "chroma"
    monkeypatch.setattr("config.DATA_DIR", data)
    monkeypatch.setattr("config.RULEBOOKS_DIR", rulebooks_dir)
    monkeypatch.setattr("config.CHROMA_DIR", chroma_dir)
    monkeypatch.setattr("services.vector_store.CHROMA_DIR", chroma_dir)
    monkeypatch.setattr("services.rulebook_store.RULEBOOKS_DIR", rulebooks_dir)
    monkeypatch.setattr("config.ANTHROPIC_API_KEY", "")

    import main

    importlib.reload(main)
    return TestClient(main.app)


def test_health(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_upload_and_list(client, sample_pdf):
    with sample_pdf.open("rb") as f:
        res = client.post(
            "/api/rulebooks",
            files={"file": ("sample-rulebook.pdf", f, "application/pdf")},
            data={"name": "Test Game"},
        )
    assert res.status_code == 200
    body = res.json()
    assert body["rulebook"]["name"] == "Test Game"
    assert body["ingestion"]["pages_extracted"] == 4
    assert len(body["example_questions"]) == 3

    listed = client.get("/api/rulebooks").json()
    assert len(listed) == 1
    assert listed[0]["page_count"] == 4


def test_upload_duplicate_pdf_returns_409(client, sample_pdf):
    with sample_pdf.open("rb") as f:
        first = client.post(
            "/api/rulebooks",
            files={"file": ("sample-rulebook.pdf", f, "application/pdf")},
            data={"name": "Test Game"},
        )
    assert first.status_code == 200
    book_id = first.json()["rulebook"]["id"]

    with sample_pdf.open("rb") as f:
        second = client.post(
            "/api/rulebooks",
            files={"file": ("renamed-copy.pdf", f, "application/pdf")},
            data={"name": "Another Name"},
        )
    assert second.status_code == 409
    body = second.json()
    assert body["detail"]["rulebook"]["id"] == book_id
    assert len(body["detail"]["example_questions"]) == 3

    listed = client.get("/api/rulebooks").json()
    assert len(listed) == 1


def test_list_dedupes_existing_duplicates(client, sample_pdf):
    import main
    from services.rulebook_store import pdf_content_hash

    pdf_bytes = sample_pdf.read_bytes()
    content_hash = pdf_content_hash(pdf_bytes)
    store = main.pipeline.store
    rulebooks_dir = store._index_path.parent

    first = store.add("Game A", "a.pdf", 4, content_hash=content_hash)
    second = store.add("Game B", "b.pdf", 4, content_hash=content_hash)
    (rulebooks_dir / first.filename).write_bytes(pdf_bytes)
    (rulebooks_dir / second.filename).write_bytes(pdf_bytes)

    listed = client.get("/api/rulebooks").json()
    assert len(listed) == 1
    assert listed[0]["id"] == first.id
    assert store.get(second.id) is None


def test_ask_without_api_key_returns_error(client, sample_pdf):
    with sample_pdf.open("rb") as f:
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


def test_ask_accepts_optional_history(client, sample_pdf):
    with sample_pdf.open("rb") as f:
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


def test_delete_rulebook(client, sample_pdf):
    with sample_pdf.open("rb") as f:
        upload = client.post(
            "/api/rulebooks",
            files={"file": ("sample-rulebook.pdf", f, "application/pdf")},
            data={"name": "Test Game"},
        )
    book_id = upload.json()["rulebook"]["id"]

    res = client.delete(f"/api/rulebooks/{book_id}")
    assert res.status_code == 200
    assert res.json() == {"deleted": book_id}

    listed = client.get("/api/rulebooks").json()
    assert listed == []


def test_delete_unknown_rulebook_returns_404(client):
    res = client.delete("/api/rulebooks/does-not-exist")
    assert res.status_code == 404
    assert res.json()["detail"] == "Rulebook not found"


def test_ask_rejects_invalid_history_role(client, sample_pdf):
    with sample_pdf.open("rb") as f:
        upload = client.post(
            "/api/rulebooks",
            files={"file": ("sample-rulebook.pdf", f, "application/pdf")},
            data={"name": "Test Game"},
        )
    book_id = upload.json()["rulebook"]["id"]

    res = client.post(
        f"/api/rulebooks/{book_id}/ask",
        json={
            "question": "Can I attack?",
            "history": [{"role": "system", "content": "You are helpful."}],
        },
    )
    assert res.status_code == 422


def test_rulebook_examples(client, sample_pdf):
    with sample_pdf.open("rb") as f:
        upload = client.post(
            "/api/rulebooks",
            files={"file": ("sample-rulebook.pdf", f, "application/pdf")},
            data={"name": "Test Game"},
        )
    book_id = upload.json()["rulebook"]["id"]

    res = client.get(f"/api/rulebooks/{book_id}/examples")
    assert res.status_code == 200
    questions = res.json()["questions"]
    assert len(questions) == 3
    assert all(isinstance(question, str) for question in questions)


def test_rulebook_examples_unknown_book_returns_404(client):
    res = client.get("/api/rulebooks/missing-id/examples")
    assert res.status_code == 404
