"""Server-sent events helpers for streaming rulebook uploads."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from dataclasses import asdict
from typing import Any

from agents.pipeline import RefereePipeline
from services.bgg_fetch import BggDownloadError, BggError, download_rulebook_pdf
from services.rulebook_store import DuplicateRulebookError

logger = logging.getLogger(__name__)

GENERIC_STREAM_ERROR = "Something went wrong. Please try again."


def stream_error_message(exc: Exception) -> str:
    if isinstance(exc, (DuplicateRulebookError, KeyError, FileNotFoundError, ValueError)):
        return str(exc)
    return GENERIC_STREAM_ERROR


def _sse(event: str, payload: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload)}\n\n"


async def stream_rulebook_upload(
    pipeline: RefereePipeline,
    *,
    display_name: str | None,
    stored_name: str,
    pdf_bytes: bytes,
    original_filename: str,
) -> AsyncIterator[str]:
    """Run upload in a worker thread and yield SSE progress events."""
    loop = asyncio.get_running_loop()
    progress_queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

    def on_progress(event: dict[str, Any]) -> None:
        loop.call_soon_threadsafe(
            progress_queue.put_nowait,
            {"type": "progress", **event},
        )

    async def run_upload() -> None:
        try:
            result = await loop.run_in_executor(
                None,
                lambda: pipeline.upload_rulebook(
                    display_name,
                    stored_name,
                    pdf_bytes,
                    original_filename=original_filename,
                    on_progress=on_progress,
                ),
            )
            await progress_queue.put(
                {
                    "type": "complete",
                    "rulebook": asdict(result["rulebook"]),
                    "ingestion": result["ingestion"],
                    "example_questions": result["example_questions"],
                }
            )
        except DuplicateRulebookError as exc:
            existing = exc.existing
            await progress_queue.put(
                {
                    "type": "duplicate",
                    "message": str(exc),
                    "rulebook": asdict(existing),
                    "example_questions": pipeline.example_questions(existing.id),
                }
            )
        except BggDownloadError as exc:
            await progress_queue.put(
                {
                    "type": "error",
                    "message": str(exc),
                    "code": "bgg_manual_download",
                    "bgg_url": exc.bgg_url,
                }
            )
        except Exception as exc:
            logger.exception("Rulebook upload failed")
            await progress_queue.put({"type": "error", "message": stream_error_message(exc)})
        finally:
            await progress_queue.put(None)

    upload_task = asyncio.create_task(run_upload())

    try:
        while True:
            item = await progress_queue.get()
            if item is None:
                break
            event_type = item.pop("type")
            yield _sse(event_type, item)
    finally:
        await upload_task


async def stream_bgg_rulebook_import(
    pipeline: RefereePipeline,
    *,
    file_id: str,
    bgg_url: str,
    filename_hint: str,
    display_name: str | None,
    stored_name: str,
) -> AsyncIterator[str]:
    """Download a BGG PDF, then stream upload progress events."""
    loop = asyncio.get_running_loop()
    yield _sse("progress", {"phase": "starting", "page": 0, "total_pages": 0})

    try:
        pdf_bytes, original_filename = await loop.run_in_executor(
            None,
            lambda: download_rulebook_pdf(
                file_id,
                filename_hint=filename_hint,
                bgg_url=bgg_url,
            ),
        )
    except BggDownloadError as exc:
        yield _sse(
            "error",
            {
                "message": str(exc),
                "code": "bgg_manual_download",
                "bgg_url": exc.bgg_url,
            },
        )
        return
    except BggError as exc:
        yield _sse("error", {"message": str(exc)})
        return
    except Exception as exc:
        logger.exception("BGG rulebook download failed")
        yield _sse("error", {"message": GENERIC_STREAM_ERROR})
        return

    async for event in stream_rulebook_upload(
        pipeline,
        display_name=display_name,
        stored_name=stored_name,
        pdf_bytes=pdf_bytes,
        original_filename=original_filename,
    ):
        yield event
