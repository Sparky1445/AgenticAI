"""B7 - Evaluation script.

Runs all 10 synthetic patients and reports:
  * verdict accuracy
  * share of verdicts that cite the correct protocol clause(s)
  * retrieval recall of the governing clauses, audit pass rate
Writes evaluation/results.json for the UI (A8) and prints a table.

Usage:  python -m evaluation.evaluate
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from evaluation.stub_pipeline import run_pipeline  # noqa: E402
from shared.case_record import save_case           # noqa: E402

ALL_CLAUSES = 13  # 5 inclusion + 8 exclusion in data/protocols


def evaluate(patients_file: Path = ROOT / "data" / "patients.json") -> dict:
    patients = json.loads(patients_file.read_text(encoding="utf-8"))
    rows, n_verdict, n_clause, n_audit, recall = [], 0, 0, 0, 0.0
    for p in patients:
        rec = run_pipeline(p["case_id"], p["raw_summary"])
        save_case(rec, ROOT / "data" / "case_store")
        exp_v, exp_c = p["expected_verdict"], set(p["expected_clause_ids"])
        verdict_ok = rec["verdict"] == exp_v
        clause_ok = exp_c.issubset(set(rec["clause_ids"]))
        n_verdict += verdict_ok
        n_clause += clause_ok
        n_audit += bool(rec["audit_result"]["passed"])
        # recall of the governing clauses (expected_clause_ids) actually retrieved
        retrieved_ids = {c["clause_id"] for c in rec["retrieved_criteria"]}
        recall += len(exp_c & retrieved_ids) / len(exp_c) if exp_c else 1.0
        rows.append({"case_id": p["case_id"], "expected": exp_v, "verdict": rec["verdict"],
                     "verdict_correct": verdict_ok, "expected_clauses": sorted(exp_c),
                     "cited_clauses": rec["clause_ids"], "clause_correct": clause_ok,
                     "audit_passed": rec["audit_result"]["passed"], "status": rec["status"],
                     "note": p.get("note", "")})
    n = len(patients)
    summary = {"cases": n, "verdict_accuracy": n_verdict / n, "clause_citation_rate": n_clause / n,
               "audit_pass_rate": n_audit / n, "mean_retrieval_recall": recall / n, "rows": rows}
    (ROOT / "evaluation" / "results.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return summary


def main() -> None:
    s = evaluate()
    print(f"{'case':6}{'expected':12}{'verdict':12}{'V':3}{'C':3}{'audit':7}cited")
    for r in s["rows"]:
        print(f"{r['case_id']:6}{r['expected']:12}{r['verdict']:12}"
              f"{'Y' if r['verdict_correct'] else 'N':3}{'Y' if r['clause_correct'] else 'N':3}"
              f"{'pass' if r['audit_passed'] else 'FAIL':7}{', '.join(r['cited_clauses'])}")
    print(f"\nVerdict accuracy      : {s['verdict_accuracy']:.0%}  ({s['cases']} cases)")
    print(f"Correct clause cited  : {s['clause_citation_rate']:.0%}")
    print(f"Audit pass rate       : {s['audit_pass_rate']:.0%}")
    print(f"Mean retrieval recall : {s['mean_retrieval_recall']:.0%}")
    print("Results written to evaluation/results.json")


if __name__ == "__main__":
    main()
