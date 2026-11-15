"""B4 - Exclusion Checker Agent.

Tests every retrieved *exclusion* clause with the deterministic rule tool (B3).
No LLM judging. Writes exclusion_results[] into the shared case record.

Entry point: run(case_record) -> case_record
"""
from __future__ import annotations

import json

from framework import kernel_function
from tools import rule_tool


def check(case_record: dict) -> list[dict]:
    structured = case_record.get("structured") or {}
    results = []
    for crit in case_record.get("retrieved_criteria") or []:
        if crit.get("type") != "exclusion" or not crit.get("rule"):
            continue
        r = rule_tool.apply(crit["rule"], "exclusion", structured)
        results.append({
            "clause_id": crit["clause_id"],
            "title": crit.get("title"),
            "outcome": r["outcome"],          # pass | fail | borderline | unknown
            "triggered": r["triggered"],      # True means the patient is excluded by this clause
            "evidence": r["evidence"],
            "reason": r["reason"],
            "tool": "rule_tool.apply",
        })
    return results


def run(case_record: dict) -> dict:
    case_record["exclusion_results"] = check(case_record)
    case_record["status"] = "exclusions_checked"
    return case_record


class ExclusionCheckerPlugin:
    @kernel_function(name="run", description="Tests each retrieved exclusion clause with the deterministic rule tool")
    def run(self, case_record_json: str) -> str:
        return json.dumps(run(json.loads(case_record_json)))
