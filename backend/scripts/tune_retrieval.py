#!/usr/bin/env python3
"""Sweep retrieval parameters against benchmark queries (no LLM required)."""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from agents.retrieval_agent import RetrievalAgent  # noqa: E402
from config import RETRIEVAL_LOG_PATH  # noqa: E402
from services.pdf_parser import extract_chunks  # noqa: E402
from services.retrieval_benchmark import SAMPLE_RULEBOOK_CASES, BenchmarkCase  # noqa: E402
from services.retrieval_telemetry import summarize_telemetry_log  # noqa: E402
from services.vector_store import VectorStore  # noqa: E402


@dataclass
class ParamResult:
    top_k: int
    chunk_max_chars: int
    chunk_min_chars: int
    hits: int
    total: int
    avg_rank: float | None

    @property
    def hit_rate(self) -> float:
        return self.hits / self.total if self.total else 0.0


def _default_pdf() -> Path:
    fixture = BACKEND_DIR / "tests" / "fixtures" / "sample-rulebook.pdf"
    if fixture.exists():
        return fixture
    from tests.fixtures.make_sample_pdf import main as make_pdf

    return make_pdf()


def _case_hit(case: BenchmarkCase, retrieved_pages: list[int]) -> tuple[bool, float | None]:
    expected = set(case.expected_pages)
    retrieved = retrieved_pages
    if not expected:
        return True, None
    hit = bool(expected & set(retrieved))
    rank: float | None = None
    for index, page in enumerate(retrieved, start=1):
        if page in expected:
            rank = float(index)
            break
    return hit, rank


def evaluate_params(
    pdf_path: Path,
    *,
    top_k: int,
    chunk_max_chars: int,
    chunk_min_chars: int,
    cases: list[BenchmarkCase],
    chroma_dir: Path,
) -> ParamResult:
    rulebook_id = f"tune-{top_k}-{chunk_max_chars}-{chunk_min_chars}"
    vs = VectorStore(chroma_dir=chroma_dir)
    chunks, _, _, _, _ = extract_chunks(
        pdf_path,
        max_chars=chunk_max_chars,
        min_chars=chunk_min_chars,
    )
    vs.index_rulebook(rulebook_id, chunks)
    retrieval = RetrievalAgent(vs)

    hits = 0
    ranks: list[float] = []
    for case in cases:
        result = retrieval.retrieve(rulebook_id, case.search_query(), top_k)
        pages = [chunk.page for chunk in result["chunks"]]
        hit, rank = _case_hit(case, pages)
        hits += int(hit)
        if rank is not None:
            ranks.append(rank)

    return ParamResult(
        top_k=top_k,
        chunk_max_chars=chunk_max_chars,
        chunk_min_chars=chunk_min_chars,
        hits=hits,
        total=len(cases),
        avg_rank=(sum(ranks) / len(ranks)) if ranks else None,
    )


def run_grid(
    pdf_path: Path,
    *,
    top_k_values: list[int],
    chunk_max_values: list[int],
    chunk_min_values: list[int],
) -> list[ParamResult]:
    results: list[ParamResult] = []
    with tempfile.TemporaryDirectory() as tmp:
        chroma_dir = Path(tmp)
        for top_k in top_k_values:
            for chunk_max in chunk_max_values:
                for chunk_min in chunk_min_values:
                    if chunk_min >= chunk_max:
                        continue
                    results.append(
                        evaluate_params(
                            pdf_path,
                            top_k=top_k,
                            chunk_max_chars=chunk_max,
                            chunk_min_chars=chunk_min,
                            cases=SAMPLE_RULEBOOK_CASES,
                            chroma_dir=chroma_dir,
                        )
                    )
    results.sort(key=lambda item: (-item.hit_rate, item.avg_rank or 999, item.top_k))
    return results


def print_results(results: list[ParamResult], *, limit: int = 10) -> None:
    print(f"{'top_k':>5}  {'max':>4}  {'min':>4}  {'hit%':>6}  {'avg_rank':>8}")
    print("-" * 36)
    for row in results[:limit]:
        avg_rank = f"{row.avg_rank:.1f}" if row.avg_rank is not None else "—"
        print(
            f"{row.top_k:>5}  {row.chunk_max_chars:>4}  {row.chunk_min_chars:>4}  "
            f"{row.hit_rate * 100:>5.0f}%  {avg_rank:>8}"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--pdf",
        type=Path,
        default=None,
        help="Rulebook PDF to benchmark (defaults to tests/fixtures/sample-rulebook.pdf)",
    )
    parser.add_argument("--top-k", type=int, nargs="+", default=[4, 6, 8])
    parser.add_argument("--chunk-max", type=int, nargs="+", default=[400, 600, 800])
    parser.add_argument("--chunk-min", type=int, nargs="+", default=[80, 100, 150])
    parser.add_argument("--limit", type=int, default=10, help="Rows to print from the grid")
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print full results as JSON instead of a table",
    )
    parser.add_argument(
        "--summarize-log",
        action="store_true",
        help="Summarize live retrieval telemetry from the JSONL log",
    )
    parser.add_argument(
        "--log-path",
        type=Path,
        default=RETRIEVAL_LOG_PATH,
        help="Path to retrieval telemetry JSONL",
    )
    args = parser.parse_args()

    if args.summarize_log:
        summary = summarize_telemetry_log(args.log_path)
        print(json.dumps(summary, indent=2))
        return

    pdf_path = args.pdf or _default_pdf()
    if not pdf_path.exists():
        raise SystemExit(f"PDF not found: {pdf_path}")

    results = run_grid(
        pdf_path,
        top_k_values=args.top_k,
        chunk_max_values=args.chunk_max,
        chunk_min_values=args.chunk_min,
    )

    if args.json:
        payload = [asdict(row) for row in results]
        print(json.dumps(payload, indent=2))
        return

    print(f"Benchmark: {pdf_path.name} ({len(SAMPLE_RULEBOOK_CASES)} cases)\n")
    print_results(results, limit=args.limit)
    best = results[0]
    print(
        f"\nBest: TOP_K_CHUNKS={best.top_k} "
        f"CHUNK_MAX_CHARS={best.chunk_max_chars} "
        f"CHUNK_MIN_CHARS={best.chunk_min_chars} "
        f"({best.hits}/{best.total} hits)"
    )


if __name__ == "__main__":
    main()
