"""Tests for retrieval telemetry metrics."""

import json

from services.retrieval_telemetry import (
    cited_pages,
    compute_confidence_hint,
    compute_retrieval_metrics,
    log_retrieval_event,
    summarize_telemetry_log,
)


def test_cited_pages_deduplicates_and_sorts():
    ruling = {
        "citations": [
            {"page": 4, "quote": "a"},
            {"page": 2, "quote": "b"},
            {"page": 4, "quote": "c"},
            {"page": "bad", "quote": "d"},
        ]
    }
    assert cited_pages(ruling) == [2, 4]


def test_compute_retrieval_metrics_tracks_overlap_and_pass_rate():
    metrics = compute_retrieval_metrics(
        retrieved_pages=[2, 3, 5],
        ruling={"citations": [{"page": 2, "quote": "x"}, {"page": 7, "quote": "y"}]},
        citation_check={
            "all_valid": False,
            "citations": [
                {"page": 2, "valid": True},
                {"page": 7, "valid": False},
            ],
        },
    )

    assert metrics["retrieved_pages"] == [2, 3, 5]
    assert metrics["cited_pages"] == [2, 7]
    assert metrics["cited_in_retrieval"] == [2]
    assert metrics["cited_missing_from_retrieval"] == [7]
    assert metrics["citation_recall"] == 0.5
    assert metrics["citations_checked"] == 2
    assert metrics["citations_valid"] == 1
    assert metrics["citation_pass_rate"] == 0.5
    assert metrics["all_citations_valid"] is False


def test_compute_confidence_hint_flags_weak_retrieval_and_citations():
    metrics = compute_retrieval_metrics(
        retrieved_pages=[2, 3],
        ruling={"citations": [{"page": 2, "quote": "x"}, {"page": 7, "quote": "y"}], "confidence": "low"},
        citation_check={
            "all_valid": False,
            "citations": [{"page": 2, "valid": True}, {"page": 7, "valid": False}],
        },
    )

    hint = compute_confidence_hint(
        chunks_found=1,
        ruling={"citations": [{"page": 2}, {"page": 7}], "confidence": "low"},
        citation_check={
            "all_valid": False,
            "citations": [{"page": 2, "valid": True}, {"page": 7, "valid": False}],
        },
        metrics=metrics,
    )

    assert hint is not None
    assert hint["level"] == "low"
    assert any("few rulebook passages" in message for message in hint["messages"])
    assert any("page(s) 7" in message for message in hint["messages"])
    assert any("low confidence" in message for message in hint["messages"])


def test_compute_confidence_hint_returns_none_when_grounding_is_strong():
    metrics = compute_retrieval_metrics(
        retrieved_pages=[2, 3, 4],
        ruling={"citations": [{"page": 2, "quote": "x"}], "confidence": "high"},
        citation_check={"all_valid": True, "citations": [{"page": 2, "valid": True}]},
    )

    hint = compute_confidence_hint(
        chunks_found=5,
        ruling={"citations": [{"page": 2}], "confidence": "high"},
        citation_check={"all_valid": True, "citations": [{"page": 2, "valid": True}]},
        metrics=metrics,
    )

    assert hint is None


def test_log_retrieval_event_writes_jsonl(tmp_path):
    log_path = tmp_path / "telemetry.jsonl"
    log_retrieval_event(
        {"mode": "ask", "metrics": {"citation_recall": 1.0}},
        log_path=log_path,
        enabled=True,
    )
    log_retrieval_event(
        {"mode": "ask", "metrics": {"citation_recall": 0.5}},
        log_path=log_path,
        enabled=True,
    )

    lines = log_path.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 2
    first = json.loads(lines[0])
    assert first["mode"] == "ask"
    assert "timestamp" in first


def test_log_ruling_feedback_writes_jsonl(tmp_path):
    from services.retrieval_telemetry import log_ruling_feedback

    log_path = tmp_path / "feedback.jsonl"
    log_ruling_feedback(
        {
            "rulebook_id": "book-1",
            "response_id": "resp-123",
            "helpful": True,
            "mode": "ask",
        },
        log_path=log_path,
        enabled=True,
    )

    payload = json.loads(log_path.read_text(encoding="utf-8").strip())
    assert payload["event"] == "ruling_feedback"
    assert payload["helpful"] is True
    assert payload["response_id"] == "resp-123"
    assert "timestamp" in payload


def test_summarize_telemetry_log(tmp_path):
    log_path = tmp_path / "telemetry.jsonl"
    events = [
        {
            "metrics": {
                "citation_recall": 1.0,
                "citation_pass_rate": 1.0,
                "cited_missing_from_retrieval": [],
                "all_citations_valid": True,
            }
        },
        {
            "metrics": {
                "citation_recall": 0.5,
                "citation_pass_rate": 0.5,
                "cited_missing_from_retrieval": [9],
                "all_citations_valid": False,
            }
        },
    ]
    log_path.write_text("\n".join(json.dumps(event) for event in events) + "\n", encoding="utf-8")

    summary = summarize_telemetry_log(log_path)
    assert summary["events"] == 2
    assert summary["avg_citation_recall"] == 0.75
    assert summary["avg_citation_pass_rate"] == 0.75
    assert summary["citations_missing_from_retrieval"] == 1
    assert summary["all_valid_rate"] == 0.5
