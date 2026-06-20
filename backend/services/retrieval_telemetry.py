"""Retrieval quality metrics and optional JSONL logging."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config import (
    RETRIEVAL_LOG_PATH,
    RETRIEVAL_TELEMETRY,
    RULING_FEEDBACK_ENABLED,
    RULING_FEEDBACK_LOG_PATH,
)


def cited_pages(ruling: dict) -> list[int]:
    pages: list[int] = []
    for citation in ruling.get("citations") or []:
        page = citation.get("page")
        if isinstance(page, int) and page not in pages:
            pages.append(page)
    return sorted(pages)


def compute_retrieval_metrics(
    retrieved_pages: list[int],
    ruling: dict,
    citation_check: dict,
) -> dict[str, Any]:
    """Compare retrieved pages to cited pages and citation validation."""
    retrieved = sorted(set(retrieved_pages))
    cited = cited_pages(ruling)
    cited_set = set(cited)
    retrieved_set = set(retrieved)
    cited_in_retrieval = sorted(cited_set & retrieved_set)
    cited_missing = sorted(cited_set - retrieved_set)

    validated = citation_check.get("citations") or []
    valid_count = sum(1 for entry in validated if entry.get("valid"))
    checked_count = len(validated)

    recall: float | None = None
    if cited:
        recall = len(cited_in_retrieval) / len(cited)

    return {
        "retrieved_pages": retrieved,
        "cited_pages": cited,
        "cited_in_retrieval": cited_in_retrieval,
        "cited_missing_from_retrieval": cited_missing,
        "citation_recall": recall,
        "citations_checked": checked_count,
        "citations_valid": valid_count,
        "citation_pass_rate": (valid_count / checked_count) if checked_count else None,
        "all_citations_valid": bool(citation_check.get("all_valid")),
    }


def log_retrieval_event(
    event: dict[str, Any],
    *,
    log_path: Path | None = None,
    enabled: bool | None = None,
) -> None:
    if enabled is None:
        enabled = RETRIEVAL_TELEMETRY
    if not enabled:
        return

    path = log_path or RETRIEVAL_LOG_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **event,
    }
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False) + "\n")


def log_ruling_feedback(
    event: dict[str, Any],
    *,
    log_path: Path | None = None,
    enabled: bool | None = None,
) -> None:
    if enabled is None:
        enabled = RULING_FEEDBACK_ENABLED
    if not enabled:
        return

    path = log_path or RULING_FEEDBACK_LOG_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "event": "ruling_feedback",
        **event,
    }
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False) + "\n")


def summarize_telemetry_log(log_path: Path) -> dict[str, Any]:
    if not log_path.exists():
        return {"events": 0}

    events: list[dict[str, Any]] = []
    with log_path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            events.append(json.loads(line))

    if not events:
        return {"events": 0}

    recalls = [
        event["metrics"]["citation_recall"]
        for event in events
        if event.get("metrics", {}).get("citation_recall") is not None
    ]
    pass_rates = [
        event["metrics"]["citation_pass_rate"]
        for event in events
        if event.get("metrics", {}).get("citation_pass_rate") is not None
    ]
    missing = sum(
        len(event.get("metrics", {}).get("cited_missing_from_retrieval") or [])
        for event in events
    )

    return {
        "events": len(events),
        "avg_citation_recall": (sum(recalls) / len(recalls)) if recalls else None,
        "avg_citation_pass_rate": (sum(pass_rates) / len(pass_rates)) if pass_rates else None,
        "citations_missing_from_retrieval": missing,
        "all_valid_rate": sum(
            1 for event in events if event.get("metrics", {}).get("all_citations_valid")
        )
        / len(events),
    }
