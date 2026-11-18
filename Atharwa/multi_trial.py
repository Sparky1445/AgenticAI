"""Outer fan-out: match one patient against ALL trials in parallel.

    A1 Intake (once)
        │
        ├─ fan-out (one thread per trial) ───────────────────────────────┐
        ▼                                                                ▼
    TRIAL01 branch                     …                          TRIAL06 branch
      B2 retrieval over THIS trial's protocol only                (same steps)
      inner fan-out: B4 exclusions ‖ A2 inclusions
      A2 decide() → B5 auditor gate → A7 if review
        │                                                                │
        └─ fan-in: trial-match summary (eligible / review / ineligible) ─┘

TRIAL01 uses the original corpus (data/protocols); TRIAL02–06 live in
data/trials/<TRIAL>/. Each trial gets its own TF-IDF vector store, so a trial's
branch can only ever retrieve and judge that trial's clauses.

Entry points:
    run_all_trials(case_id, raw_summary, use_llm=False, llm=None) -> dict
    run_trial(base_record, trial_id, hints=None) -> case_record
SK plugin: TrialMatchingPlugin (retrieve per trial, list trials)
"""
from __future__ import annotations

import copy
import json
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_PARTB = _HERE.parent / "CLINICAL TRIAL ELIGIBILITY MATCHING DESK"
for _p in (_HERE, _PARTB):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from agents import criteria_retrieval_agent as b2                    # type: ignore[import]
from agents import evidence_auditor_agent, exclusion_checker_agent   # type: ignore[import]
from human_loop import route_to_coordinator
from part_a_agents.eligibility_manager_agent import decide, evaluate_inclusions
from part_a_agents.patient_intake_agent import run as intake_run
from shared.case_record import new_case                              # type: ignore[import]

try:
    from framework import kernel_function                            # type: ignore[import]
except ImportError:                                                  # pragma: no cover
    def kernel_function(*_a, **_k):
        def deco(f): return f
        return deco

PROTOCOLS = _PARTB / "data" / "protocols"
TRIALS_DIR = _PARTB / "data" / "trials"


def _trial_dirs() -> dict[str, Path]:
    dirs = {"TRIAL01": PROTOCOLS}
    if TRIALS_DIR.exists():
        for d in sorted(p for p in TRIALS_DIR.iterdir() if p.is_dir()):
            dirs[d.name] = d
    return dirs


TRIAL_DIRS = _trial_dirs()
TRIAL_IDS = list(TRIAL_DIRS)


def trial_info() -> list[dict]:
    """Title + overview of each trial, read from its OVERVIEW clause file."""
    out = []
    for tid, d in TRIAL_DIRS.items():
        ov = d / f"{tid}-OVERVIEW.md"
        title, text = tid, ""
        if ov.exists():
            lines = ov.read_text(encoding="utf-8").splitlines()
            title = next((l[2:].strip() for l in lines if l.startswith("# ")), tid)
            text = " ".join(l for l in lines if l and not l.startswith(("#", "Clause ID", "Type:", "Trial:")))
        out.append({"id": tid, "title": title.replace("Protocol TRIAL01 overview", "Oral add-on therapy for type 2 diabetes on metformin"),
                    "overview": text})
    return out


# ─────────────────────────── per-trial RAG index ──────────────────────────
_INDEXES: dict[str, "b2.CriteriaIndex"] = {}
_LOCK = threading.Lock()


def index_for(tid: str):
    with _LOCK:
        if tid not in _INDEXES:
            _INDEXES[tid] = b2.CriteriaIndex(TRIAL_DIRS[tid])
        return _INDEXES[tid]


def trial_clauses(tid: str) -> list[dict]:
    out = []
    for d in index_for(tid).docs:
        if d.get("clause_id") and d.get("type") in ("inclusion", "exclusion"):
            body = " ".join(l for l in d["text"].splitlines()
                            if l and not l.startswith(("#", "Clause ID", "Type:", "Trial:", "Rule-JSON")))
            out.append({"clause_id": d["clause_id"], "type": d["type"], "title": d["title"], "text": body.strip()})
    return out


