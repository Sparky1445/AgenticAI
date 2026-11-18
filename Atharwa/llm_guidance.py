"""A9 - Patient Guidance (optional, LLM mode only).

Runs AFTER the verdict is final (after the auditor gate and A7). Using the
patient's report values, the rule results and the retrieved protocol clauses,
the LLM writes a short, gentle message with:
  1. probable health risks visible in the current report data,
  2. immediate next steps to discuss with a doctor to avoid health issues,
  3. if NOT eligible: what the person could work on to become eligible
     (and, kindly, which reasons cannot change).

Safety rules (enforced in code, not only in the prompt):
  * Never advise stopping, reducing or switching a medicine to qualify for a trial.
    Any such line is replaced with a "discuss medicines only with your doctor" line.
  * No drug doses. Every message ends with a fixed doctor disclaimer.
  * The verdict is NOT changed — this step only explains and guides.
  * Any error → no guidance; the pipeline result is unaffected.

Entry point: add_guidance(case_record, provider=None, api_key=None, model=None) -> case_record
"""
from __future__ import annotations

import json
import re

from llm_retrieval import call_llm, DEFAULT_MODELS   # same Semantic Kernel AI connector path
import os

DISCLAIMER = ("This is an automated, educational summary from a demo system using synthetic data. "
              "It is not medical advice — please discuss any decision with your doctor.")
SAFE_MED_LINE = "Please don't change or stop any medicine on your own — discuss every medication decision with your doctor."
_UNSAFE = re.compile(r"\b(stop|stopping|discontinu\w*|quit|switch(ing)? (off|from)|come off|taper\w*|reduc\w* (your |the )?dose|"
                     r"skip\w*)\b[^.]*\b(insulin|glargine|aspart|semaglutide|liraglutide|dulaglutide|exenatide|metformin|"
                     r"medic\w*|drug|tablet|injection|glp-1)", re.I)


def _facts(rec: dict, trial_results: dict | None = None) -> dict:
    s = rec.get("structured") or {}
    flagged = [{"clause_id": r["clause_id"], "title": r.get("title"), "outcome": r["outcome"], "reason": r["reason"]}
               for r in (rec.get("inclusion_results") or []) + (rec.get("exclusion_results") or [])
               if r.get("outcome") != "pass"]
    clauses = {c["clause_id"]: c.get("text", "") for c in rec.get("retrieved_criteria") or []}
    return {"patient": {"age": s.get("age"), "diagnosis": s.get("diagnosis"), "labs": s.get("labs"),
                        "medications": s.get("medications"), "conditions": s.get("conditions")},
            "verdict": rec.get("verdict"),
            "clauses_behind_verdict": {cid: clauses.get(cid, "") for cid in rec.get("clause_ids") or []},
            "flagged_rules": flagged,
            "llm_search_queries": (rec.get("llm_retrieval") or {}).get("queries", []),
            **({"all_trial_results": trial_results} if trial_results else {})}


