"""Optional API key authentication for /api routes."""

from __future__ import annotations

import secrets

from fastapi import Request

import config

AUTH_EXEMPT_PATHS = frozenset({"/api/health", "/api/config"})


def auth_enabled() -> bool:
    return bool(config.API_ACCESS_KEY)


def api_key_required(request: Request) -> bool:
    """Whether this request must present a valid API key before routing."""
    if not auth_enabled():
        return False
    if config.DEMO_MODE:
        return False
    return True


def extract_api_key(request: Request) -> str | None:
    header = request.headers.get("X-API-Key")
    if header:
        return header.strip()

    auth = request.headers.get("Authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return None


def verify_api_key(request: Request) -> bool:
    expected = config.API_ACCESS_KEY
    if not expected:
        return True
    provided = extract_api_key(request)
    if not provided:
        return False
    return secrets.compare_digest(provided, expected)
