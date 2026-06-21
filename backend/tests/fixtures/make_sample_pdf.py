"""Generate a tiny sample rulebook PDF for local testing."""

from pathlib import Path

import fitz

PAGES = [
    (
        "Setup",
        "Each player draws 5 cards. Place the board in the center. The youngest player goes first.",
    ),
    (
        "Turn Order",
        "On your turn you may take exactly one action: draw a card, play a card, or pass. "
        "You may not attack on the first turn of the game.",
    ),
    (
        "Combat",
        "To attack, discard one card and roll the die. "
        "A result of 4 or higher wins the fight. "
        "Ties go to the defender.",
    ),
    (
        "Special Cards",
        "Interrupt cards may be played during another player's turn "
        "only when that player declares an attack. "
        "They cannot be used during the draw phase.",
    ),
]


def main() -> Path:
    out = Path(__file__).parent / "sample-rulebook.pdf"
    doc = fitz.open()
    for title, body in PAGES:
        page = doc.new_page()
        page.insert_text((72, 72), title, fontsize=18)
        page.insert_text((72, 110), body, fontsize=12)
    doc.save(out)
    doc.close()
    print(f"Wrote {out} ({len(PAGES)} pages)")
    return out


if __name__ == "__main__":
    main()
