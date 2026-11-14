"""A3 / A4 / A6 — Fan-out / Fan-in Orchestrator with Auditor Gate.

Coordinates the full pipeline in the agreed fan-out / fan-in architecture:

    A1  Patient Intake Agent         (structures raw text)
      └─► B2  Criteria Retrieval         ─┐  fan-out
      └─► B4  Exclusion Checker          ─┘
    A2  Eligibility Manager          fan-in: applies inclusion rules, issues verdict
    B5  Evidence Auditor Gate        (A4): on fail → downgrade to review
    A6  Final output                 verdict + matched/failed criteria + clause_ids
    A7  Human-in-the-loop            (called if verdict == "review")

Usage:
    from Atharwa.orchestrator import run_pipeline
    record = run_pipeline("P001", raw_summary_text)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

# ── import Part A agents ───────────────────────────────────────────────────
_HERE  = Path(__file__).resolve().parent
_PARTB = _HERE.parent / "CLINICAL TRIAL ELIGIBILITY MATCHING DESK"
for _p in (_HERE, _PARTB):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from part_a_agents.patient_intake_agent    import run as intake_run   # A1
from part_a_agents.eligibility_manager_agent import run as manager_run # A2

# ── import Part B agents ───────────────────────────────────────────────────
from agents import (                                                    # type: ignore[import]
    criteria_retrieval_agent,
    exclusion_checker_agent,
    evidence_auditor_agent,
)
from shared.case_record import new_case, save_case                     # type: ignore[import]

# ── import human-in-the-loop (A7) ─────────────────────────────────────────
from human_loop import route_to_coordinator                            # A7


# ══════════════════════════════════════════════════════════════════════════
# A3  Fan-out helpers
# ══════════════════════════════════════════════════════════════════════════

def _fan_out(rec: dict) -> dict:
    """Run B2 and B4 sequentially (architecturally a fan-out — both branches
    depend only on `structured`, not on each other's output).

    In a production async system these would be awaited concurrently:
        results = await asyncio.gather(criteria_task, exclusion_task)
    Here we run them sequentially and label each step in the status field
    so the evaluator and demo can observe the fan-out semantics.
    """
    # Branch 1 — Criteria Retrieval (RAG)
    rec = criteria_retrieval_agent.run(rec)       # fills retrieved_criteria[]
    # Branch 2 — Exclusion Checker (needs retrieved_criteria from branch 1)
    rec = exclusion_checker_agent.run(rec)        # fills exclusion_results[]
    rec["status"] = "fanout_complete"
    return rec


# ══════════════════════════════════════════════════════════════════════════
# A6  Final output helper
# ══════════════════════════════════════════════════════════════════════════

_FINAL_KEYS = (
    "case_id", "verdict", "matched_criteria",
    "failed_criteria", "clause_ids", "status", "coordinator_note",
)


def extract_output(rec: dict) -> dict:
    """A6: Return the finalised verdict record (subset of full case record)."""
    return {k: rec.get(k) for k in _FINAL_KEYS}


# ══════════════════════════════════════════════════════════════════════════
# Main pipeline
# ══════════════════════════════════════════════════════════════════════════

def run_pipeline(
    case_id: str,
    raw_summary: str,
    store_dir: str | Path | None = None,
    coordinator_input: str | None = None,
) -> dict:
    """Run one patient through the full A+B pipeline.

    Args:
        case_id:           Patient identifier (e.g. 'P001').
        raw_summary:       Free-text patient summary.
        store_dir:         Optional path to save the shared case record JSON.
        coordinator_input: If provided, fed into the human-in-the-loop path
                           as the coordinator's note (useful for testing A7).

    Returns:
        Full case record dict (not just the A6 subset).
    """
    # ── A5: initialise shared case record ─────────────────────────────────
    rec = new_case(case_id, raw_summary)

    # ── A1: Patient Intake ─────────────────────────────────────────────────
    rec = intake_run(rec)

    # ── A3: Fan-out — B2 Criteria Retrieval + B4 Exclusion Checker ────────
    rec = _fan_out(rec)

    # ── A2: Eligibility Manager (fan-in) ──────────────────────────────────
    rec = manager_run(rec)

    # ── A4: Evidence Auditor Gate ──────────────────────────────────────────
    rec = evidence_auditor_agent.run(rec)

    # ── A7: Human-in-the-loop ─────────────────────────────────────────────
    if rec["verdict"] == "review":
        rec = route_to_coordinator(rec, coordinator_note=coordinator_input)

    # ── A5: Save shared case record ───────────────────────────────────────
    if store_dir is not None:
        save_case(rec, store_dir)

    return rec


# ══════════════════════════════════════════════════════════════════════════
# Semantic Kernel plugin wrapper (optional — for SK orchestration)
# ══════════════════════════════════════════════════════════════════════════

try:
    from framework import kernel_function          # type: ignore[import]
except ImportError:
    def kernel_function(*_a, **_k):
        def deco(f): return f
        return deco


class OrchestratorPlugin:
    """SK plugin that wraps the full pipeline so it can be called from a
    Semantic Kernel planner or chat plugin."""

    @kernel_function(
        name="run_pipeline",
        description="Run one patient through the complete A+B eligibility pipeline",
    )
    def run_pipeline(self, case_id: str, raw_summary: str) -> str:
        rec = run_pipeline(case_id, raw_summary)
        return json.dumps(extract_output(rec))
