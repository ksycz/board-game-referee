"""In-memory per-IP rate limiting for API routes."""

from __future__ import annotations

import re
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from threading import Lock

from fastapi import Request

import config

_PREVIEW_PATH = re.compile(
    r"^/api/rulebooks/[^/]+/pages/\d+/preview$",
)


@dataclass(frozen=True)
class RateLimitRule:
    name: str
    max_requests: int
    window_seconds: float


class InMemoryRateLimiter:
    def __init__(self) -> None:
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def allow(self, key: str, rule: RateLimitRule) -> tuple[bool, int | None]:
        now = time.monotonic()
        cutoff = now - rule.window_seconds
        with self._lock:
            bucket = self._events[key]
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()
            if len(bucket) >= rule.max_requests:
                retry_after = max(1, int(bucket[0] + rule.window_seconds - now) + 1)
                return False, retry_after
            bucket.append(now)
            return True, None

    def reset(self) -> None:
        with self._lock:
            self._events.clear()


limiter = InMemoryRateLimiter()


def rate_limit_enabled() -> bool:
    return config.RATE_LIMIT_ENABLED


def client_ip(request: Request) -> str:
    if config.TRUST_PROXY:
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "unknown"


def rate_limit_rule_for_request(path: str, method: str) -> RateLimitRule | None:
    if not path.startswith("/api/") or path == "/api/health":
        return None

    if method == "POST" and (path.endswith("/ask") or path.endswith("/dispute")):
        return RateLimitRule("llm", config.RATE_LIMIT_LLM_MAX, config.RATE_LIMIT_LLM_WINDOW)

    if method == "POST" and (
        path in ("/api/rulebooks", "/api/rulebooks/upload-stream")
        or path.endswith("/reindex-stream")
        or path.endswith("/bgg/lookup")
        or path.endswith("/bgg/import-stream")
    ):
        return RateLimitRule(
            "expensive",
            config.RATE_LIMIT_EXPENSIVE_MAX,
            config.RATE_LIMIT_EXPENSIVE_WINDOW,
        )

    if method == "GET" and _PREVIEW_PATH.match(path):
        return RateLimitRule(
            "preview",
            config.RATE_LIMIT_PREVIEW_MAX,
            config.RATE_LIMIT_PREVIEW_WINDOW,
        )

    return RateLimitRule(
        "default",
        config.RATE_LIMIT_DEFAULT_MAX,
        config.RATE_LIMIT_DEFAULT_WINDOW,
    )


def check_rate_limit(request: Request) -> tuple[bool, int | None]:
    rule = rate_limit_rule_for_request(request.url.path, request.method)
    if rule is None:
        return True, None
    client = client_ip(request)
    return limiter.allow(f"{client}:{rule.name}", rule)
