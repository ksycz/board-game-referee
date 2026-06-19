import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.getenv("DATA_DIR", BASE_DIR / "data"))
RULEBOOKS_DIR = DATA_DIR / "rulebooks"
CHROMA_DIR = DATA_DIR / "chroma"

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
TOP_K_CHUNKS = int(os.getenv("TOP_K_CHUNKS", "6"))
CHUNK_MAX_CHARS = int(os.getenv("CHUNK_MAX_CHARS", "600"))
CHUNK_MIN_CHARS = int(os.getenv("CHUNK_MIN_CHARS", "100"))

_telemetry = os.getenv("RETRIEVAL_TELEMETRY", "1").strip().lower()
RETRIEVAL_TELEMETRY = _telemetry in ("1", "true", "yes", "on")
RETRIEVAL_LOG_PATH = Path(
    os.getenv("RETRIEVAL_LOG_PATH", str(DATA_DIR / "retrieval_telemetry.jsonl"))
)

_faq_cache = os.getenv("FAQ_CACHE", "1").strip().lower()
FAQ_CACHE_ENABLED = _faq_cache in ("1", "true", "yes", "on")
FAQ_CACHE_MAX_ENTRIES = int(os.getenv("FAQ_CACHE_MAX_ENTRIES", "100"))

_ocr_fallback = os.getenv("OCR_FALLBACK", "0").strip().lower()
OCR_FALLBACK = _ocr_fallback in ("1", "true", "yes", "on")
OCR_LANGUAGE = os.getenv("OCR_LANGUAGE", "eng")
OCR_DPI = int(os.getenv("OCR_DPI", "150"))
OCR_MIN_INDEXABLE_CHARS = int(os.getenv("OCR_MIN_INDEXABLE_CHARS", "80"))

_cors = os.getenv("CORS_ORIGINS", "http://localhost:5173")
CORS_ORIGINS = [origin.strip() for origin in _cors.split(",") if origin.strip()]


def ensure_dirs() -> None:
    RULEBOOKS_DIR.mkdir(parents=True, exist_ok=True)
    CHROMA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "faq_cache").mkdir(parents=True, exist_ok=True)
