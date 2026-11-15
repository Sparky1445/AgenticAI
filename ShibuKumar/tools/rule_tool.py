"""B3 - Deterministic rule tool. Pure code checks, no LLM judging.

Every rule is a small JSON object stored inside the protocol clause document
(line `Rule-JSON: {...}`), so the check that fires is always traceable to a
retrieved clause.

Outcome vocabulary (same for inclusion and exclusion rules):
    pass       - criterion satisfied for eligibility (exclusion NOT triggered)
    fail       - criterion violated (inclusion not met / exclusion triggered)
    borderline - value sits within `borderline_margin` of the threshold
    unknown    - the required data is missing from the structured record
"""
from __future__ import annotations

import operator
from typing import Any

_OPS = {">": operator.gt, ">=": operator.ge, "<": operator.lt, "<=": operator.le, "==": operator.eq}


def _get_field(structured: dict, dotted: str) -> Any:
    cur: Any = structured
    for part in dotted.split("."):
        if isinstance(cur, dict):
            # case-insensitive key lookup
            key = next((k for k in cur if k.lower() == part.lower()), None)
            cur = cur.get(key) if key is not None else None
        else:
            return None
    return cur


def _to_float(v: Any) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def evaluate_rule(rule: dict, structured: dict) -> dict:
    """Evaluate one rule against the structured patient data.

    Returns {"outcome", "evidence", "reason"}; exclusion semantics are applied
    by the caller using `rule_type` (see `apply`)."""
    check = rule.get("check")

    if check in ("numeric", "range"):
        field = rule["field"]
        val = _to_float(_get_field(structured, field))
        if val is None:
            return {"outcome": "unknown", "evidence": None, "reason": f"{field} not recorded"}
        margin = float(rule.get("borderline_margin", 0))
        if check == "numeric":
            thr = float(rule["value"])
            hit = _OPS[rule["op"]](val, thr)
            if margin and abs(val - thr) <= margin:
                return {"outcome": "borderline", "evidence": val,
                        "reason": f"{field}={val} within {margin} of threshold {rule['op']} {thr}"}
            return {"outcome": "hit" if hit else "miss", "evidence": val,
                    "reason": f"{field}={val} {'satisfies' if hit else 'does not satisfy'} {rule['op']} {thr}"}
        lo, hi = float(rule["min"]), float(rule["max"])
        if margin and (abs(val - lo) <= margin or abs(val - hi) <= margin):
            return {"outcome": "borderline", "evidence": val,
                    "reason": f"{field}={val} within {margin} of range edge [{lo}, {hi}]"}
        hit = lo <= val <= hi
        return {"outcome": "hit" if hit else "miss", "evidence": val,
                "reason": f"{field}={val} {'inside' if hit else 'outside'} [{lo}, {hi}]"}

    if check == "medication_any":
        meds = [str(m).lower() for m in (structured.get("medications") or [])]
        found = [v for v in rule["values"] if any(v.lower() in m for m in meds)]
        return {"outcome": "hit" if found else "miss", "evidence": found or meds,
                "reason": f"medications matched {found}" if found else "no listed medication matched"}

    if check == "text_any":
        raw = _get_field(structured, rule["field"])
        text = " ".join(raw).lower() if isinstance(raw, list) else str(raw or "").lower()
        if not text and rule["field"] != "conditions":
            return {"outcome": "unknown", "evidence": None, "reason": f"{rule['field']} not recorded"}
        found = [v for v in rule["values"] if v.lower() in text]
        return {"outcome": "hit" if found else "miss",
                "evidence": found or (text or f"{rule['field']}: none recorded"),
                "reason": f"text matched {found}" if found else "no match in " + rule["field"]}

    return {"outcome": "unknown", "evidence": None, "reason": f"unsupported check '{check}'"}


def apply(rule: dict, rule_type: str, structured: dict) -> dict:
    """Map raw hit/miss to pass/fail depending on whether the clause is an
    inclusion (hit = pass) or an exclusion (hit = fail/triggered)."""
    r = evaluate_rule(rule, structured)
    out = r["outcome"]
    if out == "hit":
        out = "pass" if rule_type == "inclusion" else "fail"
    elif out == "miss":
        out = "fail" if rule_type == "inclusion" else "pass"
    r["outcome"] = out
    r["triggered"] = (rule_type == "exclusion" and out == "fail")
    return r
