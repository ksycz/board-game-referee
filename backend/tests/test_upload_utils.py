"""Tests for upload helpers."""

import pytest

from services.upload_utils import ensure_pdf_size, safe_stored_filename


def test_safe_stored_filename_strips_path_components():
    assert safe_stored_filename("../../etc/passwd") == "passwd"
    assert safe_stored_filename("My Rules.pdf") == "My_Rules.pdf"


def test_ensure_pdf_size_rejects_large_files():
    with pytest.raises(ValueError, match="too large"):
        ensure_pdf_size(b"x" * 1024, max_bytes=512)
