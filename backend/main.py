from __future__ import annotations

import re
import uuid
from dataclasses import asdict

from typing import Literal, Optional

from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from agents.pipeline import RefereePipeline
from config import CORS_ORIGINS, ensure_dirs

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
    top_k: Optional[int] = Field(default=None, ge=1, le=20)


def _safe_filename(name: str) -> str:
    base = re.sub(r"[^\w.\-]+", "_", name).strip("._")
    return base or "rulebook.pdf"


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/rulebooks")
def list_rulebooks():
    return [asdict(book) for book in pipeline.store.list()]


@app.post("/api/rulebooks")
async def upload_rulebook(
    file: UploadFile = File(...),
    name: Optional[str] = Form(default=None),
):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF rulebooks are supported")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")

    display_name = (name or "").strip() or None
    stored_name = f"{uuid.uuid4()}_{_safe_filename(file.filename)}"

    try:
        result = pipeline.upload_rulebook(
            display_name,
            stored_name,
            content,
            original_filename=file.filename,
        )
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
