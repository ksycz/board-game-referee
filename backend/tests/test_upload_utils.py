"""Tests for upload helpers."""

import asyncio
import io

import pytest
from starlette.datastructures import UploadFile

from services.upload_utils import (
    ensure_pdf_magic,
    ensure_pdf_size,
    read_bounded_pdf_upload,
    safe_stored_filename,
)


def test_safe_stored_filename_strips_path_components():
    assert safe_stored_filename("../../etc/passwd") == "passwd"
    assert safe_stored_filename("My Rules.pdf") == "My_Rules.pdf"


def test_ensure_pdf_size_rejects_large_files():
    with pytest.raises(ValueError, match="too large"):
        ensure_pdf_size(b"x" * 1024, max_bytes=512)


def test_ensure_pdf_magic_rejects_non_pdf():
    with pytest.raises(ValueError, match="not a valid PDF"):
        ensure_pdf_magic(b"not-a-pdf")


def test_read_bounded_pdf_upload_rejects_non_pdf():
    upload = UploadFile(
        filename="rules.pdf",
        file=io.BytesIO(b"not-a-pdf"),
    )
    with pytest.raises(ValueError, match="not a valid PDF"):
        asyncio.run(read_bounded_pdf_upload(upload, max_bytes=1024))


def test_read_bounded_pdf_upload_rejects_oversized_stream():
    upload = UploadFile(
        filename="rules.pdf",
        file=io.BytesIO(b"%PDF-" + b"x" * 2048),
    )
    with pytest.raises(ValueError, match="too large"):
        asyncio.run(read_bounded_pdf_upload(upload, max_bytes=1024))

