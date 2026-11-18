"""The full multi-agent pipeline executed THROUGH Semantic Kernel.

Instead of calling each agent's Python function directly, every step is a
`kernel.invoke(plugin_name=..., function_name=...)` call on the kernel built by
framework_partA.build_full_kernel(). The fan-out runs the two branch plugins
concurrently (each kernel.invoke on its own thread), then fans in through the
manager's `decide` kernel function.

Returns the case record plus a trace of every kernel call, which the website
shows as the "Semantic Kernel trace".

Entry point: run_pipeline_sk(case_id, raw_summary, use_llm=False, llm=None)
"""
from __future__ import annotations

import asyncio
import json
import sys
import time
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_PARTB = _HERE.parent / "CLINICAL TRIAL ELIGIBILITY MATCHING DESK"
for _p in (_HERE, _PARTB):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from semantic_kernel.functions import KernelArguments          # noqa: E402

from framework_partA import build_full_kernel                  # noqa: E402
from human_loop import route_to_coordinator                    # noqa: E402
from shared.case_record import new_case                        # type: ignore  # noqa: E402

_KERNEL = None


def get_kernel():
    global _KERNEL
    if _KERNEL is None:
        _KERNEL = build_full_kernel()
    return _KERNEL


async def _invoke(kernel, plugin: str, function: str, rec: dict, trace: list, step: str, branch: str = "",
                  **extra) -> dict:
    t0 = time.perf_counter()
    result = await kernel.invoke(plugin_name=plugin, function_name=function,
                                 arguments=KernelArguments(case_record_json=json.dumps(rec), **extra))
    ms = round((time.perf_counter() - t0) * 1000, 2)
    args = "".join(f', {k}="{v}"' for k, v in extra.items())
    trace.append({"step": step, "call": f'kernel.invoke("{plugin}", "{function}"{args})',
                  "plugin": plugin, "function": function, "ms": ms, "branch": branch})
    return json.loads(str(result))


def _invoke_in_thread(kernel, plugin, function, rec, trace, step, branch):
    """Run one kernel.invoke on its own event loop so the two fan-out branches run concurrently."""
    return asyncio.run(_invoke(kernel, plugin, function, rec, trace, step, branch))


async def _run(case_id: str, raw: str, use_llm: bool, llm: dict | None) -> dict:
    kernel = get_kernel()
    trace: list[dict] = []
    t_all = time.perf_counter()
    rec = new_case(case_id, raw)                                                    # A5

    rec = await _invoke(kernel, "patient_intake", "run", rec, trace, "A1")           # A1
    rec = await _invoke(kernel, "criteria_retrieval", "run", rec, trace, "B2")      # B2
    if use_llm:                                                                     # optional LLM mode
        import llm_retrieval
        t0 = time.perf_counter()
        rec = await asyncio.to_thread(llm_retrieval.augment_record, rec, **(llm or {}))  # own thread: SK connector runs its own event loop
        trace.append({"step": "B2+", "call": 'llm_retrieval → kernel chat service (AI connector)',
                      "plugin": "llm_retrieval", "function": "run",
                      "ms": round((time.perf_counter() - t0) * 1000, 2), "branch": ""})

    # A3 fan-out: two plugins at the same time, each on its own thread
    exc_task = asyncio.to_thread(_invoke_in_thread, kernel, "exclusion_checker", "run", rec, trace, "A3", "fan-out ‖ 1")
    inc_task = asyncio.to_thread(_invoke_in_thread, kernel, "eligibility_manager", "evaluate_inclusions", rec, trace, "A3", "fan-out ‖ 2")
    exc_rec, inc_rec = await asyncio.gather(exc_task, inc_task)
    rec["exclusion_results"] = exc_rec["exclusion_results"]                          # fan-in merge
    rec["inclusion_results"] = inc_rec["inclusion_results"]
    rec["status"] = "fanout_complete"

    rec = await _invoke(kernel, "eligibility_manager", "decide", rec, trace, "A2")  # A2 fan-in
    proposed = rec["verdict"]
    rec = await _invoke(kernel, "evidence_auditor", "run", rec, trace, "B5")        # A4 gate
    if rec["verdict"] == "review":                                                  # A7
        rec = route_to_coordinator(rec)
    if use_llm:                                                                     # A9 guidance (LLM mode)
        import llm_guidance
        t0 = time.perf_counter()
        rec = await asyncio.to_thread(llm_guidance.add_guidance, rec, **(llm or {}))
        trace.append({"step": "A9", "call": 'llm_guidance → kernel chat service (AI connector)',
                      "plugin": "llm_guidance", "function": "run",
                      "ms": round((time.perf_counter() - t0) * 1000, 2), "branch": ""})
    return {"rec": rec, "proposed": proposed, "trace": trace,
            "total_ms": round((time.perf_counter() - t_all) * 1000, 2)}


def run_pipeline_sk(case_id: str, raw_summary: str, use_llm: bool = False, llm: dict | None = None) -> dict:
    return asyncio.run(_run(case_id, raw_summary, use_llm, llm))


