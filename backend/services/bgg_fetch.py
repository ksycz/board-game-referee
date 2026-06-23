"""Fetch rulebook candidates from BoardGameGeek game URLs."""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Any

from config import BGG_API_TOKEN
from services.upload_utils import ensure_pdf_magic, ensure_pdf_size, read_bounded_http_body

BGG_BASE = "https://boardgamegeek.com"
BGG_FILES_API = f"{BGG_BASE}/api/files"
BGG_XML_API = f"{BGG_BASE}/xmlapi2/thing"
USER_AGENT = "BoardGameReferee/1.0 (+https://github.com/ksycz/board-game-referee)"

BGG_URL_RE = re.compile(
    r"(?:https?://)?(?:www\.)?boardgamegeek\.com/"
    r"(?:boardgame|boardgameexpansion|boardgameaccessory|rpgitem|rpgissue|videogame)"
    r"/(\d+)(?:/([^/?#]+))?",
    re.IGNORECASE,
)

RULEBOOK_POSITIVE = (
    "rulebook",
    "rule book",
    "rules",
    "reglamento",
    "regeln",
    "manual",
    "rule booklet",
)

RULEBOOK_NEGATIVE = (
    "summary",
    "player aid",
    "quick reference",
    "reference",
    "variant",
    "solo",
    "vassal",
    "sticker",
    "mod ",
    "house rule",
    "fan ",
    "unofficial",
    "pocket ref",
    "cheat sheet",
    "aid ",
    "translated promotional",
    "manga",
)


class BggError(ValueError):
    """User-facing BGG fetch error."""


class BggDownloadError(BggError):
    def __init__(self, message: str, *, bgg_url: str) -> None:
        super().__init__(message)
        self.bgg_url = bgg_url


@dataclass(frozen=True)
class BggReference:
    thing_id: str
    slug: str | None
    game_name: str


@dataclass(frozen=True)
class BggRulebookFile:
    file_id: str
    filepage_id: str
    title: str
    filename: str
    size: int
    language: str | None
    votes: int
    score: float
    bgg_url: str
    download_url: str


def parse_bgg_url(url: str) -> BggReference:
    trimmed = url.strip()
    if not trimmed:
        raise BggError("Paste a BoardGameGeek game link.")

    match = BGG_URL_RE.search(trimmed)
    if not match:
        raise BggError(
            "That does not look like a BoardGameGeek game link. "
            "Example: https://boardgamegeek.com/boardgame/13/catan",
        )

    thing_id, slug = match.group(1), match.group(2)
    game_name = _title_from_slug(slug) if slug else f"BGG game {thing_id}"
    return BggReference(thing_id=thing_id, slug=slug, game_name=game_name)


def lookup_rulebooks(url: str, *, language_id: int | None = 2184) -> dict[str, Any]:
    reference = parse_bgg_url(url)
    raw_files = _fetch_files(reference.thing_id, language_id=language_id)
    game_name = _resolve_game_name(reference, raw_files)
    candidates = rank_rulebook_files(raw_files)
    return {
        "thing_id": reference.thing_id,
        "game_name": game_name,
        "files": [file.__dict__ for file in candidates],
    }


def rank_rulebook_files(files: list[dict[str, Any]]) -> list[BggRulebookFile]:
    ranked: list[BggRulebookFile] = []
    for entry in files:
        filename = str(entry.get("filename", ""))
        if not filename.lower().endswith(".pdf"):
            continue

        title = str(entry.get("title") or filename)
        label = f"{title} {filename}".lower()
        if any(term in label for term in RULEBOOK_NEGATIVE):
            continue

        score = 0.0
        if any(term in label for term in RULEBOOK_POSITIVE):
            score += 6.0
        if "official" in label:
            score += 4.0
        if "english" in str(entry.get("language", "")).lower():
            score += 2.0

        votes = int(entry.get("numpositive") or 0)
        score += min(votes, 20) * 0.35

        size = int(entry.get("size") or 0)
        if 100_000 <= size <= 30_000_000:
            score += 1.5
        elif size < 40_000:
            score -= 2.0

        file_id = str(entry.get("fileid") or "")
        filepage_id = str(entry.get("filepageid") or "")
        if not file_id or not filepage_id:
            continue

        ranked.append(
            BggRulebookFile(
                file_id=file_id,
                filepage_id=filepage_id,
                title=title,
                filename=filename,
                size=size,
                language=entry.get("language"),
                votes=votes,
                score=score,
                bgg_url=f"{BGG_BASE}{entry.get('href', f'/filepage/{filepage_id}')}",
                download_url=f"{BGG_BASE}/file/download/{file_id}",
            ),
        )

    ranked.sort(key=lambda item: (-item.score, -item.votes, -item.size))
    return ranked[:12]


