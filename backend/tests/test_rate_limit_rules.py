"""Tests for rate limit rule selection."""

from services.rate_limit import rate_limit_rule_for_request


def test_llm_routes_use_llm_bucket():
    rule = rate_limit_rule_for_request("/api/rulebooks/abc/ask", "POST")
    assert rule is not None
    assert rule.name == "llm"


def test_upload_routes_use_expensive_bucket():
    rule = rate_limit_rule_for_request("/api/rulebooks/upload-stream", "POST")
    assert rule is not None
    assert rule.name == "expensive"


def test_preview_routes_use_preview_bucket():
    rule = rate_limit_rule_for_request("/api/rulebooks/abc/pages/3/preview", "GET")
    assert rule is not None
    assert rule.name == "preview"


def test_health_is_exempt():
    assert rate_limit_rule_for_request("/api/health", "GET") is None
