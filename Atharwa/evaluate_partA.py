"""A8 - Part A Evaluation Script.

Runs all 10 synthetic patients through the REAL Part A pipeline
(A1 Patient Intake + A2 Eligibility Manager + A3/A4 Orchestrator + A7 Human Loop)
instead of the Part B stubs.

Outputs:
  - Console table (same format as evaluation/evaluate.py for comparison)
  - Atharwa/results_partA.json

Usage:
    cd C:\\...\\CA2Agent\\Atharwa
    python evaluate_partA.py
    # or from project root:
    python -m Atharwa.evaluate_partA
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

from orchestrator import run_pipeline          # A3/A4/A6 (saves each case record)

PATIENTS_FILE = _PARTB / "data" / "patients.json"
STORE_DIR     = _PARTB / "data" / "case_store"
RESULTS_FILE  = _HERE  / "results_partA.json"
ALL_CLAUSES   = 13   # 5 inclusion + 8 exclusion in data/protocols


def evaluate(patients_file: Path = PATIENTS_FILE) -> dict:
    """Run every patient and compute the metrics.

    Retrieval recall = share of each case's *governing* clauses
    (expected_clause_ids) that B2 actually retrieved — it measures whether
    retrieval surfaced the clauses that decide the case, not just how many
    clauses came back. `mean_clauses_retrieved` reports volume separately.
    """
    patients = json.loads(patients_file.read_text(encoding="utf-8"))
    rows, n_verdict, n_clause, n_audit, recall, n_retrieved = [], 0, 0, 0, 0.0, 0

    for p in patients:
        rec = run_pipeline(
            p["case_id"],
            p["raw_summary"],
            store_dir=STORE_DIR,
        )
        exp_v = p["expected_verdict"]
        exp_c = set(p["expected_clause_ids"])

        verdict_ok = rec["verdict"] == exp_v
        clause_ok  = exp_c.issubset(set(rec.get("clause_ids") or []))
        audit_ok   = bool((rec.get("audit_result") or {}).get("passed"))

        n_verdict += verdict_ok
        n_clause  += clause_ok
        n_audit   += audit_ok
        retrieved_ids = {c["clause_id"] for c in rec.get("retrieved_criteria") or []}
        case_recall   = len(exp_c & retrieved_ids) / len(exp_c) if exp_c else 1.0
        recall       += case_recall
        n_retrieved  += len(retrieved_ids)

        rows.append({
            "case_id":          p["case_id"],
            "expected":         exp_v,
            "verdict":          rec["verdict"],
            "verdict_correct":  verdict_ok,
            "expected_clauses": sorted(exp_c),
            "cited_clauses":    rec.get("clause_ids") or [],
            "clause_correct":   clause_ok,
            "audit_passed":     audit_ok,
            "retrieval_recall": case_recall,
            "status":           rec.get("status"),
            "note":             p.get("note", ""),
            "coordinator_note": rec.get("coordinator_note") or "",
        })

    n = len(patients)
    summary = {
        "agent":                 "Part A (Atharwa)",
        "cases":                 n,
        "verdict_accuracy":      n_verdict / n,
        "clause_citation_rate":  n_clause  / n,
        "audit_pass_rate":       n_audit   / n,
        "mean_retrieval_recall": recall    / n,
        "mean_clauses_retrieved": n_retrieved / n,
        "total_clauses":         ALL_CLAUSES,
        "rows":                  rows,
    }
    RESULTS_FILE.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return summary


def main() -> None:
    s = evaluate()
    print(f"\n{'=' * 72}")
    print(f"  Part A Evaluation — Atharwa Dewasthali (A1 + A2 + A3/A4 + A7)")
    print(f"{'=' * 72}")
    print(f"{'case':6} {'expected':12} {'verdict':12} {'V':3} {'C':3} {'audit':7} cited")
    print(f"{'-' * 72}")
    for r in s["rows"]:
        v_flag = "✓" if r["verdict_correct"] else "✗"
        c_flag = "✓" if r["clause_correct"]  else "✗"
        a_flag = "pass" if r["audit_passed"] else "FAIL"
        cited  = ", ".join(r["cited_clauses"])
        print(
            f"{r['case_id']:6} {r['expected']:12} {r['verdict']:12} "
            f"{v_flag:3} {c_flag:3} {a_flag:7} {cited}"
        )
    print(f"{'-' * 72}")
    print(f"Verdict accuracy      : {s['verdict_accuracy']:.0%}  ({s['cases']} cases)")
    print(f"Correct clause cited  : {s['clause_citation_rate']:.0%}")
    print(f"Audit pass rate       : {s['audit_pass_rate']:.0%}")
    print(f"Mean retrieval recall : {s['mean_retrieval_recall']:.0%}  (governing clauses retrieved)")
    print(f"Clauses retrieved     : {s['mean_clauses_retrieved']:.1f} / {s['total_clauses']} per case")
    print(f"\nResults written to → {RESULTS_FILE.relative_to(_HERE.parent)}")


if __name__ == "__main__":
    main()
