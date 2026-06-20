"""Tests for PDF text chunking."""

from pathlib import Path

import fitz

from services.pdf_parser import (
    _page_needs_ocr,
    chunk_page_text,
    ensure_tesseract_path,
    extract_chunks,
)


def _make_pdf(pages: list[tuple[str, str]], path):
    doc = fitz.open()
    for title, body in pages:
        page = doc.new_page()
        page.insert_text((72, 72), title, fontsize=18)
        page.insert_text((72, 110), body, fontsize=12)
    doc.save(path)
    doc.close()


def test_short_page_stays_single_chunk(tmp_path):
    pdf = tmp_path / "short.pdf"
    _make_pdf([("Setup", "Each player draws 5 cards.")], pdf)

    chunks, page_count, ocr_pages = extract_chunks(pdf)

    assert page_count == 1
    assert ocr_pages == 0
    assert len(chunks) == 1
    assert chunks[0].page == 1
    assert chunks[0].section_hint == "Setup"
    assert "draws 5 cards" in chunks[0].text


def test_long_page_splits_into_multiple_chunks():
    long_body = " ".join(
        [
            "When resolving combat, compare attack and defense values.",
            "Apply modifiers in the order printed on the card.",
            "If the attacker wins, deal damage equal to the difference.",
            "If the defender wins, the attack has no effect.",
            "On a tie, both players draw one card.",
            "Special abilities may trigger before damage is dealt.",
            "Interrupt cards can be played until damage is assigned.",
            "Some effects last until the end of the round.",
        ]
        * 3
    )
    chunks = chunk_page_text(1, f"Combat\n\n{long_body}", max_chars=600, min_chars=100)

    assert len(chunks) > 1
    assert all(chunk.page == 1 for chunk in chunks)
    assert all(chunk.section_hint == "Combat" for chunk in chunks)
    assert all(len(chunk.text) <= 600 for chunk in chunks)


def test_multiple_sections_on_one_page_become_separate_chunks():
    page_text = """Setup

Each player draws 5 cards. Place the board in the center.

Turn Order

On your turn you may take one action. You may not attack on the first turn.
"""
    chunks = chunk_page_text(3, page_text, max_chars=600, min_chars=80)

    assert len(chunks) == 2
    assert chunks[0].section_hint == "Setup"
    assert "draws 5 cards" in chunks[0].text
    assert chunks[1].section_hint == "Turn Order"
    assert "first turn" in chunks[1].text


def test_single_letter_lines_are_not_section_headings():
    page_text = """C

Players take turns in clockwise order.
"""
    chunks = chunk_page_text(1, page_text, max_chars=600, min_chars=80)

    assert len(chunks) == 1
    assert chunks[0].section_hint is None
    assert "clockwise order" in chunks[0].text


def test_page_number_only_text_is_not_indexed():
    page_text = """Choose Actions

2
"""
    chunks = chunk_page_text(1, page_text, max_chars=600, min_chars=80)

    assert chunks == []


def test_section_body_kept_when_page_number_noise_present():
    page_text = """Choose Actions

2

On your turn, choose one action from the list shown on your player board.
"""
    chunks = chunk_page_text(1, page_text, max_chars=600, min_chars=80)

    assert len(chunks) == 1
    assert chunks[0].section_hint == "Choose Actions"
    assert "choose one action" in chunks[0].text
    assert chunks[0].text.strip() != "2"


def test_multi_page_pdf_reports_page_count(tmp_path):
    pdf = tmp_path / "multi.pdf"
    _make_pdf(
        [
            ("Setup", "Each player draws 5 cards."),
            ("Combat", "To attack, discard one card and roll the die."),
        ],
        pdf,
    )

    chunks, page_count, ocr_pages = extract_chunks(pdf)

    assert page_count == 2
    assert ocr_pages == 0
    assert len(chunks) == 2
    assert {chunk.page for chunk in chunks} == {1, 2}


def test_page_needs_ocr_when_only_heading_and_page_number():
    page_text = """Choose Actions

2
"""
    chunks = chunk_page_text(1, page_text, max_chars=600, min_chars=80)

    assert chunks == []
    assert _page_needs_ocr(page_text, chunks) is True


def test_page_needs_ocr_false_when_body_present():
    page_text = """Choose Actions

On your turn, choose one action from the list shown on your player board.
"""
    chunks = chunk_page_text(1, page_text, max_chars=600, min_chars=80)

    assert len(chunks) == 1
    assert _page_needs_ocr(page_text, chunks) is False


def test_page_needs_ocr_when_only_short_component_list():
    page_text = """Components

5 cards, 2 dice, 1 board
"""
    chunks = chunk_page_text(1, page_text, max_chars=600, min_chars=80)

    assert len(chunks) == 1
    assert _page_needs_ocr(page_text, chunks) is True


def test_ensure_tesseract_path_finds_homebrew(monkeypatch):
    monkeypatch.setenv("PATH", "/usr/bin:/bin")
    assert ensure_tesseract_path() == (Path("/opt/homebrew/bin/tesseract").is_file())


def test_ocr_fallback_upgrades_sparse_page(monkeypatch, tmp_path):
    from services import pdf_parser

    pdf = tmp_path / "sparse.pdf"
    _make_pdf([("Choose Actions", "2")], pdf)

    monkeypatch.setattr(pdf_parser, "OCR_FALLBACK", True)

    def fake_ocr(_page):
        return (
            "Choose Actions\n\n"
            "On your turn, choose one action from the list shown on your player board."
        )

    monkeypatch.setattr(pdf_parser, "_extract_page_text_ocr", fake_ocr)

    chunks, page_count, ocr_pages = extract_chunks(pdf)

    assert page_count == 1
    assert ocr_pages == 1
    assert len(chunks) == 1
    assert "choose one action" in chunks[0].text.lower()


def test_ocr_fallback_disabled_skips_ocr(monkeypatch, tmp_path):
    from services import pdf_parser

    pdf = tmp_path / "sparse.pdf"
    _make_pdf([("Choose Actions", "2")], pdf)

    monkeypatch.setattr(pdf_parser, "OCR_FALLBACK", False)

    def fail_ocr(_page):
        raise AssertionError("OCR should not run when OCR_FALLBACK is disabled")

    monkeypatch.setattr(pdf_parser, "_extract_page_text_ocr", fail_ocr)

    chunks, page_count, ocr_pages = extract_chunks(pdf)

    assert page_count == 0
    assert ocr_pages == 0
    assert chunks == []


def test_extract_chunks_reports_progress(tmp_path):
    pdf = tmp_path / "multi.pdf"
    _make_pdf(
        [
            ("Setup", "Each player draws 5 cards."),
            ("Combat", "To attack, discard one card and roll the die."),
        ],
        pdf,
    )

    events: list[dict] = []
    extract_chunks(pdf, on_progress=events.append)

    phases = [event["phase"] for event in events]
    assert phases[0] == "starting"
    assert "reading" in phases
    assert events[0]["total_pages"] == 2
    assert any(event["page"] == 1 for event in events if event["phase"] == "reading")
    assert any(event["page"] == 2 for event in events if event["phase"] == "reading")