def kernel_info() -> dict:
    k = get_kernel()
    return {plugin: sorted(k.plugins[plugin].functions.keys()) for plugin in sorted(k.plugins.keys())}


# ══════════════════════════════════════════════════════════════════════════
# Two-level fan-out through Semantic Kernel: patient → 6 trials in parallel,
# and inside every trial the B4 ‖ A2 fan-out.
# ══════════════════════════════════════════════════════════════════════════
import copy                                                       # noqa: E402

import multi_trial                                                # noqa: E402


async def _trial_branch(kernel, base: dict, tid: str, hints, trace: list) -> dict:
    rec = copy.deepcopy(base)
    rec = await _invoke(kernel, "trial_matching", "retrieve", rec, trace, "B2", trial_id=tid)
    if hints is not None:
        import llm_retrieval
        rec = llm_retrieval.apply_hints(rec, hints, multi_trial.index_for(tid), trial_prefix=tid)
    exc_task = asyncio.to_thread(_invoke_in_thread, kernel, "exclusion_checker", "run", rec, trace, "A3", "fan-out ‖ 1")
    inc_task = asyncio.to_thread(_invoke_in_thread, kernel, "eligibility_manager", "evaluate_inclusions", rec, trace, "A3", "fan-out ‖ 2")
    exc_rec, inc_rec = await asyncio.gather(exc_task, inc_task)
    rec["exclusion_results"], rec["inclusion_results"] = exc_rec["exclusion_results"], inc_rec["inclusion_results"]
    rec["status"] = "fanout_complete"
    rec = await _invoke(kernel, "eligibility_manager", "decide", rec, trace, "A2")
    rec["proposed_verdict"] = rec["verdict"]
    rec = await _invoke(kernel, "evidence_auditor", "run", rec, trace, "B5")
    if rec["verdict"] == "review":
        rec = route_to_coordinator(rec)
    return rec


def _trial_thread(kernel, base, tid, hints, trace):
    return asyncio.run(_trial_branch(kernel, base, tid, hints, trace))


async def _run_all(case_id: str, raw: str, use_llm: bool, llm: dict | None) -> dict:
    kernel = get_kernel()
    common: list[dict] = []
    t_all = time.perf_counter()
    base = await _invoke(kernel, "patient_intake", "run", new_case(case_id, raw), common, "A1")   # A1 once
    hints = None
    if use_llm:                                                   # ONE LLM call for all trials
        import llm_retrieval
        t0 = time.perf_counter()
        clauses = [c for tid in multi_trial.TRIAL_IDS for c in multi_trial.trial_clauses(tid)]
        hints = await asyncio.to_thread(llm_retrieval.get_hints, raw, clauses, **(llm or {}))
        common.append({"step": "B2+", "call": "llm_retrieval.get_hints → kernel chat service (AI connector), all trials",
                       "plugin": "llm_retrieval", "function": "get_hints",
                       "ms": round((time.perf_counter() - t0) * 1000, 2), "branch": ""})
    traces = {tid: [] for tid in multi_trial.TRIAL_IDS}
    t0 = time.perf_counter()
    recs = await asyncio.gather(*[asyncio.to_thread(_trial_thread, kernel, base, tid, hints, traces[tid])
                                  for tid in multi_trial.TRIAL_IDS])          # OUTER fan-out
    trials = dict(zip(multi_trial.TRIAL_IDS, recs))                           # fan-in
    common.append({"step": "A3", "call": f"outer fan-out → {len(trials)} trial branches in parallel, fan-in summary",
                   "plugin": "orchestrator", "function": "trial_fan_out",
                   "ms": round((time.perf_counter() - t0) * 1000, 2), "branch": "outer"})
    out = {"case_id": case_id, "structured": base["structured"],
           "trials": {tid: {"rec": r, "proposed": r.get("proposed_verdict"), "trace": traces[tid]} for tid, r in trials.items()},
           "summary": multi_trial.summarize(trials), "common_trace": common}
    if use_llm:                                                   # A9 once, across all trials
        import llm_guidance
        t0 = time.perf_counter()
        g = await asyncio.to_thread(llm_guidance.add_guidance, copy.deepcopy(trials["TRIAL01"]), **(llm or {}),
                                    trial_results={t: multi_trial.trial_brief(r) for t, r in trials.items()})
        out["patient_guidance"] = g["patient_guidance"]
        common.append({"step": "A9", "call": "llm_guidance → kernel chat service (AI connector)",
                       "plugin": "llm_guidance", "function": "run",
                       "ms": round((time.perf_counter() - t0) * 1000, 2), "branch": ""})
    out["total_ms"] = round((time.perf_counter() - t_all) * 1000, 2)
    return out


def run_all_trials_sk(case_id: str, raw_summary: str, use_llm: bool = False, llm: dict | None = None) -> dict:
    return asyncio.run(_run_all(case_id, raw_summary, use_llm, llm))
