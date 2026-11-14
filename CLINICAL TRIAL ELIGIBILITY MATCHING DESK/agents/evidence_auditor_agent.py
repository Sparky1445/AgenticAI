"""B5 - Evidence Auditor Agent (the gate).

Verifies that every claim in the record traces back to a retrieved protocol
clause, and that the proposed verdict is consistent with the rule results.
Returns pass/fail with reasons. On fail the gate (A4) routes the case to
`review` - no verdict is released past a failed audit.

Entry point: run(case_record) -> case_record   (fills audit_result, may override verdict)
"""
from __future__ import annotations

import json

from framework import kernel_function


def audit(case_record: dict) -> dict:
    retrieved = {c["clause_id"]: c for c in case_record.get("retrieved_criteria") or []}
    reasons: list[str] = []
    checked = 0

    # 1. Every inclusion / exclusion result must cite a retrieved clause and carry evidence.
    for bucket in ("inclusion_results", "exclusion_results"):
        for r in case_record.get(bucket) or []:
            checked += 1
            cid = r.get("clause_id")
            if cid not in retrieved:
                reasons.append(f"{bucket}: {cid} was not among retrieved criteria")
            if r.get("outcome") in ("pass", "fail", "borderline") and r.get("evidence") in (None, ""):
                reasons.append(f"{bucket}: {cid} outcome '{r.get('outcome')}' has no evidence value")
            if r.get("outcome") not in ("pass", "fail", "borderline", "unknown"):
                reasons.append(f"{bucket}: {cid} has invalid outcome '{r.get('outcome')}'")

    # 2. Every clause ID behind the verdict must be retrieved AND have a result.
    result_ids = {r["clause_id"] for b in ("inclusion_results", "exclusion_results")
                  for r in case_record.get(b) or []}
    for cid in case_record.get("clause_ids") or []:
        checked += 1
        if cid not in retrieved:
            reasons.append(f"verdict cites {cid}, which was never retrieved")
        elif cid not in result_ids:
            reasons.append(f"verdict cites {cid}, but no rule result exists for it")
    for cid in (case_record.get("matched_criteria") or []) + (case_record.get("failed_criteria") or []):
        if cid not in retrieved:
            reasons.append(f"matched/failed criterion {cid} was never retrieved")

    # 3. Verdict must be consistent with the deterministic results.
    verdict = case_record.get("verdict")
    exc = case_record.get("exclusion_results") or []
    inc = case_record.get("inclusion_results") or []
    triggered = [r["clause_id"] for r in exc if r.get("triggered")]
    unmet = [r["clause_id"] for r in inc if r.get("outcome") == "fail"]
    unsure = [r["clause_id"] for r in inc + exc if r.get("outcome") in ("borderline", "unknown")]
    if verdict not in ("eligible", "ineligible", "review"):
        reasons.append(f"invalid verdict '{verdict}'")
    if verdict == "eligible" and (triggered or unmet or unsure):
        reasons.append(f"verdict 'eligible' contradicts results: triggered={triggered} unmet={unmet} unsure={unsure}")
    if verdict == "ineligible" and not (triggered or unmet):
        reasons.append("verdict 'ineligible' but no exclusion triggered and no inclusion unmet")
    if verdict in ("eligible", "ineligible") and not case_record.get("clause_ids"):
        reasons.append("verdict released without any supporting clause IDs")
    if not retrieved:
        reasons.append("no criteria were retrieved; nothing can be grounded")

    return {"passed": not reasons, "checks": checked, "reasons": reasons, "auditor": "evidence_auditor_agent"}


def run(case_record: dict) -> dict:
    result = audit(case_record)
    case_record["audit_result"] = result
    if result["passed"]:
        case_record["status"] = "audit_passed"
    else:                                   # the gate: failed audit -> review queue
        case_record["verdict"] = "review"
        case_record["status"] = "review_queue"
        case_record["coordinator_note"] = (case_record.get("coordinator_note") or "") + \
            "[auditor] " + "; ".join(result["reasons"])
    return case_record


class EvidenceAuditorPlugin:
    @kernel_function(name="run", description="Verifies every claim traces to a retrieved clause; pass/fail gate")
    def run(self, case_record_json: str) -> str:
        return json.dumps(run(json.loads(case_record_json)))
