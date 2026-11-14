"""Minimal stand-ins for Part A so Part B can be run and evaluated on its own.

  stub_intake   -> replaced by A1 Patient Intake Agent
  stub_manager  -> replaced by A2 Eligibility Manager
  run_pipeline  -> replaced by A3/A4 fan-out / fan-in orchestrator with auditor gate

Both stubs are deterministic regex / rule code, so the evaluation numbers
measure Part B (retrieval, rule tool, exclusion checker, auditor).
"""
from __future__ import annotations

import re

from agents import criteria_retrieval_agent, exclusion_checker_agent, evidence_auditor_agent
from shared.case_record import new_case
from tools import rule_tool

_LAB = {"hba1c": r"HbA1c\s*(\d+(?:\.\d+)?)", "bmi": r"BMI\s*(\d+(?:\.\d+)?)",
        "egfr": r"eGFR\s*(\d+(?:\.\d+)?)", "alt": r"ALT\s*(\d+(?:\.\d+)?)"}


def stub_intake(rec: dict) -> dict:
    s = rec["raw_summary"]
    age = re.search(r"(\d+)-year-old", s)
    diag = re.search(r"with ([^.]+)\.", s)
    meds = re.search(r"Medications:\s*([^.]+)\.", s)
    hist = re.search(r"History:\s*([^.]+)\.", s)
    labs = {k: float(m.group(1)) for k, p in _LAB.items() if (m := re.search(p, s, re.I))}
    rec["structured"] = {
        "age": int(age.group(1)) if age else None,
        "diagnosis": diag.group(1).strip() if diag else "",
        "labs": labs,
        "medications": [m.strip() for m in meds.group(1).split(",")] if meds else [],
        "conditions": [] if not hist or hist.group(1).strip().lower() == "none"
        else [c.strip() for c in hist.group(1).split(",")],
    }
    rec["status"] = "intake_done"
    return rec


def stub_manager(rec: dict) -> dict:
    structured = rec["structured"]
    rec["inclusion_results"] = []
    for c in rec["retrieved_criteria"]:
        if c["type"] == "inclusion" and c.get("rule"):
            r = rule_tool.apply(c["rule"], "inclusion", structured)
            rec["inclusion_results"].append({"clause_id": c["clause_id"], "title": c["title"], **r})
    inc, exc = rec["inclusion_results"], rec["exclusion_results"]
    triggered = [r["clause_id"] for r in exc if r["triggered"]]
    unmet = [r["clause_id"] for r in inc if r["outcome"] == "fail"]
    unsure = [r["clause_id"] for r in inc + exc if r["outcome"] in ("borderline", "unknown")]
    rec["matched_criteria"] = [r["clause_id"] for r in inc if r["outcome"] == "pass"]
    rec["failed_criteria"] = triggered + unmet
    if triggered or unmet:
        rec["verdict"], rec["clause_ids"] = "ineligible", triggered + unmet
    elif unsure:
        rec["verdict"], rec["clause_ids"] = "review", unsure
    else:
        rec["verdict"], rec["clause_ids"] = "eligible", rec["matched_criteria"]
    rec["status"] = "verdict_proposed"
    return rec


def run_pipeline(case_id: str, raw_summary: str) -> dict:
    rec = new_case(case_id, raw_summary)
    rec = stub_intake(rec)                              # A1
    rec = criteria_retrieval_agent.run(rec)             # B2  (fan-out branch 1)
    rec = exclusion_checker_agent.run(rec)              # B4  (fan-out branch 2)
    rec = stub_manager(rec)                             # A2  (fan-in)
    rec = evidence_auditor_agent.run(rec)               # B5  (auditor gate, A4)
    if rec["verdict"] == "review" and rec["status"] != "review_queue":
        rec["status"] = "review_queue"                  # A7 human-in-the-loop entry point
    elif rec["status"] == "audit_passed":
        rec["status"] = "closed"
    return rec
