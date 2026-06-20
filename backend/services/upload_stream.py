"""Server-sent events helpers for streaming rulebook uploads."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from dataclasses import asdict
from typing import Any

from agents.pipeline import RefereePipeline
from services.rulebook_store import DuplicateRulebookError


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
        except Exception as exc:
            await progress_queue.put({"type": "error", "message": str(exc)})
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
