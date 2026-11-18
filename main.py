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
  python main.py ask "<question>" → Semantic Kernel AI agent (LLM + function calling):
                                    the LLM calls our agents as kernel plugins and
                                    explains the rule-based verdict. Needs LLM_* env vars.
  python main.py trials P002     → match one patient against ALL 6 trials in parallel
  python main.py add "<summary>"  → add a NEW patient: intake once, then all 6 trials in parallel
  python main.py add "<summary>" --llm
                                  → same, with LLM mode ON (LLM query expansion +
                                    clause re-ranking in retrieval). Needs env vars
                                    LLM_PROVIDER (gemini|openai|anthropic), LLM_API_KEY,
                                    optional LLM_MODEL. Verdicts stay rule-based.
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
from orchestrator   import run_pipeline, extract_output   # A3/A4/A6
from human_loop     import route_to_coordinator            # A7
from evaluate_partA import evaluate                        # A8
from shared.case_record import save_case                   # A5

# ── data paths ────────────────────────────────────────────────────────────
PATIENTS_FILE = PARTB / "data" / "patients.json"
STORE_DIR     = PARTB / "data" / "case_store"


# ══════════════════════════════════════════════════════════════════════════
# Mode 1: Full evaluation (default)
# ══════════════════════════════════════════════════════════════════════════

def run_evaluation() -> None:
    """Run all 10 patients and print a full accuracy report.

    Uses evaluate_partA.evaluate() so both entry points produce the
    identical results_partA.json.
    """
    print(f"\n{'=' * 72}")
    print("  CLINICAL TRIAL ELIGIBILITY MATCHING DESK — Full Evaluation")
    print(f"{'=' * 72}")
    print("  Running all patients through the complete pipeline ...\n")

    summary = evaluate(PATIENTS_FILE)
    rows, n = summary["rows"], summary["cases"]

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
    print(f"  Mean retrieval recall : {summary['mean_retrieval_recall']:.0%}  (governing clauses retrieved)")
    print(f"  Clauses retrieved     : {summary['mean_clauses_retrieved']:.1f} / {summary['total_clauses']} per case")
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
    if rec["status"] != "closed":
        print(f"\nNo decision entered — case {case_id} stays in the review queue.")
        return
    print(f"\n✓ Case {case_id} closed.")
    print(f"  Final verdict   : {rec['verdict']}")
    print(f"  Status          : {rec['status']}")


# ══════════════════════════════════════════════════════════════════════════
# Entry point
# ══════════════════════════════════════════════════════════════════════════

def run_ask(question: str) -> None:
    """Semantic Kernel agent with an AI connector and automatic function calling."""
    from sk_ai import ask, config
    cfg = config()
    print(f"\n  Semantic Kernel agent · {cfg['provider']} · {cfg['model']}")
    print(f"  Q: {question}\n")
    res = ask(question)
    for c in res["tool_calls"]:
        print(f"  [tool call] {c}")
    print(f"\n{res['answer']}\n")


def _print_trials(out: dict, use_llm: bool) -> None:
    """Print the outer fan-out result: one line per trial + optional A9 guidance."""
    from multi_trial import trial_info
    titles = {t["id"]: t["title"] for t in trial_info()}
    print(f"\n{'=' * 72}")
    print(f"  PATIENT {out['case_id']}  |  matched against {len(out['trials'])} trials in parallel"
          f"  |  LLM mode: {'ON' if use_llm else 'OFF'}")
    print(f"{'=' * 72}")
    for tid, rec in out["trials"].items():
        mark = {"eligible": "✓", "review": "?", "ineligible": "✗"}[rec["verdict"]]
        print(f"  {mark} {tid}  {rec['verdict'].upper():10}  {', '.join(c.replace(tid + '-', '') for c in rec['clause_ids'])[:28]:28}  {titles.get(tid, '')}")
    s = out["summary"]
    print(f"\n  Eligible for : {', '.join(s['eligible']) or 'none'}")
    print(f"  In review    : {', '.join(s['review']) or 'none'}  (coordinator decides: python Atharwa/human_loop.py)")
    info = out["trials"]["TRIAL01"].get("llm_retrieval")
    if info:
        print(f"  LLM retrieval: {'FAILED → TF-IDF fallback (' + info['error'] + ')' if info.get('error') else info['provider'] + ' · ' + info['model'] + ' · via ' + info.get('via', '')}")
    g = out.get("patient_guidance")
    if g:
        print("\n  PATIENT GUIDANCE (LLM, A9)")
        if g.get("error"):
            print(f"  (not available: {g['error']})")
        else:
            if g.get("summary"):
                print(f"  {g['summary']}")
            for title, key in (("Probable risks", "risks"), ("Immediate steps", "immediate_steps"),
                               ("To become eligible", "to_become_eligible"), ("Cannot change", "cannot_change")):
                for i, it in enumerate(g.get(key) or []):
                    if i == 0:
                        print(f"  {title}:")
                    print("    • " + (f"{it['risk']} (based on {it['based_on']})" if isinstance(it, dict) else it))
            print(f"  {g['disclaimer']}")
    print()


def run_trials(case_id: str, use_llm: bool = False) -> None:
    """Built-in patient → all trials in parallel (outer fan-out)."""
    from multi_trial import run_all_trials
    patients = {p["case_id"]: p for p in json.loads(PATIENTS_FILE.read_text(encoding="utf-8"))}
    if case_id not in patients:
        print(f"Unknown case_id '{case_id}'. Available: {', '.join(patients)}")
        sys.exit(1)
    _print_trials(run_all_trials(case_id, patients[case_id]["raw_summary"], use_llm=use_llm), use_llm)


def run_add(summary: str, use_llm: bool = False) -> None:
    """Add a NEW patient: intake once, then all trials in parallel (outer fan-out)."""
    import re
    from datetime import datetime
    from multi_trial import run_all_trials
    m = re.search(r"\b(P\d{2,4})\b", summary, re.I)
    case_id = m.group(1).upper() if m else "NEW-" + datetime.now().strftime("%H%M%S")
    out = run_all_trials(case_id, summary, use_llm=use_llm)
    for tid, rec in out["trials"].items():                   # A5: one record per patient × trial
        save_case({**rec, "case_id": f"{case_id}_{tid}"}, STORE_DIR)
    _print_trials(out, use_llm)


def main() -> None:
    args = sys.argv[1:]
    use_llm = "--llm" in args
    args = [a for a in args if a != "--llm"]

    if not args:
        run_evaluation()
    elif args[0] == "demo":
        case_id = args[1] if len(args) > 1 else "P008"
        note    = args[2] if len(args) > 2 else None
        run_demo(case_id, note)
    elif args[0] == "case":
        case_id = args[1] if len(args) > 1 else "P001"
        run_case(case_id)
    elif args[0] == "trials":
        run_trials(args[1] if len(args) > 1 else "P002", use_llm=use_llm)
    elif args[0] == "ask":
        if len(args) < 2:
            print('Usage: python main.py ask "<question>"')
            sys.exit(1)
        run_ask(args[1])
    elif args[0] == "add":
        if len(args) < 2:
            print('Usage: python main.py add "<patient summary>" [--llm]')
            sys.exit(1)
        run_add(args[1], use_llm=use_llm)
    elif args[0] == "loop":
        case_id = args[1] if len(args) > 1 else "P008"
        run_loop(case_id)
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
