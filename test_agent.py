"""Run ONE agent on its own, to test it in the terminal.

    python test_agent.py                         -> list agents
    python test_agent.py intake P004             -> A1 on patient P004
    python test_agent.py retrieval P004 TRIAL03  -> B2 for one trial (default TRIAL01)
    python test_agent.py intake "Patient X: 60-year-old with type 2 diabetes. HbA1c 8.1% ..."

Agents: intake (A1) · retrieval (B2) · exclusion (B4) · inclusion (A2 branch)
        manager (A2 decide) · auditor (B5) · trials (A3 outer fan-out, all 6)
Earlier steps the agent depends on are run silently first; only the chosen
agent's INPUT and OUTPUT are printed.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PARTB = ROOT / "CLINICAL TRIAL ELIGIBILITY MATCHING DESK"
for p in (ROOT / "Atharwa", PARTB):
    sys.path.insert(0, str(p))

import multi_trial as mt                                                  # noqa: E402
from agents import evidence_auditor_agent, exclusion_checker_agent        # noqa: E402
from part_a_agents.eligibility_manager_agent import decide, evaluate_inclusions  # noqa: E402
from part_a_agents.patient_intake_agent import run as intake_run         # noqa: E402
from shared.case_record import new_case                                   # noqa: E402

AGENTS = {
    "intake":    "A1 Patient Intake Agent - raw text -> structured patient",
    "retrieval": "B2 Criteria Retrieval Agent (RAG) - finds the trial clauses",
    "exclusion": "B4 Exclusion Checker - runs exclusion clauses through the rule tool",
    "inclusion": "A2 inclusion branch - runs inclusion clauses through the rule tool",
    "manager":   "A2 Eligibility Manager decide() - fan-in, gives the verdict",
    "auditor":   "B5 Evidence Auditor - checks the verdict is backed by evidence",
    "trials":    "A3 outer fan-out - all 6 trials in parallel",
}
ORDER = ["intake", "retrieval", "exclusion", "inclusion", "manager", "auditor"]


def show(title, obj):
    print(f"\n── {title} " + "─" * max(4, 60 - len(title)))
    print(json.dumps(obj, indent=2, ensure_ascii=False) if not isinstance(obj, str) else obj)


def results_view(rows):
    return [f"{r['clause_id']:<16} {r['outcome']:<10} {r.get('reason', '')}" for r in rows]


def load_patient(arg):
    if arg.upper().startswith("P") and len(arg) <= 5:
        pts = json.loads((PARTB / "data" / "patients.json").read_text(encoding="utf-8"))
        for p in pts:
            if p["case_id"].upper() == arg.upper():
                return p["case_id"], p["raw_summary"]
        sys.exit(f"Patient {arg} not in patients.json (P001-P0{len(pts):02d}). Pass free text instead.")
    return "CUSTOM", arg


def main():
    if len(sys.argv) < 3 or sys.argv[1] not in AGENTS:
        print(__doc__)
        for k, v in AGENTS.items():
            print(f"  {k:<10} {v}")
        return
    agent, (cid, raw) = sys.argv[1], load_patient(sys.argv[2])
    tid = (sys.argv[3] if len(sys.argv) > 3 else "TRIAL01").upper()
    if tid not in mt.TRIAL_IDS:
        sys.exit(f"Unknown trial {tid}. Use one of {', '.join(mt.TRIAL_IDS)}")

    if agent == "trials":
        t = time.perf_counter()
        out = mt.run_all_trials(cid, raw)
        show("INPUT raw summary", raw)
        show("OUTPUT per trial", {k: {"verdict": v["verdict"], "clause_ids": v["clause_ids"]}
                                  for k, v in out["trials"].items()})
        show("OUTPUT fan-in summary", out["summary"])
        print(f"\n{AGENTS[agent]}  ({(time.perf_counter() - t) * 1000:.0f} ms)")
        return

    rec = new_case(cid, raw)
    rec["trial_id"] = tid
    for step in ORDER:
        is_target = step == agent
        if is_target:
            print(f"\n{AGENTS[step]}   [{cid} · {tid}]")
        t = time.perf_counter()
        if step == "intake":
            if is_target: show("INPUT raw summary", raw)
            rec = intake_run(rec)
            if is_target: show("OUTPUT structured", rec["structured"])
        elif step == "retrieval":
            if is_target: show("INPUT structured", rec["structured"])
            rec["retrieved_criteria"] = mt.retrieve_trial(rec["structured"], tid)
            if is_target:
                show("OUTPUT retrieved clauses", [f"{c['clause_id']:<16} score {c.get('score', '-')}  q: {c.get('query', '')}"
                                                  for c in rec["retrieved_criteria"]])
        elif step == "exclusion":
            rec["exclusion_results"] = exclusion_checker_agent.check(rec)
            if is_target: show("OUTPUT exclusion results", results_view(rec["exclusion_results"]))
        elif step == "inclusion":
            rec["inclusion_results"] = evaluate_inclusions(rec)
            if is_target: show("OUTPUT inclusion results", results_view(rec["inclusion_results"]))
        elif step == "manager":
            if is_target:
                show("INPUT both branches", results_view(rec["inclusion_results"] + rec["exclusion_results"]))
            rec = decide(rec)
            if is_target: show("OUTPUT", {"verdict": rec["verdict"], "clause_ids": rec["clause_ids"]})
        elif step == "auditor":
            if is_target: show("INPUT verdict", rec["verdict"])
            rec = evidence_auditor_agent.run(rec)
            if is_target: show("OUTPUT audit", {"audit_result": rec.get("audit_result"), "final verdict": rec["verdict"]})
        if is_target:
            print(f"\n({(time.perf_counter() - t) * 1000:.1f} ms)")
            return


if __name__ == "__main__":
    main()
