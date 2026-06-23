"""Safe static file resolution for the bundled SPA."""

from __future__ import annotations

from pathlib import Path


def resolve_frontend_asset(base_dir: Path, relative_path: str) -> Path:
    """Return a file under base_dir, or index.html for SPA routes.

    Raises ValueError if relative_path escapes base_dir after resolution.
    """
    root = base_dir.resolve()
    if not relative_path or relative_path == ".":
        return root / "index.html"

    candidate = (root / relative_path).resolve()
    if candidate != root and root not in candidate.parents:
        raise ValueError("Path escapes frontend root")

    if candidate.is_file():
        return candidate
    return root / "index.html"
