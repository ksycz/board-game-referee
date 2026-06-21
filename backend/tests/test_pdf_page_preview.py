"""Tests for PDF page preview rendering."""

import fitz

from services.pdf_page_preview import render_page_png


def test_render_page_png_returns_valid_png(sample_pdf):
    png = render_page_png(sample_pdf, 1)

    assert png.startswith(b"\x89PNG\r\n\x1a\n")
    assert len(png) > 100


def test_render_page_png_rejects_out_of_range_page(sample_pdf):
    doc = fitz.open(sample_pdf)
    page_count = len(doc)
    doc.close()

    try:
        render_page_png(sample_pdf, page_count + 1)
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "out of range" in str(exc)
