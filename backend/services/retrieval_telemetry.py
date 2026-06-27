"""Retrieval quality metrics and optional JSONL logging."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from config import (
    IS_PRODUCTION,
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


def compute_confidence_hint(
    *,
    chunks_found: int,
    ruling: dict,
    citation_check: dict,
    metrics: dict[str, Any],
) -> dict[str, Any] | None:
    """Explain when retrieval or citations look weak."""
    messages: list[str] = []
    severity = 0

    if chunks_found == 0:
        messages.append("No rulebook passages matched this question.")
        severity = max(severity, 2)
    elif chunks_found <= 2:
        messages.append("Only a few rulebook passages matched this question.")
        severity = max(severity, 1)

    missing = metrics.get("cited_missing_from_retrieval") or []
    if missing:
        page_list = ", ".join(str(page) for page in missing)
        messages.append(f"Cited page(s) {page_list} were not in the retrieved passages.")
        severity = max(severity, 1)

    invalid_count = sum(
        1 for entry in citation_check.get("citations") or [] if entry.get("valid") is False
    )
    if invalid_count:
        label = "citation" if invalid_count == 1 else "citations"
        messages.append(
            f"{invalid_count} {label} could not be verified against the retrieved rulebook text."
        )
        severity = max(severity, 1)

    pass_rate = metrics.get("citation_pass_rate")
    if pass_rate is not None and pass_rate < 0.5 and metrics.get("citations_checked", 0) > 0:
        messages.append("Most citations failed verification against retrieved passages.")
        severity = max(severity, 2)

    referee_confidence = ruling.get("confidence")
    if referee_confidence == "low":
        messages.append("The referee reported low confidence in this ruling.")
        severity = max(severity, 2)
    elif referee_confidence == "medium" and severity >= 1:
        messages.append("The referee reported medium confidence in this ruling.")

    if not messages:
        return None

    return {
        "level": "low" if severity >= 2 else "caution",
        "messages": messages,
    }


def _redact_sensitive_fields(event: dict[str, Any]) -> dict[str, Any]:
    """Strip user prompts from telemetry outside production."""
    if IS_PRODUCTION:
        return event
    redacted = dict(event)
    for field in ("question", "situation", "search_query"):
        if field in redacted:
            redacted[field] = "[redacted]"
    return redacted


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
        "timestamp": datetime.now(UTC).isoformat(),
        **_redact_sensitive_fields(event),
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
        "timestamp": datetime.now(UTC).isoformat(),
        "event": "ruling_feedback",
        **_redact_sensitive_fields(event),
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
        len(event.get("metrics", {}).get("cited_missing_from_retrieval") or []) for event in events
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
