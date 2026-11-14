"""Part B demo: walk one patient through each agent and print what it wrote
into the shared case record.

Usage:  python demo.py            (runs P008, the borderline case)
        python demo.py P002       (any case_id from data/patients.json)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from agents import criteria_retrieval_agent, exclusion_checker_agent, evidence_auditor_agent
from evaluation.stub_pipeline import stub_intake, stub_manager
from shared.case_record import new_case, save_case

ROOT = Path(__file__).resolve().parent


def banner(title: str) -> None:
    print("\n" + "=" * 72 + f"\n{title}\n" + "=" * 72)


def main(case_id: str) -> None:
    patients = {p["case_id"]: p for p in json.loads((ROOT / "data" / "patients.json").read_text())}
    p = patients[case_id]
    rec = new_case(case_id, p["raw_summary"])

    banner(f"RAW SUMMARY  ({case_id}, expected: {p['expected_verdict']})")
    print(rec["raw_summary"])

    rec = stub_intake(rec)
    banner("A1 Intake (stub) -> structured")
    print(json.dumps(rec["structured"], indent=2))

    rec = criteria_retrieval_agent.run(rec)
    banner(f"B2 Criteria Retrieval Agent -> {len(rec['retrieved_criteria'])} governing clauses")
    for c in rec["retrieved_criteria"]:
        print(f"  {c['clause_id']:16} {c['type']:10} score={c['score']:.3f}  {c['title']}")

    rec = exclusion_checker_agent.run(rec)
    banner("B4 Exclusion Checker Agent (B3 rule tool, no LLM)")
    for r in rec["exclusion_results"]:
        flag = "TRIGGERED" if r["triggered"] else r["outcome"].upper()
        print(f"  {r['clause_id']:16} {flag:10} {r['reason']}")

    rec = stub_manager(rec)
    banner("A2 Eligibility Manager (stub) -> proposed verdict")
    for r in rec["inclusion_results"]:
        print(f"  {r['clause_id']:16} {r['outcome'].upper():10} {r['reason']}")
    print(f"\n  proposed verdict : {rec['verdict']}")
    print(f"  clause_ids       : {rec['clause_ids']}")

    rec = evidence_auditor_agent.run(rec)
    banner("B5 Evidence Auditor Agent (gate)")
    a = rec["audit_result"]
    print(f"  passed={a['passed']}  checks={a['checks']}  reasons={a['reasons'] or 'none'}")

    banner("FINAL OUTPUT (A6 format)")
    print(json.dumps({k: rec[k] for k in ("case_id", "verdict", "matched_criteria",
                                          "failed_criteria", "clause_ids", "status")}, indent=2))
    path = save_case(rec, ROOT / "data" / "case_store")
    print(f"\nshared record saved -> {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "P008")
