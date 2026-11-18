/* Optional LLM-assisted retrieval (hybrid RAG).
 *
 * Used ONLY when the user switches "LLM mode" on, and only when a NEW patient is added.
 * The LLM does two retrieval jobs:
 *   1. Query expansion — writes extra search queries from the raw patient summary.
 *   2. Re-ranking      — scores every protocol clause 0–1 for relevance, with a short reason.
 * Safety rules:
 *   - The LLM can ADD or RE-RANK clauses, never remove one: the TF-IDF result set is kept.
 *   - Eligibility verdicts stay 100% rule-based (rule tool + decide() + auditor).
 *   - On any error the pipeline falls back to plain TF-IDF retrieval.
 * The API key is stored only in this browser (localStorage) and sent only to the chosen provider.
 */
(function () {
  const KEY = "ctdesk:llm";
  const DEFAULTS = { enabled: false, provider: "gemini", model: "", apiKey: "" };
  const MODELS = { gemini: "gemini-2.5-flash", openai: "gpt-4o-mini", anthropic: "claude-haiku-4-5" };
  const LABELS = { gemini: "Google Gemini", openai: "OpenAI", anthropic: "Anthropic Claude" };

  function load() {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || "{}")); }
    catch (e) { return Object.assign({}, DEFAULTS); }
  }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* storage off */ } }
  const model = (s) => s.model || MODELS[s.provider];

  function buildPrompt(raw, clauses) {
    const list = clauses.map((c) => `${c.clause_id} | ${c.type} | ${c.title} | ${c.text}`).join("\n");
    return `You are the retrieval component of a clinical-trial eligibility system.
Patient summary:
"""${raw}"""

Protocol clauses (id | type | title | text):
${list}

Tasks:
1. Write 3 to 6 short search queries that capture this patient's eligibility-relevant facts (labs, drugs, diagnoses, history), using clinical synonyms where useful.
2. For EVERY clause above, give a relevance score from 0 to 1 for deciding THIS patient's eligibility, and a reason of at most 15 words.
Do NOT decide eligibility. Return ONLY JSON in exactly this shape:
{"queries": ["..."], "clauses": [{"id": "TRIAL01-INC-01", "relevance": 0.9, "reason": "..."}]}`;
  }

  async function call(s, prompt) {
    const m = model(s);
    if (s.provider === "gemini") {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(s.apiKey)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: Object.assign({ temperature: 0, responseMimeType: "application/json" }, /flash/i.test(m) ? { thinkingConfig: { thinkingBudget: 0 } } : {}) })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message || r.status);
      return j.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
    }
    if (s.provider === "openai") {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.apiKey}` },
        body: JSON.stringify({ model: m, temperature: 0, response_format: { type: "json_object" }, messages: [{ role: "user", content: prompt }] })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message || r.status);
      return j.choices?.[0]?.message?.content || "";
    }
    if (s.provider === "anthropic") {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": s.apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model: m, max_tokens: 1500, temperature: 0, messages: [{ role: "user", content: prompt }] })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message || r.status);
      return (j.content || []).map((p) => p.text || "").join("");
    }
    throw new Error("Unknown provider " + s.provider);
  }

  function parse(text, clauses) {
    const m = String(text).match(/\{[\s\S]*\}/);
    if (!m) throw new Error("LLM did not return JSON");
    const j = JSON.parse(m[0]);
    const ids = new Set(clauses.map((c) => c.clause_id));
    const ranking = {};
    (j.clauses || []).forEach((c) => {
      if (!ids.has(c.id)) return; // ignore invented clause IDs
      const rel = Math.max(0, Math.min(1, Number(c.relevance)));
      if (!isNaN(rel)) ranking[c.id] = { relevance: +rel.toFixed(2), reason: String(c.reason || "").slice(0, 140) };
    });
    const queries = (j.queries || []).map(String).filter(Boolean).slice(0, 6);
    if (!queries.length && !Object.keys(ranking).length) throw new Error("LLM response had no queries or rankings");
    return { queries, ranking };
  }

  /** Ask the LLM for query expansion + re-ranking. Returns a plain object stored with the case. */
  async function augment(raw, clauses) {
    const s = load();
    const t0 = performance.now();
    const text = await call(s, buildPrompt(raw, clauses));
    const out = parse(text, clauses);
    return Object.assign(out, { provider: s.provider, providerLabel: LABELS[s.provider], model: model(s), ms: Math.round(performance.now() - t0), at: Date.now() });
  }

  /* ───────── A9 patient guidance (LLM mode, after the verdict) ───────── */
  const DISCLAIMER = "This is an automated, educational summary from a demo system using synthetic data. It is not medical advice — please discuss any decision with your doctor.";
  const SAFE_MED_LINE = "Please don't change or stop any medicine on your own — discuss every medication decision with your doctor.";
  const UNSAFE = /\b(stop|stopping|discontinu\w*|quit|switch(ing)? (off|from)|come off|taper\w*|reduc\w* (your |the )?dose|skip\w*)\b[^.]*\b(insulin|glargine|aspart|semaglutide|liraglutide|dulaglutide|exenatide|metformin|medic\w*|drug|tablet|injection|glp-1)/i;

  function guidancePrompt(facts) {
    const multi = facts.all_trial_results ? `
