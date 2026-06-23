"""Seed a sample rulebook for public demo deployments."""

from __future__ import annotations

import logging
import uuid
from pathlib import Path

import config
from services.rulebook_store import DuplicateRulebookError

logger = logging.getLogger(__name__)

DEMO_RULEBOOK_NAME = "Sample Board Game (Demo)"
DEMO_SOURCE_FILENAME = "demo-rulebook.pdf"
_ASSET_PATH = Path(__file__).resolve().parent.parent / "assets" / DEMO_SOURCE_FILENAME
_FIXTURE_PATH = (
    Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "sample-rulebook.pdf"
)


def _demo_pdf_path() -> Path | None:
    if _ASSET_PATH.is_file():
        return _ASSET_PATH
    if _FIXTURE_PATH.is_file():
        return _FIXTURE_PATH
    return None


def _existing_demo_rulebook_id(pipeline) -> str | None:
    for book in pipeline.store.list():
        if book.demo:
            return book.id
    return None


def _mark_existing_as_demo(pipeline, book_id: str) -> str:
    book = pipeline.store.get(book_id)
    if book is None:
        raise KeyError(book_id)
    if not book.demo:
        book.demo = True
        pipeline.store._save()
    return book.id


def seed_demo_rulebook_if_needed(pipeline) -> str | None:
    """Ingest the bundled demo PDF when pre-seeding is enabled."""
    if not config.PRESEED_DEMO_RULEBOOK:
        return None

    existing_id = _existing_demo_rulebook_id(pipeline)
    if existing_id:
        return existing_id

    pdf_path = _demo_pdf_path()
    if pdf_path is None:
        logger.warning("Demo rulebook PDF not found; skipping pre-seed")
        return None

    pdf_bytes = pdf_path.read_bytes()
    stored_name = f"demo_{uuid.uuid4()}_{DEMO_SOURCE_FILENAME}"

    try:
        result = pipeline.upload_rulebook(
            DEMO_RULEBOOK_NAME,
            stored_name,
            pdf_bytes,
            original_filename=DEMO_SOURCE_FILENAME,
            demo=True,
        )
    except DuplicateRulebookError as exc:
        logger.info("Recovering existing PDF as demo rulebook after duplicate upload")
        return _mark_existing_as_demo(pipeline, exc.existing.id)
    except Exception:
        logger.exception("Failed to seed demo rulebook")
        return None

    book = result["rulebook"]
    logger.info('Seeded demo rulebook "%s" (%s)', book.name, book.id)
    return book.id
