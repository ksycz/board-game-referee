"""API smoke tests using FastAPI TestClient."""

import importlib
import json

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
    body = res.json()
    assert body["status"] == "ok"
    assert body["model"]
    assert isinstance(body["ocr_fallback_enabled"], bool)
    assert isinstance(body["tesseract_installed"], bool)
    assert isinstance(body["ocr_available"], bool)
    assert body["ocr_available"] == (
        body["ocr_fallback_enabled"] and body["tesseract_installed"]
    )
    assert body["data_dir_writable"] is True


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


def test_upload_stream_emits_progress_and_complete(client, sample_pdf):
    with sample_pdf.open("rb") as f:
        res = client.post(
            "/api/rulebooks/upload-stream",
            files={"file": ("sample-rulebook.pdf", f, "application/pdf")},
            data={"name": "Stream Game"},
        )
    assert res.status_code == 200
    assert "text/event-stream" in res.headers.get("content-type", "")

    events: list[tuple[str, dict]] = []
    for block in res.text.strip().split("\n\n"):
        if not block.strip():
            continue
        event_name = "message"
        data_line = ""
        for line in block.split("\n"):
            if line.startswith("event:"):
                event_name = line.split(":", 1)[1].strip()
            elif line.startswith("data:"):
                data_line = line.split(":", 1)[1].strip()
        if data_line:
            import json

            events.append((event_name, json.loads(data_line)))

    event_names = [name for name, _ in events]
    assert "progress" in event_names
    assert "complete" in event_names

    complete = next(payload for name, payload in events if name == "complete")
    assert complete["rulebook"]["name"] == "Stream Game"
    assert complete["ingestion"]["pages_extracted"] == 4


def test_upload_stream_duplicate_emits_duplicate_event(client, sample_pdf):
    with sample_pdf.open("rb") as f:
        client.post(
            "/api/rulebooks/upload-stream",
            files={"file": ("sample-rulebook.pdf", f, "application/pdf")},
            data={"name": "First"},
        )

    with sample_pdf.open("rb") as f:
        res = client.post(
            "/api/rulebooks/upload-stream",
            files={"file": ("copy.pdf", f, "application/pdf")},
            data={"name": "Second"},
        )
    assert res.status_code == 200
    assert "event: duplicate" in res.text
    assert '"example_questions"' in res.text


def test_pin_rulebook(client, sample_pdf):
    with sample_pdf.open("rb") as f:
        upload = client.post(
            "/api/rulebooks",
            files={"file": ("sample-rulebook.pdf", f, "application/pdf")},
            data={"name": "Pin Test"},
        )
    book_id = upload.json()["rulebook"]["id"]

    pin = client.patch(f"/api/rulebooks/{book_id}/pin", json={"pinned": True})
    assert pin.status_code == 200
    assert pin.json()["pinned"] is True

    listed = client.get("/api/rulebooks").json()
    assert listed[0]["id"] == book_id
    assert listed[0]["pinned"] is True

    unpin = client.patch(f"/api/rulebooks/{book_id}/pin", json={"pinned": False})
    assert unpin.status_code == 200
    assert unpin.json()["pinned"] is False


def test_pin_unknown_rulebook_returns_404(client):
    res = client.patch("/api/rulebooks/missing-id/pin", json={"pinned": True})
    assert res.status_code == 404


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


def test_dispute_without_api_key_returns_error(client, sample_pdf):
    with sample_pdf.open("rb") as f:
        upload = client.post(
            "/api/rulebooks",
            files={"file": ("sample-rulebook.pdf", f, "application/pdf")},
            data={"name": "Test Game"},
        )
    book_id = upload.json()["rulebook"]["id"]

    res = client.post(
        f"/api/rulebooks/{book_id}/dispute",
        json={
            "situation": "Can I attack on the first turn?",
            "player_a": "Yes, combat is allowed.",
            "player_b": "No, setup forbids it.",
        },
    )
    assert res.status_code in (400, 500)
    detail = res.json()["detail"].lower()
    assert "anthropic" in detail or "api_key" in detail


