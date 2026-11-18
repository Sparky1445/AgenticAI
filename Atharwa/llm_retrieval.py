"""Optional LLM-assisted retrieval (hybrid RAG) — "LLM mode".

Used ONLY when the user turns LLM mode on (`--llm` flag or `use_llm=True`),
and is meant for NEW patients added at run time.

What the LLM does (retrieval only):
  1. Query expansion — reads the raw patient summary and writes extra search
     queries, which are run against B2's existing TF-IDF vector store.
  2. Re-ranking      — scores every protocol clause 0–1 for relevance to this
     patient, with a short reason.

Safety rules:
  * The LLM can ADD clauses (via its queries) or RE-RANK them; it can never
    remove a clause that TF-IDF retrieved, so recall can only stay the same or improve.
  * Invented clause IDs are ignored.
  * Eligibility is still decided only by the rule tool, decide() and the auditor.
  * Any error (no key, network, bad JSON) → falls back to plain TF-IDF and
    records the error in case_record["llm_retrieval"]["error"].

Configuration (environment variables):
  LLM_PROVIDER   gemini | openai | anthropic | azure | ollama   (default: gemini)
  The call goes through Semantic Kernel's AI connector (sk_ai.py) when
  semantic-kernel is installed, otherwise a direct HTTPS call.
  LLM_API_KEY    your key                        (required)
  LLM_MODEL      optional model override
               defaults: gemini-2.5-flash · gpt-4o-mini · claude-haiku-4-5

Entry point: augment_record(case_record) -> case_record
SK plugin  : LLMRetrievalPlugin.run(case_record_json) -> str
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

_PARTB = Path(__file__).resolve().parent.parent / "CLINICAL TRIAL ELIGIBILITY MATCHING DESK"
if str(_PARTB) not in sys.path:
    sys.path.insert(0, str(_PARTB))

try:
    from framework import kernel_function
except ImportError:
    def kernel_function(*_a, **_k):
        def deco(f): return f
        return deco

DEFAULT_MODELS = {"gemini": "gemini-2.5-flash", "openai": "gpt-4o-mini", "anthropic": "claude-haiku-4-5"}
LLM_WEIGHT = 0.5          # hybrid score = 0.5 * TF-IDF (normalised) + 0.5 * LLM relevance
TIMEOUT_S = 30


# ─────────────────────────── prompt ───────────────────────────────────────

def build_prompt(raw_summary: str, clauses: list[dict]) -> str:
    lines = "\n".join(f"{c['clause_id']} | {c['type']} | {c['title']} | {c['text']}" for c in clauses)
    return f'''You are the retrieval component of a clinical-trial eligibility system.
Patient summary:
"""{raw_summary}"""

Protocol clauses (id | type | title | text):
{lines}

Tasks:
1. Write 3 to 6 short search queries that capture this patient's eligibility-relevant facts (labs, drugs, diagnoses, history), using clinical synonyms where useful.
2. For EVERY clause above, give a relevance score from 0 to 1 for deciding THIS patient's eligibility (put them in "scores").
3. For ONLY the 6 most relevant clauses, add a reason of at most 8 words (put them in "reasons").
Keep the output short: no extra text, no other fields.
Do NOT decide eligibility. Return ONLY JSON in exactly this shape:
{{"queries": ["..."], "scores": {{"TRIAL01-INC-01": 0.9, "TRIAL01-EXC-02": 0.1}}, "reasons": {{"TRIAL01-INC-01": "HbA1c 8.2% within range"}}}}'''


# ─────────────────────────── provider calls (stdlib only) ─────────────────

def _post(url: str, body: dict, headers: dict) -> dict:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", **headers})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:300]
        raise RuntimeError(f"HTTP {e.code}: {detail}") from None


def call_llm(prompt: str, provider: str, api_key: str, model: str) -> str:
    """Preferred path: Semantic Kernel AI connector (sk_ai.py). Fallback: direct HTTPS call."""
    try:
        import sk_ai
        if sk_ai.SK_AVAILABLE:
            call_llm.via = "Semantic Kernel AI connector"
            return sk_ai.complete(prompt, provider, api_key, model)
    except ImportError:
        pass
    call_llm.via = "direct HTTPS (semantic-kernel not installed)"
    return _call_http(prompt, provider, api_key, model)


def _call_http(prompt: str, provider: str, api_key: str, model: str) -> str:
    if provider == "gemini":
        j = _post(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}",
                  {"contents": [{"parts": [{"text": prompt}]}],
                   "generationConfig": {"temperature": 0, "responseMimeType": "application/json",
                                        **({"thinkingConfig": {"thinkingBudget": 0}} if "flash" in model else {})}}, {})
        return "".join(p.get("text", "") for p in j["candidates"][0]["content"]["parts"])
    if provider == "openai":
        j = _post("https://api.openai.com/v1/chat/completions",
                  {"model": model, "temperature": 0, "response_format": {"type": "json_object"},
                   "messages": [{"role": "user", "content": prompt}]},
                  {"Authorization": f"Bearer {api_key}"})
        return j["choices"][0]["message"]["content"]
    if provider == "anthropic":
        j = _post("https://api.anthropic.com/v1/messages",
                  {"model": model, "max_tokens": 1500, "temperature": 0,
                   "messages": [{"role": "user", "content": prompt}]},
                  {"x-api-key": api_key, "anthropic-version": "2023-06-01"})
        return "".join(p.get("text", "") for p in j.get("content", []))
    raise ValueError(f"Unknown LLM_PROVIDER '{provider}' (use gemini, openai or anthropic)")


def parse_response(text: str, valid_ids: set[str]) -> dict:
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ValueError("LLM did not return JSON")
    data = json.loads(m.group(0))
    ranking = {}
    # compact format (fast): {"scores": {id: rel}, "reasons": {id: text}}
    reasons = data.get("reasons") or {}
    for cid, rel in (data.get("scores") or {}).items():
        if cid in valid_ids:
            try:
                ranking[cid] = {"relevance": round(max(0.0, min(1.0, float(rel))), 2), "reason": str(reasons.get(cid, ""))[:140]}
            except (TypeError, ValueError):
                pass
    for c in data.get("clauses") or []:                # older verbose format still accepted
        cid = c.get("id")
        if cid not in valid_ids:                       # ignore invented clause IDs
            continue
        try:
            rel = max(0.0, min(1.0, float(c.get("relevance"))))
        except (TypeError, ValueError):
            continue
        ranking[cid] = {"relevance": round(rel, 2), "reason": str(c.get("reason", ""))[:140]}
    queries = [str(q) for q in (data.get("queries") or []) if str(q).strip()][:6]
    if not queries and not ranking:
        raise ValueError("LLM response had no queries or rankings")
    return {"queries": queries, "ranking": ranking}


# ─────────────────────────── hybrid retrieval ─────────────────────────────

def _all_clauses() -> list[dict]:
    from agents.criteria_retrieval_agent import get_index      # type: ignore[import]
    out = []
    for d in get_index().docs:
        if d.get("clause_id") and d.get("type") in ("inclusion", "exclusion"):
            body = " ".join(l for l in d["text"].splitlines()
                            if l and not l.startswith(("#", "Clause ID", "Type:", "Trial:", "Rule-JSON")))
            out.append({"clause_id": d["clause_id"], "type": d["type"], "title": d["title"],
                        "text": body.strip(), "rule": d["rule"], "source": d["source"]})
    return out


def get_hints(raw_summary: str, clauses: list[dict], provider: str | None = None,
              api_key: str | None = None, model: str | None = None) -> dict:
    """ONE LLM call → search queries + relevance for every clause given (any number of trials)."""
    provider = (provider or os.getenv("LLM_PROVIDER") or "gemini").lower()
    api_key = api_key or os.getenv("LLM_API_KEY") or ""
    model = model or os.getenv("LLM_MODEL") or DEFAULT_MODELS.get(provider, "")
    info = {"enabled": True, "provider": provider, "model": model, "queries": [], "ranking_map": {}, "error": None}
    try:
        if not api_key:
            raise RuntimeError("LLM_API_KEY is not set")
        t0 = time.perf_counter()
        llm = parse_response(call_llm(build_prompt(raw_summary, clauses), provider, api_key, model),
                             {c["clause_id"] for c in clauses})
        info.update(ms=round((time.perf_counter() - t0) * 1000), via=getattr(call_llm, "via", ""),
                    queries=llm["queries"], ranking_map=llm["ranking"])
    except Exception as exc:
        info["error"] = f"{type(exc).__name__}: {exc}"
    return info


def apply_hints(case_record: dict, hints: dict, index=None, trial_prefix: str | None = None) -> dict:
    """Apply LLM hints to one trial's retrieved_criteria: query expansion through that trial's
    vector store + hybrid re-rank. Never removes a clause."""
    info = {k: v for k, v in hints.items() if k != "ranking_map"}
    case_record["llm_retrieval"] = info
    if hints.get("error"):
        case_record["retrieval_mode"] = "tfidf (LLM failed, fallback)"
        return case_record
    if index is None:
        from agents.criteria_retrieval_agent import get_index      # type: ignore[import]
        index = get_index()
    retrieved = {c["clause_id"]: c for c in case_record.get("retrieved_criteria") or []}
    for q in hints["queries"]:                          # 1) query expansion
        for score, payload in index.query(q):
            d = payload["doc"]
            cid = d["clause_id"]
            if not cid or d["type"] not in ("inclusion", "exclusion"):
                continue
            if trial_prefix and not cid.startswith(trial_prefix + "-"):
                continue
            if cid not in retrieved:                    # ADD a clause TF-IDF missed
                retrieved[cid] = {"clause_id": cid, "type": d["type"], "title": d["title"],
                                  "text": payload["chunk"], "rule": d["rule"], "score": round(score, 4),
                                  "source": d["source"], "query": "llm: " + q}
            elif score > retrieved[cid]["score"]:
                retrieved[cid].update(score=round(score, 4), query="llm: " + q)
    ranking = hints.get("ranking_map") or {}
    top = max((c["score"] for c in retrieved.values()), default=1.0) or 1.0
    for cid, c in retrieved.items():                    # 2) hybrid re-rank; nothing removed
        r = ranking.get(cid)
        c["tfidf_norm"] = round(c["score"] / top, 3)
        c["llm_relevance"] = r["relevance"] if r else None
        c["llm_reason"] = r["reason"] if r else ""
        c["hybrid_score"] = round((1 - LLM_WEIGHT) * c["tfidf_norm"] + LLM_WEIGHT * (r["relevance"] if r else 0.0), 3)
    case_record["retrieved_criteria"] = sorted(retrieved.values(), key=lambda c: c["clause_id"])
    info["ranking"] = [{"clause_id": c["clause_id"], "hybrid_score": c["hybrid_score"],
                        "llm_relevance": c["llm_relevance"], "reason": c["llm_reason"]}
                       for c in sorted(retrieved.values(), key=lambda c: -c["hybrid_score"])]
    case_record["retrieval_mode"] = "hybrid (TF-IDF + LLM re-rank)"
    return case_record


def augment_record(case_record: dict, provider: str | None = None,
                   api_key: str | None = None, model: str | None = None) -> dict:
    """Single-trial (TRIAL01) LLM mode: get hints for TRIAL01's clauses, then apply them."""
    hints = get_hints(case_record.get("raw_summary", ""), _all_clauses(), provider, api_key, model)
    return apply_hints(case_record, hints)


class LLMRetrievalPlugin:
    """Semantic Kernel plugin wrapper (optional LLM mode)."""

    @kernel_function(name="run", description="Optional LLM query expansion + clause re-ranking after B2 retrieval")
    def run(self, case_record_json: str) -> str:
        return json.dumps(augment_record(json.loads(case_record_json)))
