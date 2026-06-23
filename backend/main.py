from __future__ import annotations

import logging
import os
import uuid
from dataclasses import asdict
from pathlib import Path
from typing import Literal

from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from agents.pipeline import RefereePipeline
from config import (
    CORS_ORIGINS,
    DATA_DIR,
    DEMO_MODE,
    IS_PRODUCTION,
    MODEL,
    OCR_FALLBACK,
    ensure_dirs,
)
from errors import RateLimitError
from services.frontend_static import resolve_frontend_asset
from services.http_errors import GENERIC_BGG_LOOKUP_ERROR, server_error
from services.pdf_parser import ensure_tesseract_path
from services.bgg_fetch import BggError, lookup_rulebooks
from services.bgg_upload_stream import stream_bgg_rulebook_upload
from services.rulebook_store import DuplicateRulebookError
from services.reindex_stream import stream_rulebook_reindex
from services.upload_stream import stream_rulebook_upload
from services.upload_utils import read_bounded_pdf_upload, safe_stored_filename
from services.api_auth import (
    AUTH_EXEMPT_PATHS,
    api_key_required,
    auth_enabled,
    verify_api_key,
)
from services.demo_mode import (
    filter_visible_rulebooks,
    has_full_access,
    require_full_access,
    require_rulebook_access,
)
from services.demo_seed import seed_demo_rulebook_if_needed
from services.rate_limit import check_rate_limit, rate_limit_enabled

logger = logging.getLogger(__name__)

ensure_dirs()


def rate_limit_http_exception(exc: RateLimitError) -> HTTPException:
    return HTTPException(
        status_code=429,
        detail={"code": "rate_limit", "message": str(exc)},
    )


def _e2e_stub_enabled() -> bool:
    flag = os.getenv("E2E_STUB_LLM", "").strip().lower()
    if flag not in ("1", "true", "yes", "on"):
        return False
    env = os.getenv("ENVIRONMENT", "").strip().lower()
    if env in ("production", "prod"):
        logger.warning("E2E_STUB_LLM is set but ignored in production")
        return False
    return True


@asynccontextmanager
async def lifespan(_app: FastAPI):
    removed = pipeline.dedupe_rulebooks()
    if removed:
        logger.info("Removed %s duplicate rulebook(s) at startup", removed)
    demo_id = seed_demo_rulebook_if_needed(pipeline)
    if demo_id:
        logger.info("Demo rulebook ready: %s", demo_id)
    yield


app = FastAPI(
    title="Board Game Rules Referee",
    version="0.1.0",
    lifespan=lifespan,
)
pipeline = RefereePipeline()

if _e2e_stub_enabled():
    from e2e_stub import install_stub_referee

    install_stub_referee(pipeline)

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def enforce_api_security(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/"):
        if api_key_required(request) and path not in AUTH_EXEMPT_PATHS and not verify_api_key(request):
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid or missing API key."},
            )
        if rate_limit_enabled():
            allowed, retry_after = check_rate_limit(request)
            if not allowed:
                headers = {"Retry-After": str(retry_after)} if retry_after else {}
                return JSONResponse(
                    status_code=429,
                    content={
                        "detail": {
                            "code": "rate_limit",
                            "message": "Too many requests. Please wait and try again.",
                        },
                    },
                    headers=headers,
                )
    return await call_next(request)


class HistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=2000)


class AskRequest(BaseModel):
    question: str = Field(min_length=3, max_length=2000)
    history: list[HistoryMessage] = Field(default_factory=list, max_length=20)
    top_k: int | None = Field(default=None, ge=1, le=20)


class DisputeRequest(BaseModel):
    situation: str = Field(min_length=3, max_length=2000)
    player_a: str = Field(min_length=3, max_length=2000)
    player_b: str = Field(min_length=3, max_length=2000)
    history: list[HistoryMessage] = Field(default_factory=list, max_length=20)
    top_k: int | None = Field(default=None, ge=1, le=20)


class SearchRequest(BaseModel):
    query: str = Field(min_length=2, max_length=500)
    limit: int | None = Field(default=None, ge=1, le=20)


class PinRequest(BaseModel):
    pinned: bool


class RulingFeedbackRequest(BaseModel):
    response_id: str = Field(min_length=8, max_length=64)
    helpful: bool
    mode: Literal["ask", "dispute"] = "ask"
    cached: bool = False
    confidence: Literal["high", "medium", "low"] | None = None
    question: str | None = Field(default=None, max_length=2000)
    retrieved_pages: list[int] = Field(default_factory=list, max_length=50)


class BggLookupRequest(BaseModel):
    url: str = Field(min_length=8, max_length=500)


