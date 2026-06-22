"""Tests for rulebook path safety."""

from config import RULEBOOKS_DIR
from services.rulebook_store import resolve_rulebook_pdf_path


def test_resolve_rulebook_pdf_path_stays_in_library():
    path = resolve_rulebook_pdf_path("../../evil.pdf")
    assert path.name == "evil.pdf"
    assert path.parent.resolve() == RULEBOOKS_DIR.resolve()
