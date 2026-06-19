"""Shared pytest fixtures."""

from pathlib import Path

import fitz
import pytest


@pytest.fixture
def sample_pdf(tmp_path: Path) -> Path:
    pdf = tmp_path / "sample-rulebook.pdf"
    pages = [
        ("Setup", "Each player draws 5 cards. The youngest player goes first."),
        (
            "Turn Order",
            "On your turn you may take one action. You may not attack on the first turn.",
        ),
        (
            "Combat",
            "To attack, discard one card and roll the die. A result of 4 or higher wins.",
        ),
        (
            "Special Cards",
            "Interrupt cards may be played during another player's turn only when that player declares an attack.",
        ),
    ]
    doc = fitz.open()
    for title, body in pages:
        page = doc.new_page()
        page.insert_text((72, 72), title, fontsize=18)
        page.insert_text((72, 110), body, fontsize=12)
    doc.save(pdf)
    doc.close()
    return pdf


@pytest.fixture
def isolated_data(tmp_path: Path, monkeypatch):
    data = tmp_path / "data"
    rulebooks_dir = data / "rulebooks"
    chroma_dir = data / "chroma"
    monkeypatch.setattr("config.DATA_DIR", data)
    monkeypatch.setattr("config.RULEBOOKS_DIR", rulebooks_dir)
    monkeypatch.setattr("config.CHROMA_DIR", chroma_dir)
    monkeypatch.setattr("services.vector_store.CHROMA_DIR", chroma_dir)
    monkeypatch.setattr("services.rulebook_store.RULEBOOKS_DIR", rulebooks_dir)
    return data
