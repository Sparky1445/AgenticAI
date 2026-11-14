"""A1 - Patient Intake Agent.

Structures raw patient summary text into the shared case record's
`structured` field:  age, diagnosis, labs, medications, conditions.

This is Atharwa's replacement for evaluation/stub_pipeline.stub_intake.
It uses more robust regex patterns plus a simple keyword mapper to normalise
medication names, and explicitly tags its method so it is distinguishable
from the Part-B evaluation stub.

Entry point: run(case_record) -> case_record   (fills `structured`, sets status)
SK plugin  : PatientIntakePlugin.run(case_record_json) -> str (JSON)
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

# ── make Part-B modules importable when this file is run directly ──────────
_PARTB = Path(__file__).resolve().parent.parent.parent / "CLINICAL TRIAL ELIGIBILITY MATCHING DESK"
# part_a_agents/ → Atharwa/ → CA2Agent/ → CA2Agent/CLINICAL TRIAL...
if str(_PARTB) not in sys.path:
    sys.path.insert(0, str(_PARTB))

try:
    from framework import kernel_function
except ImportError:
    def kernel_function(*_a, **_k):
        def deco(f): return f
        return deco

# ─────────────────────────── regex patterns ───────────────────────────────
_AGE_RE    = re.compile(r"(\d{1,3})[- ]year[- ]old", re.I)
_DIAG_RE   = re.compile(r"with ([^.]+?)\.", re.I)
_MEDS_RE   = re.compile(r"medications?\s*[:=]\s*([^.]+)\.", re.I)
_HIST_RE   = re.compile(r"history\s*[:=]\s*([^.]+)\.", re.I)

_LAB_PATTERNS: dict[str, re.Pattern] = {
    "hba1c": re.compile(r"hba1c\s+([\d.]+)\s*%?", re.I),
    "bmi":   re.compile(r"bmi\s+([\d.]+)", re.I),
    "egfr":  re.compile(r"egfr\s+([\d.]+)", re.I),
    "alt":   re.compile(r"\balt\s+([\d.]+)", re.I),
    "sbp":   re.compile(r"sbp\s+([\d.]+)", re.I),
    "creatinine": re.compile(r"creatinine\s+([\d.]+)", re.I),
}

# Keyword → canonical medication category for rule_tool compatibility
_MED_ALIASES: dict[str, str] = {
    "insulin": "insulin",
    "glargine": "insulin",
    "aspart": "insulin",
    "lispro": "insulin",
    "glp-1": "GLP-1 RA",
    "semaglutide": "GLP-1 RA",
    "liraglutide": "GLP-1 RA",
    "dulaglutide": "GLP-1 RA",
    "exenatide": "GLP-1 RA",
    "metformin": "metformin",
}

# ─────────────────────────── helpers ──────────────────────────────────────

def _extract_labs(text: str) -> dict[str, float]:
    labs: dict[str, float] = {}
    for name, pat in _LAB_PATTERNS.items():
        m = pat.search(text)
        if m:
            try:
                labs[name] = float(m.group(1))
            except ValueError:
                pass
    return labs


def _extract_medications(text: str) -> list[str]:
    """Return raw medication tokens; keeps originals so the rule tool can
    still match against 'insulin', 'GLP-1', etc. by substring."""
    m = _MEDS_RE.search(text)
    if not m:
        return []
    raw_meds = [t.strip().rstrip(".") for t in m.group(1).split(",")]
    result: list[str] = []
    for med in raw_meds:
        if med.lower() in ("none", ""):
            continue
        result.append(med)
        # Also append canonical alias so rule_tool.medication_any can match
        for kw, alias in _MED_ALIASES.items():
            if kw.lower() in med.lower() and alias not in result:
                result.append(alias)
    return result


def _extract_conditions(text: str) -> list[str]:
    m = _HIST_RE.search(text)
    if not m:
        return []
    raw = m.group(1).strip()
    if raw.lower() in ("none", "nil", ""):
        return []
    return [c.strip() for c in raw.split(",")]


def _extract_diagnosis(text: str) -> str:
    m = _DIAG_RE.search(text)
    if not m:
        return ""
    return m.group(1).strip().rstrip(".")


# ─────────────────────────── agent ────────────────────────────────────────

def structure(raw_summary: str) -> dict:
    """Parse raw text → structured patient data."""
    age_m = _AGE_RE.search(raw_summary)
    return {
        "age":         int(age_m.group(1)) if age_m else None,
        "diagnosis":   _extract_diagnosis(raw_summary),
        "labs":        _extract_labs(raw_summary),
        "medications": _extract_medications(raw_summary),
        "conditions":  _extract_conditions(raw_summary),
    }


def run(case_record: dict) -> dict:
    """A1 entry point.  Fills case_record['structured'] and updates status."""
    case_record["structured"] = structure(case_record.get("raw_summary", ""))
    case_record["status"] = "intake_done"
    return case_record


class PatientIntakePlugin:
    """Semantic Kernel plugin wrapper for A1."""

    @kernel_function(name="run", description="Parse raw patient text into structured fields (A1 Intake Agent)")
    def run(self, case_record_json: str) -> str:
        return json.dumps(run(json.loads(case_record_json)))
