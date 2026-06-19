"""Tests for example question suggestions."""

from services.example_questions import suggest_questions
from services.vector_store import StoredChunk


def test_suggest_questions_from_sections_and_text():
    chunks = [
        StoredChunk(chunk_id="1", page=1, text="Each player draws 5 cards.", section_hint="Setup"),
        StoredChunk(
            chunk_id="2",
            page=2,
            text="On your turn you may take one action.",
            section_hint="Turn Order",
        ),
        StoredChunk(
            chunk_id="3",
            page=3,
            text="Interrupt cards may be played during another player's turn.",
            section_hint="Special Cards",
        ),
    ]

    questions = suggest_questions(chunks, limit=3)

    assert questions == [
        "How do I set up the game?",
        "How many cards do I draw?",
        "What can I do on my turn?",
    ]


def test_suggest_questions_from_text_keywords():
    chunks = [
        StoredChunk(
            chunk_id="1",
            page=1,
            text="Interrupt cards may be played during another player's turn.",
            section_hint=None,
        ),
    ]

    questions = suggest_questions(chunks, limit=1)

    assert questions == ["Can I act during another player's turn?"]


def test_suggest_questions_ignores_component_inventory_sections():
    chunks = [
        StoredChunk(
            chunk_id="1",
            page=2,
            text="(Influence cards)",
            section_hint="12 ORIGAMI CARDS (CORAL)",
        ),
        StoredChunk(
            chunk_id="2",
            page=4,
            text="Place the main board so it can be reached by both players.",
            section_hint="BOARD SETUP:",
        ),
    ]

    questions = suggest_questions(chunks, limit=2)

    assert questions == ["How do I set up the game?", "Can I play this card during another player's turn?"]


def test_suggest_questions_ignores_noise_section_hints():
    chunks = [
        StoredChunk(chunk_id="1", page=1, text="Players take turns in clockwise order.", section_hint="C"),
        StoredChunk(chunk_id="2", page=2, text="The game ends when someone scores 10 points.", section_hint="IV"),
    ]

    questions = suggest_questions(chunks, limit=3)

    assert questions == [
        "Can I play this card during another player's turn?",
        "What can I do on my turn?",
        "How do I win the game?",
    ]


def test_suggest_questions_falls_back_to_defaults():
    chunks = [
        StoredChunk(chunk_id="1", page=1, text="Lorem ipsum dolor sit amet.", section_hint=None),
    ]

    questions = suggest_questions(chunks, limit=3)

    assert len(questions) == 3
    assert questions == [
        "Can I play this card during another player's turn?",
        "What can I do on my turn?",
        "How do I win the game?",
    ]
