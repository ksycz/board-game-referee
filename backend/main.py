from __future__ import annotations

import re
import uuid
from dataclasses import asdict
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from agents.pipeline import RefereePipeline
from config import CORS_ORIGINS, ensure_dirs
from services.rulebook_store import DuplicateRulebookError
from services.upload_stream import stream_rulebook_upload

ensure_dirs()

app = FastAPI(title="Board Game Rules Referee", version="0.1.0")
pipeline = RefereePipeline()

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


def _safe_filename(name: str) -> str:
    base = re.sub(r"[^\w.\-]+", "_", name).strip("._")
    return base or "rulebook.pdf"


async def _read_upload_pdf(file: UploadFile) -> tuple[bytes, str]:
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF rulebooks are supported")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    return content, file.filename


@app.post("/api/rulebooks/upload-stream")
async def upload_rulebook_stream(
    file: UploadFile = File(...),
    name: str | None = Form(default=None),
):
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


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/rulebooks")
def list_rulebooks():
    pipeline.dedupe_rulebooks()
    return [asdict(book) for book in pipeline.store.list()]


@app.post("/api/rulebooks")
async def upload_rulebook(
    file: UploadFile = File(...),
    name: str | None = Form(default=None),
):
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
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {
        "rulebook": asdict(result["rulebook"]),
        "ingestion": result["ingestion"],
        "example_questions": result["example_questions"],
    }


@app.get("/api/rulebooks/{rulebook_id}/examples")
def rulebook_examples(rulebook_id: str):
    try:
        return {"questions": pipeline.example_questions(rulebook_id)}
    except KeyError:
        raise HTTPException(status_code=404, detail="Rulebook not found")


@app.delete("/api/rulebooks/{rulebook_id}")
def delete_rulebook(rulebook_id: str):
    if not pipeline.delete_rulebook(rulebook_id):
        raise HTTPException(status_code=404, detail="Rulebook not found")
    return {"deleted": rulebook_id}


@app.patch("/api/rulebooks/{rulebook_id}/pin")
def pin_rulebook(rulebook_id: str, body: PinRequest):
    book = pipeline.set_rulebook_pinned(rulebook_id, body.pinned)
    if not book:
        raise HTTPException(status_code=404, detail="Rulebook not found")
    return asdict(book)


@app.delete("/api/rulebooks/{rulebook_id}/faq-cache")
def clear_faq_cache(rulebook_id: str):
    try:
        cleared = pipeline.clear_faq_cache(rulebook_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Rulebook not found")
    return {"cleared": cleared}


@app.get("/api/rulebooks/{rulebook_id}/pages/{page}/preview")
def rulebook_page_preview(rulebook_id: str, page: int):
    if page < 1:
        raise HTTPException(status_code=400, detail="Page number must be at least 1")
    try:
        png_bytes = pipeline.render_page_preview(rulebook_id, page)
    except KeyError:
        raise HTTPException(status_code=404, detail="Rulebook not found")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(content=png_bytes, media_type="image/png")


@app.post("/api/rulebooks/{rulebook_id}/ask")
def ask_rulebook(rulebook_id: str, body: AskRequest):
    try:
        history = [msg.model_dump() for msg in body.history]
        return pipeline.ask(rulebook_id, body.question, body.top_k, history)
    except KeyError:
        raise HTTPException(status_code=404, detail="Rulebook not found")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/rulebooks/{rulebook_id}/feedback")
def ruling_feedback(rulebook_id: str, body: RulingFeedbackRequest):
    try:
        pipeline.record_feedback(rulebook_id, body.model_dump())
    except KeyError:
        raise HTTPException(status_code=404, detail="Rulebook not found")
    return {"recorded": True}


@app.post("/api/rulebooks/{rulebook_id}/dispute")
def dispute_rulebook(rulebook_id: str, body: DisputeRequest):
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
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


if FRONTEND_DIR.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404)
        candidate = FRONTEND_DIR / full_path
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIR / "index.html")
