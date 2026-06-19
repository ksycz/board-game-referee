"""Tests for PDF text chunking."""

import fitz

from services.pdf_parser import chunk_page_text, extract_chunks


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

    chunks, page_count = extract_chunks(pdf)

    assert page_count == 1
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


def test_multi_page_pdf_reports_page_count(tmp_path):
    pdf = tmp_path / "multi.pdf"
    _make_pdf(
        [
            ("Setup", "Each player draws 5 cards."),
            ("Combat", "To attack, discard one card and roll the die."),
        ],
        pdf,
    )

    chunks, page_count = extract_chunks(pdf)

    assert page_count == 2
    assert len(chunks) == 2
    assert {chunk.page for chunk in chunks} == {1, 2}
