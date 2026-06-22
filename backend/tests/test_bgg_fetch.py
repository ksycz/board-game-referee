"""Tests for BoardGameGeek rulebook lookup."""

from services.bgg_fetch import (
    BggDownloadError,
    BggError,
    download_rulebook_pdf,
    lookup_rulebooks,
    parse_bgg_url,
    rank_rulebook_files,
)


def test_parse_bgg_url_accepts_slug():
    ref = parse_bgg_url("https://boardgamegeek.com/boardgame/13/catan")
    assert ref.thing_id == "13"
    assert ref.slug == "catan"
    assert ref.game_name == "Catan"


def test_parse_bgg_url_rejects_non_bgg_link():
    try:
        parse_bgg_url("https://example.com/game/13")
        raised = False
    except BggError:
        raised = True
    assert raised


def test_rank_rulebook_files_prefers_official_rulebook():
    files = [
        {
            "fileid": "1",
            "filepageid": "10",
            "title": "Player aid",
            "filename": "aid.pdf",
            "size": "50000",
            "numpositive": "20",
            "language": "English",
            "href": "/filepage/10/player-aid",
        },
        {
            "fileid": "2",
            "filepageid": "11",
            "title": "Official rulebook",
            "filename": "catan-rules.pdf",
            "size": "2500000",
            "numpositive": "12",
            "language": "English",
            "href": "/filepage/11/official-rulebook",
        },
    ]

    ranked = rank_rulebook_files(files)
    assert len(ranked) == 1
    assert ranked[0].file_id == "2"
    assert ranked[0].title == "Official rulebook"


def test_download_rulebook_pdf_rejects_html_login_page(monkeypatch):
    class FakeResponse:
        headers = {"Content-Type": "text/html; charset=UTF-8"}

        def read(self):
            return b"<!DOCTYPE html><html><title>Just a moment</title>"

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    monkeypatch.setattr("urllib.request.urlopen", lambda *args, **kwargs: FakeResponse())

    try:
        download_rulebook_pdf(
            "451831",
            bgg_url="https://boardgamegeek.com/filepage/322784/catan-solo",
        )
        raised = False
    except BggDownloadError as exc:
        raised = True
        assert "blocks server-side" in str(exc)
        assert exc.bgg_url == "https://boardgamegeek.com/filepage/322784/catan-solo"
    assert raised


def test_lookup_rulebooks_uses_files_api(monkeypatch):
    def fake_fetch_files(thing_id: str, *, language_id: int | None):
        assert thing_id == "13"
        return [
            {
                "fileid": "99",
                "filepageid": "12",
                "title": "Official rulebook",
                "filename": "catan-rules.pdf",
                "size": "1500000",
                "numpositive": "8",
                "language": "English",
                "href": "/filepage/12/official-rulebook",
            },
        ]

    monkeypatch.setattr("services.bgg_fetch._fetch_files", fake_fetch_files)
    result = lookup_rulebooks("https://boardgamegeek.com/boardgame/13/catan")
    assert result["thing_id"] == "13"
    assert result["game_name"] == "Catan"
    assert len(result["files"]) == 1
    assert result["files"][0]["file_id"] == "99"
