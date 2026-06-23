"""Public demo mode: read-only access to pre-seeded rulebooks for anonymous users."""

from __future__ import annotations

from fastapi import HTTPException, Request

import config
from services.api_auth import verify_api_key

DEMO_READ_ONLY_MESSAGE = (
    "Uploads and library changes are disabled in the public demo. "
    "Use a private instance for full access."
)
DEMO_RULEBOOK_MESSAGE = "This rulebook is not available in the public demo."


def demo_mode_enabled() -> bool:
    return config.DEMO_MODE


def has_full_access(request: Request) -> bool:
    if not demo_mode_enabled():
        return True
    if not config.API_ACCESS_KEY:
        return False
    return verify_api_key(request)


def require_full_access(request: Request) -> None:
    if has_full_access(request):
        return
    raise HTTPException(
        status_code=403,
        detail={"code": "demo_readonly", "message": DEMO_READ_ONLY_MESSAGE},
    )


def require_rulebook_access(request: Request, store, rulebook_id: str) -> None:
    if has_full_access(request):
        return
    if not demo_mode_enabled():
        return
    book = store.get(rulebook_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Rulebook not found")
    if not book.demo:
        raise HTTPException(
            status_code=403,
            detail={"code": "demo_rulebook_only", "message": DEMO_RULEBOOK_MESSAGE},
        )


def filter_visible_rulebooks(request: Request, books: list) -> list:
    if not demo_mode_enabled() or has_full_access(request):
        return books
    return [book for book in books if book.demo]
