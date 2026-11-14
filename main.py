"""
╔══════════════════════════════════════════════════════════════════════════╗
║       CLINICAL TRIAL ELIGIBILITY MATCHING DESK                          ║
║       CA2 · Q1 · Group 1 — Full Combined System                         ║
║                                                                          ║
║   Part A (Atharwa Dewasthali)  : Patient Intake, Eligibility Manager,   ║
║                                   Orchestrator, Human-in-the-loop        ║
║   Part B (Partner)             : Criteria Retrieval (RAG), Exclusion    ║
║                                   Checker, Evidence Auditor              ║
╚══════════════════════════════════════════════════════════════════════════╝

Usage
─────
  python main.py                  → evaluate all 10 patients (full report)
  python main.py demo             → step-by-step demo on P008 (borderline)
  python main.py demo P001        → step-by-step demo on any patient
  python main.py case P001        → run + print final verdict for one case
  python main.py loop P008        → interactive human-in-the-loop for P008
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

# ── wire up both Part A and Part B on sys.path ────────────────────────────
ROOT   = Path(__file__).resolve().parent
PARTA  = ROOT / "Atharwa"
PARTB  = ROOT / "CLINICAL TRIAL ELIGIBILITY MATCHING DESK"

for _p in (PARTA, PARTB):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

# ── Part A imports ────────────────────────────────────────────────────────
from orchestrator import run_pipeline, extract_output   # A3/A4/A6
from human_loop   import route_to_coordinator, main as loop_main  # A7
from shared.case_record import save_case                           # A5

# ── data paths ────────────────────────────────────────────────────────────
PATIENTS_FILE = PARTB / "data" / "patients.json"
STORE_DIR     = PARTB / "data" / "case_store"
RESULTS_FILE  = PARTA / "results_partA.json"
ALL_CLAUSES   = 13


# ══════════════════════════════════════════════════════════════════════════
# Mode 1: Full evaluation (default)
# ══════════════════════════════════════════════════════════════════════════

def run_evaluation() -> None:
    """Run all 10 patients and print a full accuracy report."""
    patients = json.loads(PATIENTS_FILE.read_text(encoding="utf-8"))
    rows, n_verdict, n_clause, n_audit, recall = [], 0, 0, 0, 0.0

    print(f"\n{'=' * 72}")
    print("  CLINICAL TRIAL ELIGIBILITY MATCHING DESK — Full Evaluation")
    print(f"{'=' * 72}")
    print(f"  Running {len(patients)} patients through the complete pipeline ...\n")

    for p in patients:
        rec = run_pipeline(p["case_id"], p["raw_summary"], store_dir=STORE_DIR)
        exp_v = p["expected_verdict"]
        exp_c = set(p["expected_clause_ids"])
        verdict_ok = rec["verdict"] == exp_v
        clause_ok  = exp_c.issubset(set(rec.get("clause_ids") or []))
        audit_ok   = bool((rec.get("audit_result") or {}).get("passed"))
        n_verdict += verdict_ok
        n_clause  += clause_ok
        n_audit   += audit_ok
        recall    += len(rec.get("retrieved_criteria") or []) / ALL_CLAUSES
        rows.append({
            "case_id":         p["case_id"],
            "expected":        exp_v,
            "verdict":         rec["verdict"],
            "verdict_correct": verdict_ok,
            "expected_clauses":sorted(exp_c),
            "cited_clauses":   rec.get("clause_ids") or [],
            "clause_correct":  clause_ok,
            "audit_passed":    audit_ok,
            "status":          rec.get("status"),
            "note":            p.get("note", ""),
        })

    n = len(patients)
    summary = {
        "cases": n,
        "verdict_accuracy":      n_verdict / n,
        "clause_citation_rate":  n_clause  / n,
        "audit_pass_rate":       n_audit   / n,
        "mean_retrieval_recall": recall    / n,
        "rows": rows,
    }
    RESULTS_FILE.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    # ── print table ───────────────────────────────────────────────────────
    print(f"{'CASE':6} {'EXPECTED':12} {'VERDICT':12} {'V':3} {'C':3} {'AUDIT':7} CITED CLAUSES")
    print(f"{'─' * 72}")
    for r in rows:
        v = "✓" if r["verdict_correct"] else "✗"
        c = "✓" if r["clause_correct"]  else "✗"
        a = "pass" if r["audit_passed"] else "FAIL"
        cited = ", ".join(r["cited_clauses"])
        print(f"{r['case_id']:6} {r['expected']:12} {r['verdict']:12} {v:3} {c:3} {a:7} {cited}")

    print(f"\n{'─' * 72}")
    print(f"  Verdict accuracy      : {summary['verdict_accuracy']:.0%}  ({n} cases)")
    print(f"  Correct clause cited  : {summary['clause_citation_rate']:.0%}")
    print(f"  Audit pass rate       : {summary['audit_pass_rate']:.0%}")
    print(f"  Mean retrieval recall : {summary['mean_retrieval_recall']:.0%}")
    print(f"\n  Results saved → Atharwa/results_partA.json")
    print(f"  Case records  → CLINICAL TRIAL ELIGIBILITY MATCHING DESK/data/case_store/")


# ══════════════════════════════════════════════════════════════════════════
# Mode 2: Step-by-step demo
# ══════════════════════════════════════════════════════════════════════════

def run_demo(case_id: str = "P008", coordinator_note: str | None = None) -> None:
    """Run the demo script from Part A for one patient."""
    # Delegate to demo_partA.main which has full banner output
    demo_path = PARTA / "demo_partA.py"
    import importlib.util
    spec = importlib.util.spec_from_file_location("demo_partA", demo_path)
    demo = importlib.util.module_from_spec(spec)   # type: ignore[arg-type]
    spec.loader.exec_module(demo)                  # type: ignore[union-attr]
    demo.main(case_id, coordinator_note)


# ══════════════════════════════════════════════════════════════════════════
# Mode 3: Single case quick verdict
# ══════════════════════════════════════════════════════════════════════════

def run_case(case_id: str) -> None:
    """Run one patient and print only the final verdict block."""
    patients = {p["case_id"]: p
                for p in json.loads(PATIENTS_FILE.read_text(encoding="utf-8"))}
    if case_id not in patients:
        print(f"Unknown case_id '{case_id}'. Available: {', '.join(patients)}")
        sys.exit(1)

    p   = patients[case_id]
    rec = run_pipeline(case_id, p["raw_summary"], store_dir=STORE_DIR)
    out = extract_output(rec)

    print(f"\n{'=' * 60}")
    print(f"  CASE {case_id}  |  Expected: {p['expected_verdict'].upper()}")
    print(f"{'=' * 60}")
    print(json.dumps(out, indent=2))

    # Coordinator note if review
    if rec.get("coordinator_note"):
        print(f"\n  Coordinator note: {rec['coordinator_note']}")

    exp_v = p["expected_verdict"]
    match = "✓ CORRECT" if rec["verdict"] == exp_v else f"✗ WRONG (expected {exp_v})"
    print(f"\n  Result: {match}")


# ══════════════════════════════════════════════════════════════════════════
# Mode 4: Interactive human-in-the-loop
# ══════════════════════════════════════════════════════════════════════════

def run_loop(case_id: str) -> None:
    """Interactive coordinator review for a review-queue case."""
    # First run the pipeline to populate the case store
    patients = {p["case_id"]: p
                for p in json.loads(PATIENTS_FILE.read_text(encoding="utf-8"))}
    if case_id not in patients:
        print(f"Unknown case_id '{case_id}'. Available: {', '.join(patients)}")
        sys.exit(1)

    p   = patients[case_id]
    rec = run_pipeline(case_id, p["raw_summary"], store_dir=STORE_DIR)

    if rec.get("verdict") != "review":
        print(f"\nCase {case_id} has verdict='{rec['verdict']}' — not in review queue.")
        print("Only borderline cases (P008, P009, P010) need coordinator review.")
        sys.exit(0)

    # Interactive coordinator session
    rec = route_to_coordinator(rec, interactive=True)
    save_case(rec, STORE_DIR)
    print(f"\n✓ Case {case_id} closed.")
    print(f"  Final verdict   : {rec['verdict']}")
    print(f"  Status          : {rec['status']}")


# ══════════════════════════════════════════════════════════════════════════
# Entry point
# ══════════════════════════════════════════════════════════════════════════

def main() -> None:
    args = sys.argv[1:]

    if not args:
        run_evaluation()
    elif args[0] == "demo":
        case_id = args[1] if len(args) > 1 else "P008"
        note    = args[2] if len(args) > 2 else None
        run_demo(case_id, note)
    elif args[0] == "case":
        case_id = args[1] if len(args) > 1 else "P001"
        run_case(case_id)
    elif args[0] == "loop":
        case_id = args[1] if len(args) > 1 else "P008"
        run_loop(case_id)
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