def test_dispute_rejects_short_arguments(client, sample_pdf):
    with sample_pdf.open("rb") as f:
        upload = client.post(
            "/api/rulebooks",
            files={"file": ("sample-rulebook.pdf", f, "application/pdf")},
            data={"name": "Test Game"},
        )
    book_id = upload.json()["rulebook"]["id"]

    res = client.post(
        f"/api/rulebooks/{book_id}/dispute",
        json={
            "situation": "ok",
            "player_a": "yes",
            "player_b": "no",
        },
    )
    assert res.status_code == 422


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


def test_clear_faq_cache(client, sample_pdf):
    with sample_pdf.open("rb") as f:
        upload = client.post(
            "/api/rulebooks",
            files={"file": ("sample-rulebook.pdf", f, "application/pdf")},
            data={"name": "Test Game"},
        )
    book_id = upload.json()["rulebook"]["id"]

    res = client.delete(f"/api/rulebooks/{book_id}/faq-cache")
    assert res.status_code == 200
    assert res.json() == {"cleared": 0}


def test_clear_faq_cache_unknown_book_returns_404(client):
    res = client.delete("/api/rulebooks/does-not-exist/faq-cache")
    assert res.status_code == 404
    assert res.json()["detail"] == "Rulebook not found"


def test_rulebook_page_preview(client, sample_pdf):
    with sample_pdf.open("rb") as f:
        upload = client.post(
            "/api/rulebooks",
            files={"file": ("sample-rulebook.pdf", f, "application/pdf")},
            data={"name": "Test Game"},
        )
    book_id = upload.json()["rulebook"]["id"]

    res = client.get(f"/api/rulebooks/{book_id}/pages/1/preview")
    assert res.status_code == 200
    assert res.headers["content-type"] == "image/png"
    assert res.content.startswith(b"\x89PNG\r\n\x1a\n")


def test_rulebook_page_preview_unknown_book_returns_404(client):
    res = client.get("/api/rulebooks/does-not-exist/pages/1/preview")
    assert res.status_code == 404


def test_rulebook_page_preview_invalid_page_returns_400(client, sample_pdf):
    with sample_pdf.open("rb") as f:
        upload = client.post(
            "/api/rulebooks",
            files={"file": ("sample-rulebook.pdf", f, "application/pdf")},
            data={"name": "Test Game"},
        )
    book_id = upload.json()["rulebook"]["id"]

    res = client.get(f"/api/rulebooks/{book_id}/pages/0/preview")
    assert res.status_code == 400

    res = client.get(f"/api/rulebooks/{book_id}/pages/999/preview")
    assert res.status_code == 400


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


def test_ruling_feedback(client, sample_pdf, tmp_path, monkeypatch):
    monkeypatch.setattr("config.RULING_FEEDBACK_LOG_PATH", tmp_path / "feedback.jsonl")
    monkeypatch.setattr(
        "services.retrieval_telemetry.RULING_FEEDBACK_LOG_PATH",
        tmp_path / "feedback.jsonl",
    )

    with sample_pdf.open("rb") as f:
        upload = client.post(
            "/api/rulebooks",
            files={"file": ("sample-rulebook.pdf", f, "application/pdf")},
            data={"name": "Test Game"},
        )
    book_id = upload.json()["rulebook"]["id"]

    res = client.post(
        f"/api/rulebooks/{book_id}/feedback",
        json={
            "response_id": "abc12345-response",
            "helpful": False,
            "mode": "ask",
            "cached": True,
            "confidence": "medium",
            "question": "Can I attack?",
            "retrieved_pages": [1, 2],
        },
    )
    assert res.status_code == 200
    assert res.json() == {"recorded": True}

    payload = json.loads((tmp_path / "feedback.jsonl").read_text(encoding="utf-8").strip())
    assert payload["helpful"] is False
    assert payload["rulebook_id"] == book_id
    assert payload["response_id"] == "abc12345-response"


def test_ruling_feedback_unknown_book_returns_404(client):
    res = client.post(
        "/api/rulebooks/missing-id/feedback",
        json={
            "response_id": "abc12345-response",
            "helpful": True,
        },
    )
    assert res.status_code == 404
