"""Tests for game display name derivation."""

import fitz

from services.game_name import (
    derive_game_name,
    extract_game_name_from_pdf,
    is_plausible_game_title,
    looks_like_filename,
    prettify_filename_stem,
)


def _make_pdf(text: str, path, *, title: str = ""):
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), text, fontsize=12)
    if title:
        doc.set_metadata({"title": title})
    doc.save(path)
    doc.close()


def test_prettify_filename_stem():
    assert prettify_filename_stem("W_Castle_Duel_ENG_v5") == "Castle Duel"
    assert prettify_filename_stem("trio_EN") == "Trio"
    assert prettify_filename_stem("ARFG007-Tedoku-Rulebook-EN-web") == "Tedoku"


def test_is_plausible_game_title_rejects_generic_phrases():
    assert not is_plausible_game_title("The game")
    assert not is_plausible_game_title("game")
    assert is_plausible_game_title("The White Castle Duel")
    assert is_plausible_game_title("Tedoku")


def test_looks_like_filename():
    assert looks_like_filename("W_Castle_Duel_ENG_v5")
    assert not looks_like_filename("The White Castle Duel")
    assert not looks_like_filename("Test Game")


def test_extract_game_name_from_intro_text(tmp_path):
    pdf = tmp_path / "castle.pdf"
    _make_pdf(
        "In The White Castle Duel, two clans compete to exercise their influence over the Court.",
        pdf,
    )

    assert extract_game_name_from_pdf(pdf) == "The White Castle Duel"


def test_extract_game_name_from_metadata(tmp_path):
    pdf = tmp_path / "meta.pdf"
    _make_pdf("Setup rules go here.", pdf, title="Wingspan")

    assert extract_game_name_from_pdf(pdf) == "Wingspan"


def test_derive_game_name_prefers_user_input(tmp_path):
    pdf = tmp_path / "game.pdf"
    _make_pdf("In The White Castle Duel, two clans compete.", pdf)

    assert derive_game_name(pdf, "W_Castle_Duel_ENG_v5.pdf", "My Custom Name") == "My Custom Name"


def test_derive_game_name_uses_pdf_title_before_filename(tmp_path):
    pdf = tmp_path / "game.pdf"
    _make_pdf("In The White Castle Duel, two clans compete.", pdf)

    assert derive_game_name(pdf, "W_Castle_Duel_ENG_v5.pdf", None) == "The White Castle Duel"


def test_derive_game_name_falls_back_to_prettified_filename(tmp_path):
    pdf = tmp_path / "game.pdf"
    _make_pdf("Each player draws 5 cards.", pdf)

    assert derive_game_name(pdf, "trio_EN.pdf", None) == "Trio"


def test_derive_game_name_ignores_in_the_game_prose(tmp_path):
    pdf = tmp_path / "tedoku.pdf"
    _make_pdf(
        "Tedoku is a game for any number of players. "
        "In the game, you are trying to fit special shapes into your grid.",
        pdf,
    )

    assert derive_game_name(pdf, "ARFG007-Tedoku-Rulebook-EN-web.pdf", None) == "Tedoku"


def test_extract_game_name_from_is_a_game_intro(tmp_path):
    pdf = tmp_path / "tedoku.pdf"
    _make_pdf("Tedoku is a game for any number of players.", pdf)

    assert extract_game_name_from_pdf(pdf) == "Tedoku"