def download_rulebook_pdf(
    file_id: str,
    *,
    filename_hint: str | None = None,
    bgg_url: str | None = None,
) -> tuple[bytes, str]:
    if not file_id.isdigit():
        raise BggError("Invalid BGG file id.")

    download_url = f"{BGG_BASE}/file/download/{file_id}"
    help_url = bgg_url or download_url
    headers: dict[str, str] = {
        "User-Agent": USER_AGENT,
        "Accept": "application/pdf,*/*",
        "Referer": BGG_BASE,
    }
    if BGG_API_TOKEN:
        headers["Authorization"] = f"Bearer {BGG_API_TOKEN}"

    try:
        request = urllib.request.Request(download_url, headers=headers)
        with urllib.request.urlopen(request, timeout=90) as response:
            content_type = response.headers.get("Content-Type", "")
            data = read_bounded_http_body(response)
    except urllib.error.HTTPError as exc:
        raise BggDownloadError(
            "BoardGameGeek blocked automatic download. "
            "Open the file in your browser, download the PDF, then upload it here.",
            bgg_url=help_url,
        ) from exc
    except urllib.error.URLError as exc:
        raise BggError(f"Could not reach BoardGameGeek: {exc.reason}") from exc

    try:
        ensure_pdf_magic(data)
    except ValueError as exc:
        raise BggDownloadError(
            "BoardGameGeek blocks server-side PDF downloads. "
            "Open the file in your browser, download the PDF, then upload it here.",
            bgg_url=help_url,
        ) from exc

    try:
        ensure_pdf_size(data)
    except ValueError as exc:
        raise BggError(str(exc)) from exc

    if "pdf" not in content_type.lower() and filename_hint and not filename_hint.lower().endswith(".pdf"):
        raise BggDownloadError(
            "The downloaded file does not look like a PDF. "
            "Try another file from the list or upload the PDF manually.",
            bgg_url=help_url,
        )

    filename = filename_hint or f"bgg-{file_id}.pdf"
    return data, filename


def _fetch_files(thing_id: str, *, language_id: int | None) -> list[dict[str, Any]]:
    query = f"?objectid={thing_id}&objecttype=thing"
    if language_id is not None:
        query += f"&languageid={language_id}"

    payload = _get_json(f"{BGG_FILES_API}{query}")
    files = payload.get("files")
    if not isinstance(files, list):
        raise BggError("BoardGameGeek returned an unexpected response for game files.")

    if files:
        return files

    if language_id is not None:
        return _fetch_files(thing_id, language_id=None)

    return []


def _resolve_game_name(reference: BggReference, files: list[dict[str, Any]]) -> str:
    if BGG_API_TOKEN:
        try:
            name = _fetch_game_name_xml(reference.thing_id)
            if name:
                return name
        except (BggError, urllib.error.URLError, ET.ParseError):
            pass

    if reference.slug:
        return _title_from_slug(reference.slug)

    return reference.game_name


def _fetch_game_name_xml(thing_id: str) -> str | None:
    payload = _get_text(
        f"{BGG_XML_API}?id={thing_id}",
        headers={"Authorization": f"Bearer {BGG_API_TOKEN}"},
    )
    root = ET.fromstring(payload)
    item = root.find("item")
    if item is None:
        return None
    primary = item.find("name[@type='primary']")
    if primary is not None and primary.get("value"):
        return primary.get("value")
    fallback = item.find("name")
    return fallback.get("value") if fallback is not None else None


def _get_json(url: str, *, headers: dict[str, str] | None = None) -> dict[str, Any]:
    raw = _get_text(url, headers=headers)
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise BggError("BoardGameGeek returned an unexpected response.")
    return payload


def _get_text(url: str, *, headers: dict[str, str] | None = None) -> str:
    merged = {"User-Agent": USER_AGENT, "Accept": "application/json, text/xml, */*"}
    if headers:
        merged.update(headers)
    request = urllib.request.Request(url, headers=merged)
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            return response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        if exc.code == 401:
            raise BggError(
                "BGG API token was rejected. Check BGG_API_TOKEN in your environment.",
            ) from exc
        raise BggError(f"BoardGameGeek request failed (HTTP {exc.code}): {body[:160]}") from exc
    except urllib.error.URLError as exc:
        raise BggError(f"Could not reach BoardGameGeek: {exc.reason}") from exc


def _title_from_slug(slug: str) -> str:
    cleaned = slug.replace("-", " ").replace("_", " ").strip()
    if not cleaned:
        return cleaned
    return " ".join(word.capitalize() for word in cleaned.split())