The patient was screened against ALL of these trials in parallel (see all_trial_results):
TRIAL01 oral add-on for T2DM on metformin; TRIAL02 weight management in T2DM with obesity (BMI 30-45);
TRIAL03 kidney protection (eGFR 25-60); TRIAL04 insulin optimisation (already on insulin);
TRIAL05 type 1 diabetes closed-loop device; TRIAL06 fatty liver (ALT 40-200).
- In "summary", name the trials they ARE eligible for (or in review for) first, warmly.
- "to_become_eligible" is about the closest trial they are NOT yet eligible for; mention the trial ID.
` : "";
    return `You write short, gentle patient-facing notes for a clinical-trial screening desk.
Trial TRIAL01: phase 3 oral add-on therapy for adults with type 2 diabetes on metformin
(needs HbA1c 7.0-9.0%, BMI 25-40, eGFR >= 45, ALT <= 120, age 18-75, no insulin/GLP-1, no type 1 diabetes,
no pregnancy/breastfeeding, no pancreatitis).

Data from this patient's current report and the screening result:
${JSON.stringify(facts, null, 1)}
${multi}
Write JSON only, in exactly this shape:
{"summary": "1-2 warm, plain-language sentences about the result",
 "risks": [{"risk": "probable health risk", "based_on": "the exact report value it comes from"}],
 "immediate_steps": ["concrete next step to discuss with their doctor to avoid health problems"],
 "to_become_eligible": ["what they could work on, with the target value"],
 "cannot_change": ["a reason for ineligibility that cannot be changed, said kindly"]}

Rules:
- Concise and gentle; max 3 risks, 3 immediate steps, 3 eligibility items; each item under 25 words.
- Only use values present in the data; do not invent tests or diagnoses.
- Recommend checks, lifestyle steps and conversations with the doctor; no drug names to start and no doses.
- NEVER suggest stopping, reducing, skipping or switching any medicine to qualify for the trial.
  If a medicine is the reason, say the doctor decides what treatment is best and the trial is not a reason to change it.
- If the verdict is "eligible", "to_become_eligible" and "cannot_change" must be empty lists.
- If the verdict is "review", explain kindly that a coordinator will decide, and list what would make the result clearer.
- Age, type 1 diabetes, pregnancy and a history of pancreatitis go in "cannot_change" (pregnancy: kindly say it is temporary
  and they may be re-screened later), not in "to_become_eligible".`;
  }

  function parseGuidance(text, verdict) {
    const m = String(text).match(/\{[\s\S]*\}/);
    if (!m) throw new Error("LLM did not return JSON");
    const j = JSON.parse(m[0]);
    let fired = false;
    const clean = (arr) => (Array.isArray(arr) ? arr : []).slice(0, 3).map(String).filter((t) => { if (UNSAFE.test(t)) { fired = true; return false; } return true; }).map((t) => t.trim().slice(0, 220));
    const risks = (j.risks || []).slice(0, 3).filter((r) => r && r.risk).map((r) => ({ risk: String(r.risk).slice(0, 200), based_on: String(r.based_on || "").slice(0, 120) }));
    const steps = clean(j.immediate_steps);
    const elig = verdict === "eligible" ? [] : clean(j.to_become_eligible);
    const cant = verdict === "eligible" ? [] : clean(j.cannot_change);
    let summary = String(j.summary || "").trim().slice(0, 400);
    if (UNSAFE.test(summary)) { summary = ""; fired = true; }
    if (fired) steps.push(SAFE_MED_LINE);
    return { summary, risks, immediate_steps: steps, to_become_eligible: elig, cannot_change: cant, safety_filter_applied: fired, disclaimer: DISCLAIMER };
  }

  /** A9: patient guidance from the final record. Never changes the verdict. */
  async function guide(rec, trialResults) {
    const s = load();
    const st = rec.structured || {};
    const clauses = {}; (rec.retrieved_criteria || []).forEach((c) => (clauses[c.clause_id] = c.text || ""));
    const facts = {
      patient: { age: st.age, diagnosis: st.diagnosis, labs: st.labs, medications: st.medications, conditions: st.conditions },
      verdict: rec.verdict,
      clauses_behind_verdict: Object.fromEntries((rec.clause_ids || []).map((id) => [id, clauses[id] || ""])),
      flagged_rules: (rec.inclusion_results || []).concat(rec.exclusion_results || []).filter((r) => r.outcome !== "pass").map((r) => ({ clause_id: r.clause_id, title: r.title, outcome: r.outcome, reason: r.reason }))
    };
    if (trialResults) facts.all_trial_results = trialResults;
    const anyElig = trialResults && Object.values(trialResults).some((t) => t.verdict === "eligible");
    const t0 = performance.now();
    const g = parseGuidance(await call(s, guidancePrompt(facts)), anyElig ? "partly-eligible" : rec.verdict);
    return Object.assign(g, { provider: s.provider, model: model(s), ms: Math.round(performance.now() - t0) });
  }

  window.CT_LLM = {
    load, save, augment, guide, MODELS, LABELS,
    enabled: () => { const s = load(); return !!(s.enabled && s.apiKey); },
    modelOf: (s) => model(s || load())
  };
})();