class BggImportRequest(BaseModel):
    file_id: str = Field(min_length=1, max_length=32, pattern=r"^\d+$")
    filename: str | None = Field(default=None, max_length=255)
    name: str | None = Field(default=None, max_length=120)
    bgg_url: str | None = Field(default=None, max_length=500)


def _safe_filename(name: str) -> str:
    return safe_stored_filename(name)


async def _read_upload_pdf(file: UploadFile) -> tuple[bytes, str]:
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF rulebooks are supported")

    try:
        content = await read_bounded_pdf_upload(file)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return content, file.filename


@app.get("/api/rulebooks")
def list_rulebooks(request: Request):
    books = filter_visible_rulebooks(request, pipeline.store.list())
    return [asdict(book) for book in books]


@app.post("/api/rulebooks/upload-stream")
async def upload_rulebook_stream(
    request: Request,
    file: UploadFile = File(...),
    name: str | None = Form(default=None),
):
    require_full_access(request)
    content, original_filename = await _read_upload_pdf(file)
    display_name = (name or "").strip() or None
    stored_name = f"{uuid.uuid4()}_{_safe_filename(original_filename)}"

    return StreamingResponse(
        stream_rulebook_upload(
            pipeline,
            display_name=display_name,
            stored_name=stored_name,
            pdf_bytes=content,
            original_filename=original_filename,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/rulebooks/bgg/lookup")
def bgg_lookup(request: Request, body: BggLookupRequest):
    require_full_access(request)
    try:
        return lookup_rulebooks(body.url)
    except BggError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("BGG lookup failed")
        raise HTTPException(status_code=400, detail=GENERIC_BGG_LOOKUP_ERROR) from exc


@app.post("/api/rulebooks/bgg/upload-stream")
async def bgg_upload_stream(request: Request, body: BggImportRequest):
    require_full_access(request)
    display_name = (body.name or "").strip() or None
    filename_hint = (body.filename or "").strip() or None
    bgg_url = (body.bgg_url or "").strip() or None
    return StreamingResponse(
        stream_bgg_rulebook_upload(
            pipeline,
            file_id=body.file_id.strip(),
            filename_hint=filename_hint,
            display_name=display_name,
            bgg_url=bgg_url,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/config")
def app_config(request: Request):
    return {
        "auth_required": auth_enabled() and not DEMO_MODE,
        "demo_mode": DEMO_MODE,
        "full_access": has_full_access(request),
    }


@app.get("/api/health")
def health():
    data_dir_writable = _data_dir_writable()
    payload: dict[str, object] = {
        "status": "ok" if data_dir_writable else "degraded",
        "auth_required": auth_enabled() and not DEMO_MODE,
        "demo_mode": DEMO_MODE,
    }
    if IS_PRODUCTION:
        return payload

    tesseract_installed = ensure_tesseract_path()
    ocr_fallback_enabled = OCR_FALLBACK
    payload.update(
        {
            "model": MODEL,
            "ocr_fallback_enabled": ocr_fallback_enabled,
            "tesseract_installed": tesseract_installed,
            "ocr_available": ocr_fallback_enabled and tesseract_installed,
            "data_dir_writable": data_dir_writable,
        }
    )
    return payload


def _data_dir_writable() -> bool:
    try:
        ensure_dirs()
        probe = DATA_DIR / ".health_write_probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
        return True
    except OSError:
        return False


@app.post("/api/rulebooks")
async def upload_rulebook(
    request: Request,
    file: UploadFile = File(...),
    name: str | None = Form(default=None),
):
    require_full_access(request)
    content, original_filename = await _read_upload_pdf(file)
    display_name = (name or "").strip() or None
    stored_name = f"{uuid.uuid4()}_{_safe_filename(original_filename)}"

    try:
        result = pipeline.upload_rulebook(
            display_name,
            stored_name,
            content,
            original_filename=original_filename,
        )
    except DuplicateRulebookError as exc:
        existing = exc.existing
        raise HTTPException(
            status_code=409,
            detail={
                "message": str(exc),
                "rulebook": asdict(existing),
                "example_questions": pipeline.example_questions(existing.id),
            },
        ) from exc
    except Exception as exc:
        raise server_error("rulebook upload", exc)

    return {
        "rulebook": asdict(result["rulebook"]),
        "ingestion": result["ingestion"],
        "example_questions": result["example_questions"],
    }


@app.get("/api/rulebooks/{rulebook_id}/examples")
def rulebook_examples(request: Request, rulebook_id: str):
    require_rulebook_access(request, pipeline.store, rulebook_id)
    try:
        return {"questions": pipeline.example_questions(rulebook_id)}
    except KeyError:
        raise HTTPException(status_code=404, detail="Rulebook not found")


@app.delete("/api/rulebooks/{rulebook_id}")
def delete_rulebook(request: Request, rulebook_id: str):
    require_full_access(request)
    try:
        deleted = pipeline.delete_rulebook(rulebook_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Rulebook not found")
    return {"deleted": rulebook_id}


@app.patch("/api/rulebooks/{rulebook_id}/pin")
def pin_rulebook(request: Request, rulebook_id: str, body: PinRequest):
    require_full_access(request)
    book = pipeline.set_rulebook_pinned(rulebook_id, body.pinned)
    if not book:
        raise HTTPException(status_code=404, detail="Rulebook not found")
    return asdict(book)


@app.post("/api/rulebooks/{rulebook_id}/reindex-stream")
async def reindex_rulebook_stream(request: Request, rulebook_id: str):
    require_full_access(request)
    return StreamingResponse(
        stream_rulebook_reindex(pipeline, rulebook_id=rulebook_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.delete("/api/rulebooks/{rulebook_id}/faq-cache")
def clear_faq_cache(request: Request, rulebook_id: str):
    require_full_access(request)
    try:
        cleared = pipeline.clear_faq_cache(rulebook_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Rulebook not found")
    return {"cleared": cleared}


@app.get("/api/rulebooks/{rulebook_id}/pages/{page}/preview")
def rulebook_page_preview(request: Request, rulebook_id: str, page: int, zoom: float = 1.5):
    require_rulebook_access(request, pipeline.store, rulebook_id)
    if page < 1:
        raise HTTPException(status_code=400, detail="Page number must be at least 1")
    zoom = max(1.0, min(4.0, zoom))
    try:
        png_bytes = pipeline.render_page_preview(rulebook_id, page, zoom=zoom)
    except KeyError:
        raise HTTPException(status_code=404, detail="Rulebook not found")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Rulebook not found") from None
    return Response(content=png_bytes, media_type="image/png")


@app.post("/api/rulebooks/{rulebook_id}/search")
def search_rulebook(request: Request, rulebook_id: str, body: SearchRequest):
    require_rulebook_access(request, pipeline.store, rulebook_id)
    try:
        return pipeline.quick_search(
            rulebook_id,
            body.query,
            limit=body.limit or 8,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Rulebook not found") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/rulebooks/{rulebook_id}/ask")
def ask_rulebook(request: Request, rulebook_id: str, body: AskRequest):
    require_rulebook_access(request, pipeline.store, rulebook_id)
    try:
        history = [msg.model_dump() for msg in body.history]
        return pipeline.ask(rulebook_id, body.question, body.top_k, history)
    except KeyError:
        raise HTTPException(status_code=404, detail="Rulebook not found")
    except RateLimitError as exc:
        raise rate_limit_http_exception(exc) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise server_error("ask", exc)


@app.post("/api/rulebooks/{rulebook_id}/feedback")
def ruling_feedback(request: Request, rulebook_id: str, body: RulingFeedbackRequest):
    require_rulebook_access(request, pipeline.store, rulebook_id)
    try:
        pipeline.record_feedback(rulebook_id, body.model_dump())
    except KeyError:
        raise HTTPException(status_code=404, detail="Rulebook not found")
    return {"recorded": True}


@app.post("/api/rulebooks/{rulebook_id}/dispute")
def dispute_rulebook(request: Request, rulebook_id: str, body: DisputeRequest):
    require_rulebook_access(request, pipeline.store, rulebook_id)
    try:
        history = [msg.model_dump() for msg in body.history]
        return pipeline.dispute(
            rulebook_id,
            body.situation,
            body.player_a,
            body.player_b,
            body.top_k,
            history,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Rulebook not found")
    except RateLimitError as exc:
        raise rate_limit_http_exception(exc) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise server_error("dispute", exc)


if FRONTEND_DIR.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIR / "assets"), name="assets")

    _FAVICON_MEDIA = {
        "favicon.ico": "image/x-icon",
        "favicon.svg": "image/svg+xml",
        "favicon-16.png": "image/png",
        "favicon-32.png": "image/png",
        "apple-touch-icon.png": "image/png",
    }

    for _name, _media in _FAVICON_MEDIA.items():
        _path = FRONTEND_DIR / _name
        if _path.is_file():

            def _favicon_route(
                file_path: Path = _path,
                media_type: str = _media,
            ):
                return FileResponse(file_path, media_type=media_type)

            app.get(f"/{_name}", include_in_schema=False)(_favicon_route)

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404)
        try:
            asset = resolve_frontend_asset(FRONTEND_DIR, full_path)
        except ValueError:
            raise HTTPException(status_code=404, detail="Not found") from None
        return FileResponse(asset)
