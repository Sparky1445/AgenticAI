"""A2 - Eligibility Manager Agent.

Fan-in agent.  Receives a case record after:
  - B2 Criteria Retrieval (retrieved_criteria)
  - B4 Exclusion Checker  (exclusion_results)

Responsibilities:
  1. Evaluate every INCLUSION clause with rule_tool.apply (mirrors stub_manager).
  2. Collect triggered exclusions.
  3. Issue a preliminary verdict: eligible / ineligible / review.
  4. Populate matched_criteria, failed_criteria, clause_ids.

The Evidence Auditor Agent (B5) gates this verdict afterward; on audit failure
it may downgrade to 'review'.

Entry point: run(case_record) -> case_record
SK plugin  : EligibilityManagerPlugin.run(case_record_json) -> str
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

_PARTB = Path(__file__).resolve().parent.parent.parent / "CLINICAL TRIAL ELIGIBILITY MATCHING DESK"
# part_a_agents/ → Atharwa/ → CA2Agent/ → CA2Agent/CLINICAL TRIAL...
if str(_PARTB) not in sys.path:
    sys.path.insert(0, str(_PARTB))

try:
    from framework import kernel_function
    from tools import rule_tool
except ImportError:
    def kernel_function(*_a, **_k):
        def deco(f): return f
        return deco
    rule_tool = None  # type: ignore


def _apply_inclusion_rules(case_record: dict) -> list[dict]:
    """Apply rule_tool.apply to every retrieved inclusion clause that has a rule."""
    if rule_tool is None:
        raise RuntimeError("rule_tool not importable — ensure Part B is on sys.path")
    structured = case_record.get("structured") or {}
    results: list[dict] = []
    for clause in case_record.get("retrieved_criteria") or []:
        if clause.get("type") != "inclusion" or not clause.get("rule"):
            continue
        r = rule_tool.apply(clause["rule"], "inclusion", structured)
        results.append({
            "clause_id": clause["clause_id"],
            "title":     clause.get("title", ""),
            "outcome":   r["outcome"],   # pass | fail | borderline | unknown
            "triggered": r["triggered"], # always False for inclusion
            "evidence":  r["evidence"],
            "reason":    r["reason"],
            "tool":      "rule_tool.apply",
        })
    return results


def decide(case_record: dict) -> dict:
    """Compute verdict from inclusion + exclusion results."""
    inc: list[dict] = case_record.get("inclusion_results") or []
    exc: list[dict] = case_record.get("exclusion_results") or []

    triggered = [r["clause_id"] for r in exc if r.get("triggered")]
    unmet     = [r["clause_id"] for r in inc if r.get("outcome") == "fail"]
    unsure    = [r["clause_id"] for r in inc + exc if r.get("outcome") in ("borderline", "unknown")]
    matched   = [r["clause_id"] for r in inc if r.get("outcome") == "pass"]

    case_record["matched_criteria"] = matched
    case_record["failed_criteria"]  = triggered + unmet

    if triggered or unmet:
        case_record["verdict"]    = "ineligible"
        case_record["clause_ids"] = triggered + unmet
    elif unsure:
        case_record["verdict"]    = "review"
        case_record["clause_ids"] = unsure
    else:
        case_record["verdict"]    = "eligible"
        case_record["clause_ids"] = matched

    case_record["status"] = "verdict_proposed"
    return case_record


def run(case_record: dict) -> dict:
    """A2 entry point.  Fills inclusion_results, verdict, clause_ids."""
    case_record["inclusion_results"] = _apply_inclusion_rules(case_record)
    return decide(case_record)


class EligibilityManagerPlugin:
    """Semantic Kernel plugin wrapper for A2."""

    @kernel_function(name="run", description="Fan-in: apply inclusion rules and issue preliminary verdict (A2 Manager)")
    def run(self, case_record_json: str) -> str:
        return json.dumps(run(json.loads(case_record_json)))