def build_prompt(rec: dict, trial_results: dict | None = None) -> str:
    multi = ""
    if trial_results:
        multi = """
The patient was screened against ALL of these trials in parallel (see all_trial_results):
TRIAL01 oral add-on for T2DM on metformin; TRIAL02 weight management in T2DM with obesity (BMI 30-45);
TRIAL03 kidney protection (eGFR 25-60); TRIAL04 insulin optimisation (already on insulin);
TRIAL05 type 1 diabetes closed-loop device; TRIAL06 fatty liver (ALT 40-200).
- In "summary", name the trials they ARE eligible for (or in review for) first, warmly.
- "to_become_eligible" is about the closest trial they are NOT yet eligible for; mention the trial ID.
"""
    return f"""You write short, gentle patient-facing notes for a clinical-trial screening desk.
Trial TRIAL01: phase 3 oral add-on therapy for adults with type 2 diabetes on metformin
(needs HbA1c 7.0-9.0%, BMI 25-40, eGFR >= 45, ALT <= 120, age 18-75, no insulin/GLP-1, no type 1 diabetes,
no pregnancy/breastfeeding, no pancreatitis).

Data from this patient's current report and the screening result:
{json.dumps(_facts(rec, trial_results), indent=1)}
{multi}

Write JSON only, in exactly this shape:
{{"summary": "1-2 warm, plain-language sentences about the result",
  "risks": [{{"risk": "probable health risk", "based_on": "the exact report value it comes from"}}],
  "immediate_steps": ["concrete next step to discuss with their doctor to avoid health problems"],
  "to_become_eligible": ["what they could work on, with the target value"],
  "cannot_change": ["a reason for ineligibility that cannot be changed, said kindly"]}}

Rules:
- Concise and gentle; max 3 risks, 3 immediate steps, 3 eligibility items; each item under 25 words.
- Only use values present in the data; do not invent tests or diagnoses.
- Recommend checks, lifestyle steps and conversations with the doctor; no drug names to start and no doses.
- NEVER suggest stopping, reducing, skipping or switching any medicine to qualify for the trial.
  If a medicine is the reason, say the doctor decides what treatment is best and the trial is not a reason to change it.
- If the verdict is "eligible", "to_become_eligible" and "cannot_change" must be empty lists.
- If the verdict is "review", explain kindly that a coordinator will decide, and list what would make the result clearer.
- Age, type 1 diabetes, pregnancy and a history of pancreatitis go in "cannot_change" (pregnancy: kindly say it is temporary
  and they may be re-screened later), not in "to_become_eligible"."""


def _clean_list(items, limit=3) -> tuple[list, bool]:
    out, replaced = [], False
    for it in (items or [])[:limit]:
        text = it if isinstance(it, str) else json.dumps(it)
        if _UNSAFE.search(text):
            replaced = True
            continue
        out.append(text.strip()[:220])
    return out, replaced


def parse(text: str, verdict: str) -> dict:
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ValueError("LLM did not return JSON")
    j = json.loads(m.group(0))
    risks = []
    for r in (j.get("risks") or [])[:3]:
        if isinstance(r, dict) and r.get("risk"):
            risks.append({"risk": str(r["risk"])[:200], "based_on": str(r.get("based_on", ""))[:120]})
    steps, rep1 = _clean_list(j.get("immediate_steps"))
    elig, rep2 = _clean_list(j.get("to_become_eligible")) if verdict != "eligible" else ([], False)
    cant, rep3 = _clean_list(j.get("cannot_change")) if verdict != "eligible" else ([], False)
    summary = str(j.get("summary", "")).strip()[:400]
    if _UNSAFE.search(summary):
        summary, rep1 = "", True
    if rep1 or rep2 or rep3:                       # safety filter fired → add the safe medication line
        steps.append(SAFE_MED_LINE)
    return {"summary": summary, "risks": risks, "immediate_steps": steps,
            "to_become_eligible": elig, "cannot_change": cant,
            "safety_filter_applied": bool(rep1 or rep2 or rep3), "disclaimer": DISCLAIMER}


def add_guidance(case_record: dict, provider: str | None = None, api_key: str | None = None,
                 model: str | None = None, trial_results: dict | None = None) -> dict:
    """A9: attach case_record['patient_guidance']. Never changes the verdict."""
    provider = (provider or os.getenv("LLM_PROVIDER") or "gemini").lower()
    api_key = api_key or os.getenv("LLM_API_KEY") or ""
    model = model or os.getenv("LLM_MODEL") or DEFAULT_MODELS.get(provider, "")
    try:
        if not api_key:
            raise RuntimeError("LLM_API_KEY is not set")
        verdict = case_record.get("verdict")
        if trial_results and any(t["verdict"] == "eligible" for t in trial_results.values()):
            verdict = "partly-eligible"                 # keep "to become eligible" for the other trials
        g = parse(call_llm(build_prompt(case_record, trial_results), provider, api_key, model), verdict)
        g.update(provider=provider, model=model, via=getattr(call_llm, "via", ""))
    except Exception as exc:
        g = {"error": f"{type(exc).__name__}: {exc}"}
    case_record["patient_guidance"] = g
    return case_record
