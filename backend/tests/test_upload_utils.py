"""Tests for upload helpers."""

import asyncio
import io

import pytest
from starlette.datastructures import UploadFile

from services.upload_utils import (
    ensure_pdf_magic,
    ensure_pdf_size,
    ensure_pdf_structure,
    read_bounded_http_body,
    read_bounded_pdf_upload,
    safe_stored_filename,
)


class _FakeHttpBody:
    def __init__(self, data: bytes, *, chunk_size: int = 256) -> None:
        self._data = data
        self._chunk_size = chunk_size
        self._pos = 0

    def read(self, size: int = -1) -> bytes:
        if self._pos >= len(self._data):
            return b""
        if size < 0:
            size = self._chunk_size
        chunk = self._data[self._pos : self._pos + size]
        self._pos += len(chunk)
        return chunk


def test_safe_stored_filename_strips_path_components():
    assert safe_stored_filename("../../etc/passwd") == "passwd"
    assert safe_stored_filename("My Rules.pdf") == "My_Rules.pdf"


def test_ensure_pdf_size_rejects_large_files():
    with pytest.raises(ValueError, match="too large"):
        ensure_pdf_size(b"x" * 1024, max_bytes=512)


def test_ensure_pdf_magic_rejects_non_pdf():
    with pytest.raises(ValueError, match="not a valid PDF"):
        ensure_pdf_magic(b"not-a-pdf")


def test_ensure_pdf_structure_rejects_html_polyglot():
    with pytest.raises(ValueError, match="not a valid PDF"):
        ensure_pdf_structure(b"%PDF-1.4\n<html><body>fake</body></html>")


def test_ensure_pdf_structure_rejects_missing_eof():
    with pytest.raises(ValueError, match="not a valid PDF"):
        ensure_pdf_structure(b"%PDF-1.4\n" + b"x" * 128)


def test_ensure_pdf_structure_accepts_minimal_pdf():
    minimal = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"
    padded = minimal + b"\n" + b" " * max(0, 64 - len(minimal) - 1)
    ensure_pdf_structure(padded)


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


def test_read_bounded_http_body_rejects_oversized_stream():
    body = _FakeHttpBody(b"%PDF-" + b"x" * 2048)
    with pytest.raises(ValueError, match="too large"):
        read_bounded_http_body(body, max_bytes=1024)

