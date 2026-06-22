"""SSE upload flow for rulebooks imported from BoardGameGeek."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from dataclasses import asdict
from typing import Any

from agents.pipeline import RefereePipeline
from services.bgg_fetch import BggDownloadError, BggError, download_rulebook_pdf
from services.rulebook_store import DuplicateRulebookError
from services.upload_stream import _sse
from services.upload_utils import safe_stored_filename


async def stream_bgg_rulebook_upload(
    pipeline: RefereePipeline,
    *,
    file_id: str,
    filename_hint: str | None,
    display_name: str | None,
    bgg_url: str | None = None,
) -> AsyncIterator[str]:
    loop = asyncio.get_running_loop()
    progress_queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

    def on_progress(event: dict[str, Any]) -> None:
        loop.call_soon_threadsafe(
            progress_queue.put_nowait,
            {"type": "progress", **event},
        )

    async def run_import() -> None:
        try:
            await progress_queue.put(
                {
                    "type": "progress",
                    "phase": "starting",
                    "page": 0,
                    "total_pages": 0,
                },
            )
            pdf_bytes, original_filename = await loop.run_in_executor(
                None,
                lambda: download_rulebook_pdf(
                    file_id,
                    filename_hint=filename_hint,
                    bgg_url=bgg_url,
                ),
            )
            stored_name = f"{uuid.uuid4()}_{safe_stored_filename(original_filename)}"
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
                },
            )
        except BggDownloadError as exc:
            await progress_queue.put(
                {
                    "type": "error",
                    "message": str(exc),
                    "bgg_url": exc.bgg_url,
                    "code": "bgg_manual_download",
                },
            )
        except BggError as exc:
            await progress_queue.put({"type": "error", "message": str(exc)})
        except DuplicateRulebookError as exc:
            existing = exc.existing
            await progress_queue.put(
                {
                    "type": "duplicate",
                    "message": str(exc),
                    "rulebook": asdict(existing),
                    "example_questions": pipeline.example_questions(existing.id),
                },
            )
        except Exception as exc:
            await progress_queue.put({"type": "error", "message": str(exc)})
        finally:
            await progress_queue.put(None)

    import_task = asyncio.create_task(run_import())

    try:
        while True:
            item = await progress_queue.get()
            if item is None:
                break
            event_type = item.pop("type")
            yield _sse(event_type, item)
    finally:
        await import_task
