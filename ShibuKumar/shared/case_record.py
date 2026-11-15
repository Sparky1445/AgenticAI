"""Shared patient-case record (Shared Contract item 2).

Every agent reads and writes this dict. Entry point for every agent:
    run(case_record) -> case_record
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

VERDICTS = ("eligible", "ineligible", "review")

EMPTY_RECORD = {
    "case_id": "",
    "raw_summary": "",
    "structured": {"age": None, "diagnosis": "", "labs": {}, "medications": [], "conditions": []},
    "retrieved_criteria": [],
    "inclusion_results": [],
    "exclusion_results": [],
    "audit_result": None,
    "verdict": None,
    "matched_criteria": [],
    "failed_criteria": [],
    "clause_ids": [],
    "status": "new",
    "coordinator_note": "",
}


def new_case(case_id: str, raw_summary: str) -> dict:
    rec = copy.deepcopy(EMPTY_RECORD)
    rec["case_id"] = case_id
    rec["raw_summary"] = raw_summary
    return rec


def save_case(rec: dict, store_dir: str | Path = "data/case_store") -> Path:
    """Simple JSON shared store (A5 may replace with SQLite / SK memory)."""
    d = Path(store_dir)
    d.mkdir(parents=True, exist_ok=True)
    p = d / f"{rec['case_id']}.json"
    p.write_text(json.dumps(rec, indent=2), encoding="utf-8")
    return p


def load_case(case_id: str, store_dir: str | Path = "data/case_store") -> dict:
    return json.loads((Path(store_dir) / f"{case_id}.json").read_text(encoding="utf-8"))
