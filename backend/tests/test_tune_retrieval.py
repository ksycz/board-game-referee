"""Tests for the retrieval tuning script."""

import importlib.util
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
SCRIPT_PATH = BACKEND_DIR / "scripts" / "tune_retrieval.py"


def _load_tune_module():
    spec = importlib.util.spec_from_file_location("tune_retrieval", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules["tune_retrieval"] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def tune_module():
    return _load_tune_module()


def test_tune_retrieval_finds_reasonable_defaults(sample_pdf, tune_module):
    results = tune_module.run_grid(
        sample_pdf,
        top_k_values=[4, 6],
        chunk_max_values=[600],
        chunk_min_values=[100],
    )
    assert results
    best = results[0]
    assert best.hit_rate >= 0.8
    assert best.top_k in (4, 6)


def test_current_defaults_score_well_on_sample_pdf(sample_pdf, tune_module, tmp_path):
    result = tune_module.evaluate_params(
        sample_pdf,
        top_k=6,
        chunk_max_chars=600,
        chunk_min_chars=100,
        cases=tune_module.SAMPLE_RULEBOOK_CASES,
        chroma_dir=tmp_path / "chroma",
    )
    assert result.hit_rate == 1.0
