"""Deployment configuration guards."""

import pytest

from main import _validate_deployment_config


def test_requires_api_access_key_in_production(monkeypatch):
    monkeypatch.setattr("main.IS_PRODUCTION", True)
    monkeypatch.setattr("main.DEMO_MODE", False)
    monkeypatch.setattr("main.ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setattr("main.API_ACCESS_KEY", "")
    with pytest.raises(RuntimeError, match="API_ACCESS_KEY"):
        _validate_deployment_config()


def test_allows_hybrid_demo_without_blocking(monkeypatch):
    monkeypatch.setattr("main.IS_PRODUCTION", True)
    monkeypatch.setattr("main.DEMO_MODE", True)
    monkeypatch.setattr("main.ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setattr("main.API_ACCESS_KEY", "")
    _validate_deployment_config()


def test_allows_private_deploy_with_access_key(monkeypatch):
    monkeypatch.setattr("main.IS_PRODUCTION", True)
    monkeypatch.setattr("main.DEMO_MODE", False)
    monkeypatch.setattr("main.ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setattr("main.API_ACCESS_KEY", "secret")
    _validate_deployment_config()
