"""SSE stream for re-indexing an existing rulebook PDF."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from dataclasses import asdict
from typing import Any

from agents.pipeline import RefereePipeline
from services.upload_stream import _sse


async def stream_rulebook_reindex(
    pipeline: RefereePipeline,
    *,
    rulebook_id: str,
) -> AsyncIterator[str]:
    loop = asyncio.get_running_loop()
    progress_queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

    def on_progress(event: dict[str, Any]) -> None:
        loop.call_soon_threadsafe(
            progress_queue.put_nowait,
            {"type": "progress", **event},
        )

    async def run_reindex() -> None:
        try:
            result = await loop.run_in_executor(
                None,
                lambda: pipeline.reindex(rulebook_id, on_progress=on_progress),
            )
            await progress_queue.put(
                {
                    "type": "complete",
                    "rulebook": asdict(result["rulebook"]),
                    "ingestion": result["ingestion"],
                    "example_questions": result["example_questions"],
                    "faq_cache_cleared": result["faq_cache_cleared"],
                },
            )
        except KeyError as exc:
            await progress_queue.put(
                {"type": "error", "message": str(exc), "code": "not_found"},
            )
        except FileNotFoundError as exc:
            await progress_queue.put(
                {"type": "error", "message": str(exc), "code": "not_found"},
            )
        except Exception as exc:
            await progress_queue.put({"type": "error", "message": str(exc)})
        finally:
            await progress_queue.put(None)

    reindex_task = asyncio.create_task(run_reindex())

    try:
        while True:
            item = await progress_queue.get()
            if item is None:
                break
            event_type = item.pop("type")
            yield _sse(event_type, item)
    finally:
        await reindex_task
