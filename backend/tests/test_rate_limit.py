"""Tests for application rate limiting."""

import importlib

import pytest
from fastapi.testclient import TestClient

from services.rate_limit import limiter


@pytest.fixture
def rate_limited_client(tmp_path, monkeypatch):
    data = tmp_path / "data"
    rulebooks_dir = data / "rulebooks"
    chroma_dir = data / "chroma"
    monkeypatch.setattr("config.DATA_DIR", data)
    monkeypatch.setattr("config.RULEBOOKS_DIR", rulebooks_dir)
    monkeypatch.setattr("config.CHROMA_DIR", chroma_dir)
    monkeypatch.setattr("config.ANTHROPIC_API_KEY", "")
    monkeypatch.setattr("config.API_ACCESS_KEY", "")
    monkeypatch.setattr("config.RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr("config.RATE_LIMIT_DEFAULT_MAX", 2)
    monkeypatch.setattr("config.RATE_LIMIT_DEFAULT_WINDOW", 60.0)
    monkeypatch.setattr("services.vector_store.CHROMA_DIR", chroma_dir)
    monkeypatch.setattr("services.rulebook_store.RULEBOOKS_DIR", rulebooks_dir)

    import main

    importlib.reload(main)
    limiter.reset()
    return TestClient(main.app)


def test_rate_limit_returns_429(rate_limited_client):
    for _ in range(2):
        res = rate_limited_client.get("/api/rulebooks")
        assert res.status_code == 200

    res = rate_limited_client.get("/api/rulebooks")
    assert res.status_code == 429
    detail = res.json()["detail"]
    assert detail["code"] == "rate_limit"
    assert res.headers.get("Retry-After")


def test_health_is_not_rate_limited(rate_limited_client):
    for _ in range(5):
        res = rate_limited_client.get("/api/health")
        assert res.status_code == 200
