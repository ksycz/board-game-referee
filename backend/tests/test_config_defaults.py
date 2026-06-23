"""Tests for environment-driven config defaults."""

import importlib

import config


def test_rate_limit_defaults_on_for_demo_mode(monkeypatch):
    monkeypatch.delenv("RATE_LIMIT_ENABLED", raising=False)
    monkeypatch.setenv("DEMO_MODE", "true")
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.delenv("API_ACCESS_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    importlib.reload(config)

    assert config.RATE_LIMIT_ENABLED is True


def test_rate_limit_defaults_on_for_anthropic_key(monkeypatch):
    monkeypatch.delenv("RATE_LIMIT_ENABLED", raising=False)
    monkeypatch.delenv("DEMO_MODE", raising=False)
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.delenv("API_ACCESS_KEY", raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")

    importlib.reload(config)

    assert config.RATE_LIMIT_ENABLED is True
