/* JavaScript port of the CA2 agent pipeline so the site runs fully in the browser.
 * Each function mirrors a Python module in the repo:
 *   A1 intake        → Atharwa/part_a_agents/patient_intake_agent.py
 *   B2 retrieval     → agents/criteria_retrieval_agent.py   (TF-IDF cosine, simplified;
 *                      optional LLM query expansion + re-rank via llm.js when LLM mode is on)
 *   B3 rule tool     → tools/rule_tool.py                   (exact port)
 *   B4 exclusions    → agents/exclusion_checker_agent.py
 *   A2 manager       → Atharwa/part_a_agents/eligibility_manager_agent.py (exact port)
 *   B5 auditor       → agents/evidence_auditor_agent.py     (exact port)
 *   A7 human loop    → Atharwa/human_loop.py                (leading-token rule)
 */
(function () {
  const D = window.CT_DATA;

  /* ───────── A1 Patient Intake ───────── */
  const AGE_RE = /(\d{1,3})[- ]year[- ]old/i;
  const DIAG_RE = /with ([^.]+?)\./i;
  const MEDS_RE = /medications?\s*[:=]\s*([^.]+)\./i;
  const HIST_RE = /history\s*[:=]\s*([^.]+)\./i;
  const LAB_RE = {
    hba1c: /hba1c\s+([\d.]+)\s*%?/i,
    bmi: /bmi\s+([\d.]+)/i,
    egfr: /egfr\s+([\d.]+)/i,
    alt: /\balt\s+([\d.]+)/i
  };
  const MED_ALIASES = { insulin: "insulin", glargine: "insulin", aspart: "insulin", lispro: "insulin", "glp-1": "GLP-1 RA", semaglutide: "GLP-1 RA", liraglutide: "GLP-1 RA", dulaglutide: "GLP-1 RA", exenatide: "GLP-1 RA", metformin: "metformin" };

  function intake(raw) {
    const age = raw.match(AGE_RE);
    const dx = raw.match(DIAG_RE);
    const labs = {};
    for (const k in LAB_RE) { const m = raw.match(LAB_RE[k]); if (m && !isNaN(parseFloat(m[1]))) labs[k] = parseFloat(m[1]); }
    const meds = [];
    const mm = raw.match(MEDS_RE);
    if (mm) mm[1].split(",").map((s) => s.trim().replace(/\.$/, "")).forEach((med) => {
      if (!med || med.toLowerCase() === "none") return;
      meds.push(med);
      for (const kw in MED_ALIASES) if (med.toLowerCase().includes(kw) && !meds.includes(MED_ALIASES[kw])) meds.push(MED_ALIASES[kw]);
    });
    let conditions = [];
    const hm = raw.match(HIST_RE);
    if (hm) { const r = hm[1].trim(); if (!["none", "nil", ""].includes(r.toLowerCase())) conditions = r.split(",").map((s) => s.trim()); }
    return { age: age ? parseInt(age[1], 10) : null, diagnosis: dx ? dx[1].trim() : "", labs, medications: meds, conditions };
  }

  /* ───────── B2 Criteria Retrieval (TF-IDF cosine over clause docs) ───────── */
  const tok = (s) => (s.toLowerCase().match(/[a-z0-9.]+/g) || []);
  const trialOf = (cid) => cid.split("-")[0];
  const TRIAL_IDS = (D.trials || [{ id: "TRIAL01" }]).map((t) => t.id);
  // one TF-IDF vector store PER TRIAL, so a trial branch can only retrieve its own clauses
  function buildIndex(clauses) {
    const docs = clauses.map((c) => ({ c, toks: tok(c.title + " " + c.text + " " + c.type) }));
    const df = {};
    docs.forEach((d) => new Set(d.toks).forEach((t) => (df[t] = (df[t] || 0) + 1)));
    const idf = (t) => Math.log((1 + docs.length) / (1 + (df[t] || 0))) + 1;
    const vec = (toks) => { const v = {}; toks.forEach((t) => (v[t] = (v[t] || 0) + idf(t))); return v; };
    docs.forEach((d) => (d.v = vec(d.toks)));
    return { docs, vec };
  }
  const INDEX = {};
  TRIAL_IDS.forEach((tid) => (INDEX[tid] = buildIndex(D.protocols.filter((c) => trialOf(c.clause_id) === tid))));
  const cos = (a, b) => { let d = 0, na = 0, nb = 0; for (const k in a) { na += a[k] * a[k]; if (b[k]) d += a[k] * b[k]; } for (const k in b) nb += b[k] * b[k]; return na && nb ? d / Math.sqrt(na * nb) : 0; };

  function retrieve(s, llm, tid) {
    const { docs: DOCS, vec } = INDEX[tid || "TRIAL01"];
    // one query per patient signal; each clause keeps its best score
    let q = [
      "age " + s.age + " years age limit adult older",
      "diagnosis " + s.diagnosis + " type diabetes",
      "hba1c glycated haemoglobin percent " + (s.labs.hba1c ?? ""),
      "bmi body mass index " + (s.labs.bmi ?? ""),
      "egfr glomerular filtration renal " + (s.labs.egfr ?? ""),
      "alt alanine aminotransferase liver " + (s.labs.alt ?? ""),
      "medication " + s.medications.join(" ") + " insulin metformin glp-1",
      "history conditions " + (s.conditions.join(" ") || "none") + " pregnancy pancreatitis"
    ];
    // Optional LLM mode: the LLM's queries are ADDED to the TF-IDF queries (query expansion)
    if (llm && llm.queries) q = q.concat(llm.queries.map((x) => "llm: " + x));
    const out = DOCS.map((d) => {
      let best = 0, bq = "";
      q.forEach((qq) => { const sc = cos(vec(tok(qq.replace(/^llm: /, ""))), d.v); if (sc > best) { best = sc; bq = qq; } });
      return Object.assign({}, d.c, { score: +best.toFixed(4), query: bq });
    });
    if (!llm || !llm.ranking) return out.sort((a, b) => b.score - a.score);
    // Hybrid re-rank: 50% TF-IDF (normalised) + 50% LLM relevance. No clause is ever dropped.
    const max = Math.max(...out.map((c) => c.score)) || 1;
    out.forEach((c) => {
      const r = llm.ranking[c.clause_id];
      c.tfidf_norm = +(c.score / max).toFixed(3);
      c.llm_relevance = r ? r.relevance : null;
      c.llm_reason = r ? r.reason : "";
      c.hybrid_score = +(0.5 * c.tfidf_norm + 0.5 * (r ? r.relevance : 0)).toFixed(3); // unscored by LLM → 0 relevance (still kept)
    });
    return out.sort((a, b) => b.hybrid_score - a.hybrid_score);
  }

  /* ───────── B3 Rule tool (exact port) ───────── */
  function getField(st, dotted) {
    let cur = st;
    for (const part of dotted.split(".")) {
      if (cur && typeof cur === "object" && !Array.isArray(cur)) {
        const key = Object.keys(cur).find((k) => k.toLowerCase() === part.toLowerCase());
        cur = key !== undefined ? cur[key] : null;
      } else return null;
    }
    return cur;
  }
  const OPS = { ">": (a, b) => a > b, ">=": (a, b) => a >= b, "<": (a, b) => a < b, "<=": (a, b) => a <= b, "==": (a, b) => a === b };
  const fmtN = (n) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

  function evaluateRule(rule, st) {
    const c = rule.check;
    if (c === "numeric" || c === "range") {
      const raw = getField(st, rule.field);
      const val = raw == null || raw === "" || isNaN(parseFloat(raw)) ? null : parseFloat(raw);
      if (val === null) return { outcome: "unknown", evidence: null, reason: rule.field + " not recorded" };
      const m = parseFloat(rule.borderline_margin || 0);
      if (c === "numeric") {
        const thr = parseFloat(rule.value);
        const hit = OPS[rule.op](val, thr);
        if (m && Math.abs(val - thr) <= m + 1e-9) return { outcome: "borderline", evidence: val, reason: `${rule.field}=${fmtN(val)} within ${m} of threshold ${rule.op} ${fmtN(thr)}` };
        return { outcome: hit ? "hit" : "miss", evidence: val, reason: `${rule.field}=${fmtN(val)} ${hit ? "satisfies" : "does not satisfy"} ${rule.op} ${fmtN(thr)}` };
      }
      const lo = rule.min, hi = rule.max;
      if (m && (Math.abs(val - lo) <= m + 1e-9 || Math.abs(val - hi) <= m + 1e-9)) return { outcome: "borderline", evidence: val, reason: `${rule.field}=${fmtN(val)} within ${m} of range edge [${fmtN(lo)}, ${fmtN(hi)}]` };
      const hit = val >= lo && val <= hi;
      return { outcome: hit ? "hit" : "miss", evidence: val, reason: `${rule.field}=${fmtN(val)} ${hit ? "inside" : "outside"} [${fmtN(lo)}, ${fmtN(hi)}]` };
    }
    if (c === "medication_any") {
      const meds = (st.medications || []).map((x) => String(x).toLowerCase());
      const found = rule.values.filter((v) => meds.some((mm) => mm.includes(v.toLowerCase())));
      return { outcome: found.length ? "hit" : "miss", evidence: found.length ? found : meds, reason: found.length ? `medications matched [${found.join(", ")}]` : "no listed medication matched" };
    }
    if (c === "text_any") {
      const raw = getField(st, rule.field);
      const text = Array.isArray(raw) ? raw.join(" ").toLowerCase() : String(raw || "").toLowerCase();
      if (!text && rule.field !== "conditions") return { outcome: "unknown", evidence: null, reason: rule.field + " not recorded" };
      const found = rule.values.filter((v) => text.includes(v.toLowerCase()));
      return { outcome: found.length ? "hit" : "miss", evidence: found.length ? found : text || rule.field + ": none recorded", reason: found.length ? `text matched [${found.join(", ")}]` : "no match in " + rule.field };
    }
    return { outcome: "unknown", evidence: null, reason: `unsupported check '${c}'` };
  }
  function apply(rule, type, st) {
    const r = evaluateRule(rule, st);
    if (r.outcome === "hit") r.outcome = type === "inclusion" ? "pass" : "fail";
    else if (r.outcome === "miss") r.outcome = type === "inclusion" ? "fail" : "pass";
    r.triggered = type === "exclusion" && r.outcome === "fail";
    return r;
  }

  /* ───────── B4 Exclusion checker / A2 inclusion branch ───────── */
  const branch = (rec, type) => rec.retrieved_criteria.slice().sort((a, b) => a.clause_id.localeCompare(b.clause_id)).filter((c) => c.type === type && c.rule).map((c) => {
    const r = apply(c.rule, type, rec.structured);
    return { clause_id: c.clause_id, title: c.title, outcome: r.outcome, triggered: r.triggered, evidence: r.evidence, reason: r.reason, tool: "rule_tool.apply" };
  });

  /* ───────── A2 decide() (exact port) ───────── */
  function decide(rec) {
    const inc = rec.inclusion_results, exc = rec.exclusion_results;
    const triggered = exc.filter((r) => r.triggered).map((r) => r.clause_id);
    const unmet = inc.filter((r) => r.outcome === "fail").map((r) => r.clause_id);
    const unsure = inc.concat(exc).filter((r) => r.outcome === "borderline" || r.outcome === "unknown").map((r) => r.clause_id);
    const matched = inc.filter((r) => r.outcome === "pass").map((r) => r.clause_id);
    rec.matched_criteria = matched;
    rec.failed_criteria = triggered.concat(unmet);
    if (triggered.length || unmet.length) { rec.verdict = "ineligible"; rec.clause_ids = triggered.concat(unmet); }
    else if (unsure.length) { rec.verdict = "review"; rec.clause_ids = unsure; }
    else { rec.verdict = "eligible"; rec.clause_ids = matched; }
    rec.status = "verdict_proposed";
    return { triggered, unmet, unsure, matched };
  }

  /* ───────── B5 Evidence auditor (exact port) ───────── */
  function audit(rec) {
    const retrieved = {}; rec.retrieved_criteria.forEach((c) => (retrieved[c.clause_id] = c));
    const reasons = []; let checked = 0;
    ["inclusion_results", "exclusion_results"].forEach((b) => rec[b].forEach((r) => {
      checked++;
      if (!retrieved[r.clause_id]) reasons.push(`${b}: ${r.clause_id} was not among retrieved criteria`);
      if (["pass", "fail", "borderline"].includes(r.outcome) && (r.evidence == null || r.evidence === "")) reasons.push(`${b}: ${r.clause_id} outcome '${r.outcome}' has no evidence value`);
      if (!["pass", "fail", "borderline", "unknown"].includes(r.outcome)) reasons.push(`${b}: ${r.clause_id} has invalid outcome '${r.outcome}'`);
    }));
    const ids = new Set(rec.inclusion_results.concat(rec.exclusion_results).map((r) => r.clause_id));
    rec.clause_ids.forEach((cid) => { checked++; if (!retrieved[cid]) reasons.push(`verdict cites ${cid}, which was never retrieved`); else if (!ids.has(cid)) reasons.push(`verdict cites ${cid}, but no rule result exists for it`); });
    const exc = rec.exclusion_results, inc = rec.inclusion_results;
    const triggered = exc.filter((r) => r.triggered), unmet = inc.filter((r) => r.outcome === "fail");
    const unsure = inc.concat(exc).filter((r) => r.outcome === "borderline" || r.outcome === "unknown");
    const v = rec.verdict;
    if (!["eligible", "ineligible", "review"].includes(v)) reasons.push(`invalid verdict '${v}'`);
    if (v === "eligible" && (triggered.length || unmet.length || unsure.length)) reasons.push("verdict 'eligible' contradicts results");
    if (v === "ineligible" && !(triggered.length || unmet.length)) reasons.push("verdict 'ineligible' but no exclusion triggered and no inclusion unmet");
    if ((v === "eligible" || v === "ineligible") && !rec.clause_ids.length) reasons.push("verdict released without any supporting clause IDs");
    if (!rec.retrieved_criteria.length) reasons.push("no criteria were retrieved; nothing can be grounded");
    rec.audit_result = { passed: !reasons.length, checks: checked, reasons, auditor: "evidence_auditor_agent" };
    if (rec.audit_result.passed) rec.status = "audit_passed";
    else { rec.verdict = "review"; rec.status = "review_queue"; rec.coordinator_note = (rec.coordinator_note || "") + "[auditor] " + reasons.join("; "); }
    return rec.audit_result;
  }

  /* ───────── A7 human loop: leading decision token ───────── */
  function parseToken(note) {
    const m = String(note || "").trim().replace(/^\[/, "").toUpperCase().match(/^(CONFIRM REVIEW|INELIGIBLE|ELIGIBLE)\b/);
    return m ? m[1] : null;
  }
  function applyCoordinatorNote(rec, note) {
    const t = parseToken(note);
    if (!t) return { ok: false, error: "Note must start with ELIGIBLE, INELIGIBLE or CONFIRM REVIEW." };
    rec.coordinator_note = note.trim();
    rec.verdict = t === "ELIGIBLE" ? "eligible" : t === "INELIGIBLE" ? "ineligible" : "review";
    rec.status = "closed";
    return { ok: true, token: t };
  }

  /* ───────── A3/A4/A6 orchestrator: returns the record + per-stage snapshots ───────── */
  function runPipeline(caseId, raw, llm, tid) {
    tid = tid || "TRIAL01";
    const rec = { case_id: caseId, raw_summary: raw, structured: null, retrieved_criteria: [], inclusion_results: [], exclusion_results: [], audit_result: null, verdict: null, matched_criteria: [], failed_criteria: [], clause_ids: [], status: "new", coordinator_note: "" };
    const t0 = performance.now();
    const timing = {};
    const tm = (k, fn) => { const s = performance.now(); const r = fn(); timing[k] = +(performance.now() - s).toFixed(2); return r; };
    tm("A1", () => { rec.structured = intake(raw); rec.status = "intake_done"; });
    tm("B2", () => { rec.trial_id = tid; rec.retrieved_criteria = retrieve(rec.structured, llm, tid); rec.retrieval_mode = llm ? "hybrid (TF-IDF + LLM re-rank)" : "TF-IDF"; rec.status = "criteria_retrieved"; });
    tm("FAN", () => { rec.exclusion_results = branch(rec, "exclusion"); rec.inclusion_results = branch(rec, "inclusion"); });
    const parts = tm("A2", () => decide(rec));
    const proposed = rec.verdict;
    tm("B5", () => audit(rec));
    if (rec.verdict === "review") rec.status = "review_queue";
    timing.total = +(performance.now() - t0).toFixed(2);
    return { rec, parts, proposed, timing };
  }

  /* ───────── outer fan-out: intake once, then every trial branch (each with its own inner fan-out) ───────── */
  function runAllTrials(caseId, raw, llm) {
    const t0 = performance.now();
    const trials = {};
    TRIAL_IDS.forEach((tid) => (trials[tid] = runPipeline(caseId, raw, llm, tid)));   // independent branches
    const summary = { eligible: [], review: [], ineligible: [] };
    TRIAL_IDS.forEach((tid) => summary[trials[tid].rec.verdict].push(tid));
    return { case_id: caseId, structured: trials.TRIAL01.rec.structured, trials, summary, total_ms: +(performance.now() - t0).toFixed(2) };
  }

  window.CT_AGENTS = { intake, retrieve, apply, decide, audit, runPipeline, runAllTrials, parseToken, applyCoordinatorNote, TRIAL_IDS };
})();
