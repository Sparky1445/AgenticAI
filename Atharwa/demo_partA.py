"""Part A Demo — walk one patient through every agent step.

Usage:
    cd C:\\...\\CA2Agent\\Atharwa
    python demo_partA.py           (runs P008, the borderline case)
    python demo_partA.py P001      (any case_id from data/patients.json)
    python demo_partA.py P008 "ELIGIBLE - borderline HbA1c acceptable per PI"
                                   (supply a coordinator note to test A7)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

_HERE  = Path(__file__).resolve().parent
_PARTB = _HERE.parent / "CLINICAL TRIAL ELIGIBILITY MATCHING DESK"
for _p in (_HERE, _PARTB):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from part_a_agents.patient_intake_agent      import run as intake_run  # A1
from part_a_agents.eligibility_manager_agent import run as manager_run # A2
from agents import (                                                    # type: ignore[import]
    criteria_retrieval_agent,
    exclusion_checker_agent,
    evidence_auditor_agent,
)
from human_loop       import route_to_coordinator                       # A7
from shared.case_record import new_case, save_case                     # type: ignore[import]

PATIENTS_FILE = _PARTB / "data" / "patients.json"
STORE_DIR     = _PARTB / "data" / "case_store"


def banner(title: str) -> None:
    print("\n" + "=" * 72 + f"\n  {title}\n" + "=" * 72)


def main(case_id: str, coordinator_note: str | None = None) -> None:
    patients = {p["case_id"]: p
                for p in json.loads(PATIENTS_FILE.read_text(encoding="utf-8"))}
    if case_id not in patients:
        print(f"Unknown case_id '{case_id}'. Available: {', '.join(patients)}")
        sys.exit(1)

    p   = patients[case_id]
    rec = new_case(case_id, p["raw_summary"])

    # ── RAW SUMMARY ──────────────────────────────────────────────────────
    banner(f"RAW SUMMARY  (case={case_id}, expected={p['expected_verdict']})")
    print(rec["raw_summary"])

    # ── A1: Patient Intake ────────────────────────────────────────────────
    rec = intake_run(rec)
    banner("A1 Patient Intake Agent → structured")
    print(json.dumps(rec["structured"], indent=2))

    # ── B2: Criteria Retrieval ────────────────────────────────────────────
    rec = criteria_retrieval_agent.run(rec)
    banner(f"B2 Criteria Retrieval Agent → {len(rec['retrieved_criteria'])} governing clauses")
    for c in rec["retrieved_criteria"]:
        print(f"  {c['clause_id']:18} {c['type']:10} score={c['score']:.3f}  {c['title']}")

    # ── B4: Exclusion Checker ─────────────────────────────────────────────
    rec = exclusion_checker_agent.run(rec)
    banner("B4 Exclusion Checker Agent (B3 deterministic rule tool)")
    for r in rec["exclusion_results"]:
        flag = "TRIGGERED" if r["triggered"] else r["outcome"].upper()
        print(f"  {r['clause_id']:18} {flag:12} {r['reason']}")

    # ── A2: Eligibility Manager ───────────────────────────────────────────
    rec = manager_run(rec)
    banner("A2 Eligibility Manager → inclusion rules + verdict")
    for r in rec["inclusion_results"]:
        print(f"  {r['clause_id']:18} {r['outcome'].upper():12} {r['reason']}")
    print(f"\n  Proposed verdict : {rec['verdict']}")
    print(f"  Clause IDs       : {rec['clause_ids']}")

    # ── B5 / A4: Evidence Auditor Gate ────────────────────────────────────
    rec = evidence_auditor_agent.run(rec)
    banner("B5 Evidence Auditor Gate (A4)")
    a = rec["audit_result"]
    print(f"  passed={a['passed']}  checks={a['checks']}")
    if a["reasons"]:
        print(f"  reasons: {a['reasons']}")

    # ── A7: Human-in-the-loop ─────────────────────────────────────────────
    if rec["verdict"] == "review":
        banner("A7 Human-in-the-loop → Trial Coordinator")
        if coordinator_note:
            print(f"  [coordinator note supplied]: {coordinator_note}")
            rec = route_to_coordinator(rec, coordinator_note=coordinator_note)
        else:
            # Non-interactive demo: use auto-stub note
            rec = route_to_coordinator(rec)
        print(f"  coordinator_note : {rec['coordinator_note']}")
        print(f"  final status     : {rec['status']}")

    # ── A6: Final Output ──────────────────────────────────────────────────
    banner("A6 FINAL OUTPUT")
    output_keys = ("case_id", "verdict", "matched_criteria",
                   "failed_criteria", "clause_ids", "status")
    print(json.dumps({k: rec[k] for k in output_keys}, indent=2))

    path = save_case(rec, STORE_DIR)
    print(f"\n  Shared record saved → {path.relative_to(_PARTB.parent)}")


if __name__ == "__main__":
    _cid  = sys.argv[1] if len(sys.argv) > 1 else "P008"
    _note = sys.argv[2] if len(sys.argv) > 2 else None
    main(_cid, _note)
