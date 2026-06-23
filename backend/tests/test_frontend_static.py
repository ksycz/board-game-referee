"""Tests for frontend static asset resolution."""

import pytest

from services.frontend_static import resolve_frontend_asset


def test_resolve_frontend_asset_serves_index_for_spa_route(tmp_path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<html></html>", encoding="utf-8")

    assert resolve_frontend_asset(dist, "library") == dist / "index.html"


def test_resolve_frontend_asset_serves_existing_file(tmp_path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<html></html>", encoding="utf-8")
    (dist / "robots.txt").write_text("User-agent: *", encoding="utf-8")

    assert resolve_frontend_asset(dist, "robots.txt") == dist / "robots.txt"


def test_resolve_frontend_asset_rejects_path_traversal(tmp_path):
    dist = tmp_path / "dist"
    dist.mkdir()
    secret = tmp_path / "secret.txt"
    secret.write_text("nope", encoding="utf-8")

    with pytest.raises(ValueError, match="escapes"):
        resolve_frontend_asset(dist, "../secret.txt")
