"""Tests for API authentication."""

import importlib

import pytest
from fastapi.testclient import TestClient


def _client_with_auth(tmp_path, monkeypatch, *, api_key: str = "test-secret") -> TestClient:
    data = tmp_path / "data"
    rulebooks_dir = data / "rulebooks"
    chroma_dir = data / "chroma"
    monkeypatch.setattr("config.DATA_DIR", data)
    monkeypatch.setattr("config.RULEBOOKS_DIR", rulebooks_dir)
    monkeypatch.setattr("config.CHROMA_DIR", chroma_dir)
    monkeypatch.setattr("config.ANTHROPIC_API_KEY", "")
    monkeypatch.setattr("config.API_ACCESS_KEY", api_key)
    monkeypatch.setattr("config.RATE_LIMIT_ENABLED", False)
    monkeypatch.setattr("services.vector_store.CHROMA_DIR", chroma_dir)
    monkeypatch.setattr("services.rulebook_store.RULEBOOKS_DIR", rulebooks_dir)

    import main

    importlib.reload(main)
    return TestClient(main.app)


def test_health_is_public_without_api_key(tmp_path, monkeypatch):
    client = _client_with_auth(tmp_path, monkeypatch)
    res = client.get("/api/health")
    assert res.status_code == 200


def test_api_requires_key_when_configured(tmp_path, monkeypatch):
    client = _client_with_auth(tmp_path, monkeypatch)
    res = client.get("/api/rulebooks")
    assert res.status_code == 401


def test_api_accepts_x_api_key_header(tmp_path, monkeypatch):
    client = _client_with_auth(tmp_path, monkeypatch)
    res = client.get("/api/rulebooks", headers={"X-API-Key": "test-secret"})
    assert res.status_code == 200


def test_api_accepts_bearer_token(tmp_path, monkeypatch):
    client = _client_with_auth(tmp_path, monkeypatch)
    res = client.get(
        "/api/rulebooks",
        headers={"Authorization": "Bearer test-secret"},
    )
    assert res.status_code == 200


def test_api_rejects_wrong_key(tmp_path, monkeypatch):
    client = _client_with_auth(tmp_path, monkeypatch)
    res = client.get("/api/rulebooks", headers={"X-API-Key": "wrong"})
    assert res.status_code == 401