def retrieve_trial(structured: dict, tid: str) -> list[dict]:
    """B2's retrieval (same queries, same scoring) over ONE trial's vector store."""
    index = index_for(tid)
    best: dict[str, dict] = {}
    for q in b2.build_queries(structured):
        for score, payload in index.query(q):
            d = payload["doc"]
            cid = d["clause_id"]
            if not cid or d["type"] not in ("inclusion", "exclusion") or not cid.startswith(tid + "-"):
                continue
            if cid not in best or score > best[cid]["score"]:
                best[cid] = {"clause_id": cid, "type": d["type"], "title": d["title"], "text": payload["chunk"],
                             "rule": d["rule"], "score": round(score, 4), "source": d["source"], "query": q}
    # Coverage guard: RAG ranks and grounds the clauses, but EVERY criterion of the trial must be
    # evaluated. Any clause the queries did not surface is added (score 0) and marked, so a rule
    # can never be silently skipped (e.g. "History: fatty liver" never matches the pregnancy clause).
    for d in index.docs:
        cid = d.get("clause_id")
        if cid and d.get("type") in ("inclusion", "exclusion") and cid.startswith(tid + "-") and cid not in best:
            best[cid] = {"clause_id": cid, "type": d["type"], "title": d["title"], "text": d["text"],
                         "rule": d["rule"], "score": 0.0, "source": d["source"], "query": "coverage guard"}
    return sorted(best.values(), key=lambda c: c["clause_id"])


# ─────────────────────────── one trial branch ─────────────────────────────

def run_trial(base: dict, tid: str, hints: dict | None = None) -> dict:
    """Full inner pipeline for one trial (B2 → inner fan-out → decide → B5 → A7)."""
    rec = copy.deepcopy(base)
    rec["trial_id"] = tid
    rec["retrieved_criteria"] = retrieve_trial(rec["structured"], tid)
    rec["status"] = "criteria_retrieved"
    if hints is not None:
        import llm_retrieval
        rec = llm_retrieval.apply_hints(rec, hints, index_for(tid), trial_prefix=tid)
    with ThreadPoolExecutor(max_workers=2) as pool:                  # inner fan-out
        exc = pool.submit(exclusion_checker_agent.check, rec)
        inc = pool.submit(evaluate_inclusions, rec)
        rec["exclusion_results"], rec["inclusion_results"] = exc.result(), inc.result()
    rec["status"] = "fanout_complete"
    rec = decide(rec)
    rec["proposed_verdict"] = rec["verdict"]
    rec = evidence_auditor_agent.run(rec)                            # A4 gate
    if rec["verdict"] == "review":
        rec = route_to_coordinator(rec)                              # A7 queue
    return rec


def summarize(trials: dict[str, dict]) -> dict:
    s = {"eligible": [], "review": [], "ineligible": []}
    for tid, rec in trials.items():
        s[rec["verdict"]].append(tid)
    return s


def trial_brief(rec: dict) -> dict:
    flagged = [{"clause_id": r["clause_id"], "title": r.get("title"), "outcome": r["outcome"], "reason": r["reason"]}
               for r in rec["inclusion_results"] + rec["exclusion_results"] if r["outcome"] != "pass"]
    return {"verdict": rec["verdict"], "clause_ids": rec["clause_ids"], "flagged": flagged}


# ─────────────────────────── outer fan-out ────────────────────────────────

def run_all_trials(case_id: str, raw_summary: str, use_llm: bool = False, llm: dict | None = None) -> dict:
    base = intake_run(new_case(case_id, raw_summary))                # A1 once
    hints = None
    if use_llm:                                                      # one LLM call for all trials
        import llm_retrieval
        clauses = [c for tid in TRIAL_IDS for c in trial_clauses(tid)]
        hints = llm_retrieval.get_hints(raw_summary, clauses, **(llm or {}))
    with ThreadPoolExecutor(max_workers=len(TRIAL_IDS)) as pool:     # OUTER fan-out
        futures = {tid: pool.submit(run_trial, base, tid, hints) for tid in TRIAL_IDS}
        trials = {tid: f.result() for tid, f in futures.items()}     # fan-in
    out = {"case_id": case_id, "structured": base["structured"], "trials": trials, "summary": summarize(trials)}
    if use_llm:                                                      # A9 once, across all trials
        import llm_guidance
        out["patient_guidance"] = llm_guidance.add_guidance(
            copy.deepcopy(trials["TRIAL01"]), trial_results={t: trial_brief(r) for t, r in trials.items()},
            **(llm or {}))["patient_guidance"]
    return out


class TrialMatchingPlugin:
    """Semantic Kernel plugin for the outer fan-out."""

    @kernel_function(name="retrieve", description="B2 retrieval over ONE trial's protocol (RAG); fills retrieved_criteria")
    def retrieve(self, case_record_json: str, trial_id: str) -> str:
        rec = json.loads(case_record_json)
        rec["trial_id"] = trial_id
        rec["retrieved_criteria"] = retrieve_trial(rec["structured"], trial_id)
        rec["status"] = "criteria_retrieved"
        return json.dumps(rec)

    @kernel_function(name="list_trials", description="List all clinical trials the desk can match patients against")
    def list_trials(self) -> str:
        return json.dumps(trial_info())
