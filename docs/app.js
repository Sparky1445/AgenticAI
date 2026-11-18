/* UI layer: hash router + views. All agent logic lives in agents.js. */
(function () {
  const D = window.CT_DATA, A = window.CT_AGENTS, L = window.CT_LLM;
  const $app = document.getElementById("app");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const short = (id) => id.replace("TRIAL01-", "");

  /* ───────── persistence (per browser, optional) ───────── */
  const store = {
    get(k, d) { try { const v = localStorage.getItem("ctdesk:" + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("ctdesk:" + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
  };

  /* ───────── state ───────── */
  const S = {
    cases: D.patients.map((p) => ({ id: p.case_id, raw: p.raw_summary, expected: p.expected_verdict, expected_ids: p.expected_clause_ids, note: p.note })),
    custom: store.get("custom", []),
    sel: "P008",
    trial: "TRIAL01",
    step: 6,
    timer: null,
    speed: 700,
    closed: store.get("closed", {}), // case_id -> {verdict, note, at}
    reviewSel: null,
    token: "ELIGIBLE",
    draft: {}
  };
  // give duplicate custom IDs a suffix (e.g. two "P011" → P011, P011-2) so each can be picked / deleted
  (() => { const seen = new Set(S.cases.map((x) => x.id)); let changed = false;
    S.custom.forEach((x) => { let id = x.id, n = 2; while (seen.has(id)) { id = x.id + "-" + n++; changed = true; } x.id = id; seen.add(id); });
    if (changed) store.set("custom", S.custom); })();
  const allCases = () => S.cases.concat(S.custom);
  const cache = {};
  /* ───────── Python + Semantic Kernel backend (server.py), when running ───────── */
  const API = { on: false, info: null, results: {} };
  const keyOf = (c) => c.id + "|" + c.raw + "|" + (c.llm ? c.llm.at : "");
  function partsOf(rec) {
    const inc = rec.inclusion_results, exc = rec.exclusion_results;
    return {
      triggered: exc.filter((r) => r.triggered).map((r) => r.clause_id),
      unmet: inc.filter((r) => r.outcome === "fail").map((r) => r.clause_id),
      unsure: inc.concat(exc).filter((r) => r.outcome === "borderline" || r.outcome === "unknown").map((r) => r.clause_id),
      matched: inc.filter((r) => r.outcome === "pass").map((r) => r.clause_id)
    };
  }
  /* server answer (all trials) → the same shape as A.runAllTrials() */
  function fromServer(out) {
    const common = out.common_trace || [];
    const a1 = common.find((t) => t.step === "A1");
    const outer = common.filter((t) => t.step !== "A1");
    const trials = {};
    Object.entries(out.trials).forEach(([tid, t]) => {
      trials[tid] = { rec: t.rec, parts: partsOf(t.rec), proposed: t.proposed, engine: "sk",
        timing: { A1: a1 ? a1.ms : 0, total: out.total_ms },
        trace: (a1 ? [a1] : []).concat(outer.filter((x) => x.step !== "A9"), t.trace, outer.filter((x) => x.step === "A9")) };
    });
    return { case_id: out.case_id, structured: out.structured, trials, summary: out.summary, total_ms: out.total_ms, engine: "sk", guidance: out.patient_guidance };
  }
  async function serverRun(c, useLLM) {
    const r = await fetch("api/run", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ case_id: c.id, raw: c.raw, use_llm: !!useLLM, llm: useLLM ? L.load() : null }) });
    const out = await r.json();
    if (!r.ok) throw new Error(out.error || r.status);
    return out;
  }
  function llmFromServer(rec, guidance) {
    const i = rec.llm_retrieval;
    if (!i) return guidance ? { guidance } : {};
    if (i.error) return { llmError: "LLM call failed: " + i.error, guidance };
    const ranking = {};
    (i.ranking || []).forEach((x) => { if (x.llm_relevance != null) ranking[x.clause_id] = { relevance: x.llm_relevance, reason: x.reason }; });
    return { llm: { queries: i.queries, ranking, provider: i.provider, providerLabel: L.LABELS[i.provider] || i.provider, model: i.model, ms: i.ms, via: i.via, at: Date.now() }, guidance };
  }
  async function initBackend() {
    if (!/^https?:/.test(location.protocol)) return;
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 1500);
      const r = await fetch("api/health", { signal: ctl.signal }); clearTimeout(t);
      const info = await r.json();
      if (!r.ok || !info.semantic_kernel) { API.info = info; paintEngine(); return; }
      API.info = info; API.on = true; paintEngine();
      await Promise.all(allCases().filter((c) => !c.llm).map(async (c) => { API.results[keyOf(c)] = fromServer(await serverRun(c, false)); }));
      route();
    } catch (e) { paintEngine(); }
  }
  function paintEngine() {
    const el = document.getElementById("engine");
    if (!el) return;
    el.classList.toggle("sk", API.on);
    el.innerHTML = API.on ? `<span class="dot" aria-hidden="true"></span>Python · Semantic Kernel v${esc(API.info.sk_version)}` : `<span class="dot" aria-hidden="true"></span>In-browser JS engine`;
    el.title = API.on ? "Agents run in Python through kernel.invoke() (server.py)" : (API.info && API.info.error ? "server.py is running but Semantic Kernel is missing: " + API.info.error : "Start python server.py to run the real Python agents through Semantic Kernel");
  }
  /* multi(c): intake once → all trials (outer fan-out). result(c, tid): one trial branch. */
  const multi = (c) => (API.on && API.results[keyOf(c)]) || (cache[keyOf(c)] ||= A.runAllTrials(c.id, c.raw, c.llm));
  const result = (c, tid) => multi(c).trials[tid || S.trial];
  const TRIALS = D.trials || [{ id: "TRIAL01", short: "TRIAL01", title: "TRIAL01" }];
  const TINFO = Object.fromEntries(TRIALS.map((t) => [t.id, t]));
  const ck = (c, tid) => (tid === "TRIAL01" ? c.id : c.id + "|" + tid);       // closed-review key (keeps old TRIAL01 keys)
  const closedOf = (c, tid) => S.closed[ck(c, tid || S.trial)];
  const finalVerdict = (c, tid) => { tid = tid || S.trial; const cl = closedOf(c, tid); return cl ? cl.verdict : result(c, tid).rec.verdict; };

  /* ───────── router ───────── */
  const routes = { pipeline: renderPipeline, review: renderReview, evaluation: renderEvaluation, agent: renderAgent, about: renderAbout };
  function route() {
    const r = (location.hash.replace(/^#\/?/, "") || "pipeline").split("/")[0];
    const fn = routes[r] || renderPipeline;
    stopTimer();
    document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.route === (routes[r] ? r : "pipeline")));
    if (r !== "pipeline") S.step = 6;
    fn();
    updateBadge();
    $app.focus({ preventScroll: true });
  }
  window.addEventListener("hashchange", () => { route(); window.scrollTo(0, 0); });

  function updateBadge() {
    let n = 0;
    allCases().forEach((c) => TRIALS.forEach((t) => { if (result(c, t.id).rec.verdict === "review" && !closedOf(c, t.id)) n++; }));
    const b = document.getElementById("reviewCount");
    b.textContent = n; b.classList.toggle("zero", n === 0);
  }

  /* ════════════════════ PIPELINE VIEW ════════════════════ */
  function stopTimer() { if (S.timer) { clearInterval(S.timer); S.timer = null; } }

  function renderPipeline() {
    const c = allCases().find((x) => x.id === S.sel) || allCases()[0];
    S.sel = c.id;
    const M = multi(c);
    const res = result(c);
    const { rec, parts, proposed, timing } = res;
    const step = S.step;
    const isReview = proposed === "review" || rec.verdict === "review";
    const closed = closedOf(c);
    const tInfo = TINFO[S.trial] || { short: S.trial, title: S.trial };

    const queue = allCases().map((x) => {
      const r = result(x).rec, v = finalVerdict(x);
      const nElig = TRIALS.filter((t) => finalVerdict(x, t.id) === "eligible").length;
      const sub = r.structured.age != null ? `${r.structured.age} y · HbA1c ${r.structured.labs.hba1c ?? "?"}${r.structured.labs.egfr == null ? " · eGFR ?" : ""}` : "unparsed";
      const del = S.custom.includes(x) ? `<button class="qdel" data-del="${esc(x.id)}" title="Delete ${esc(x.id)}" aria-label="Delete patient ${esc(x.id)}">×</button>` : "";
      return `<div class="qrow"><button class="qitem" data-pick="${esc(x.id)}" aria-current="${x.id === c.id}">
        <span><span class="qid">${esc(x.id)}</span><br><span class="qsub">${esc(sub)}</span><br><span class="qsub" style="color:${nElig ? "var(--teal-dark)" : "var(--muted)"};font-weight:600">${nElig ? `eligible for ${nElig} of ${TRIALS.length} trials` : `no trial match`}</span></span>
        <span class="chip ${v}" title="${esc(S.trial)}">${closedOf(x) ? "✓ " : ""}${v}</span></button>${del}</div>`;
    }).join("");

    // OUTER fan-out view: one tile per trial
    const tiles = TRIALS.map((t) => {
      const v = finalVerdict(c, t.id), r = result(c, t.id).rec, cl = closedOf(c, t.id);
      return `<button class="ttile ${v}" data-trial="${t.id}" aria-pressed="${t.id === S.trial}">
        <span class="ttop"><span class="mono" style="font-weight:600">${t.id}</span><span class="chip ${v}">${cl ? "✓ " : ""}${v}</span></span>
        <span class="tname">${esc(t.short)}</span>
        <span class="hint">${step >= 4 || t.id !== S.trial ? esc(r.clause_ids.map((x) => x.replace(t.id + "-", "")).join(", ")) : "…"}</span>
      </button>`;
    }).join("");
    const sm = { eligible: [], review: [], ineligible: [] };
    TRIALS.forEach((t) => sm[finalVerdict(c, t.id)].push(t.id));

    const st = rec.structured;
    const nLabs = Object.keys(st.labs).length;
    const tClauses = D.protocols.filter((p) => p.clause_id.startsWith(S.trial + "-")).length;
    const ex = rec.exclusion_results, inc = rec.inclusion_results;
    const excSoft = ex.filter((r) => r.outcome === "borderline" || r.outcome === "unknown").length;
    const node = (k, part, tag, name, out, skip, wait) => {
      let s = step > k || (k === 6 && step >= 6 && !S.timer) ? "done" : step === k ? "active" : "pending"; // last step finishes the run
      if (skip) s = step >= k ? "skipped" : "pending";
      const lab = { pending: "Waiting", active: "Running…", done: "Done ✓", skipped: "Skipped" }[s];
      const o = step >= k && !skip ? out : wait || "Awaiting upstream output";
      return `<div class="node part${part} ${s}"><div class="top"><span class="tag">${tag}</span><span class="state">${lab}</span></div><span class="name">${name}</span><span class="out">${esc(o)}</span></div>`;
    };
    const lit = (k, part) => (step > k ? "lit-" + part : "");
    const verdictNow = closed ? closed.verdict : rec.verdict;

    const T = [
      ["d", `$ run_pipeline("${c.id}")`],
      ["a", `[A1] intake → age=${st.age}, dx="${st.diagnosis}", ${nLabs} labs, ${st.medications.length} meds  (${timing.A1} ms)\n[A3] OUTER fan-out ⇉ ${TRIALS.length} trial branches in parallel (${TRIALS.map((t) => t.id.slice(-2)).join(" ‖ ")}) · showing ${S.trial}`],
      ["b", c.llm ? `[B2] hybrid retrieve → ${rec.retrieved_criteria.length} clauses · +${c.llm.queries.length} LLM queries · re-ranked by ${c.llm.model} (${c.llm.ms} ms) · top: ${short(rec.retrieved_criteria[0].clause_id)}` : `[B2] retrieve → ${rec.retrieved_criteria.length} clauses, top: ${short(rec.retrieved_criteria[0].clause_id)} (${rec.retrieved_criteria[0].score})${c.llmError ? " · LLM failed, TF-IDF fallback" : ""}`],
      ["a", `[A3] inner fan-out ⇉ B4: ${parts.triggered.length} triggered, ${excSoft} unsure ‖ A2: ${inc.filter((r) => r.outcome === "pass").length}/${inc.length} pass`],
      ["a", `[A2] fan-in decide() → proposal: ${proposed} [${rec.clause_ids.map(short).join(", ")}]`],
      [rec.audit_result.passed ? "b" : "w", `[B5] audit gate → ${rec.audit_result.passed ? "PASS" : "FAIL"} (${rec.audit_result.checks} checks)`],
      isReview ? ["w", `[A7] routed to coordinator → status=${closed ? "closed (" + closed.verdict + ")" : "review_queue"}`] : ["a", `[A6] final verdict: ${rec.verdict.toUpperCase()}  · total ${timing.total} ms`]
    ];
    const trace = (step === 0 ? [["d", "Ready — press Run agents"]] : T.slice(0, step + 1)).flatMap((t) => t[1].split("\n").map((line) => [t[0], line])).map((t) => `<span class="ln ${t[0]}">${esc(t[1])}</span>`).join("")
      + (step >= 6 ? `<span class="ln d">[A3] OUTER fan-in → eligible: ${sm.eligible.join(", ") || "none"} · review: ${sm.review.join(", ") || "none"}</span>` : "");

    const fields = step >= 1 ? [
      ["Age", st.age != null ? st.age + " y" : null], ["Diagnosis", st.diagnosis || null],
      ["HbA1c", st.labs.hba1c != null ? st.labs.hba1c + " %" : null], ["BMI", st.labs.bmi ?? null],
      ["eGFR", st.labs.egfr ?? null], ["ALT", st.labs.alt != null ? st.labs.alt + " U/L" : null],
      ["Medications", st.medications.join(", ") || "none"], ["Conditions", st.conditions.join(", ") || "none"]
    ].map(([k, v]) => `<div class="field"><span class="k">${k}</span><span class="v ${v == null ? "missing" : ""}">${esc(v ?? "missing")}</span></div>`).join("")
      : `<div class="field" style="grid-column:1/-1"><span class="k">Status</span><span class="v">Not parsed yet</span></div>`;

    const score = {}; rec.retrieved_criteria.forEach((r) => (score[r.clause_id] = r.score));
    const llmOf = {}; rec.retrieved_criteria.forEach((r) => { if (r.llm_relevance != null) llmOf[r.clause_id] = r; });
    const clauseRow = (r) => `<div class="clause"><span class="chip ${r.outcome}">${r.outcome}</span><div><div class="t">${esc(r.title)}<span class="mono">${short(r.clause_id)} · sim ${score[r.clause_id]}${llmOf[r.clause_id] ? " · LLM " + llmOf[r.clause_id].llm_relevance : ""}</span></div><div class="r">${esc(r.reason)}</div>${llmOf[r.clause_id] && llmOf[r.clause_id].llm_reason ? `<div class="r llmr">LLM: ${esc(llmOf[r.clause_id].llm_reason)}</div>` : ""}</div></div>`;
    const isCustom = S.custom.some((x) => x.id === c.id);
    const llmCard = c.llm ? `
        <section class="card llmcard" aria-label="LLM retrieval">
          <div class="card-head"><h2>LLM-assisted retrieval</h2><span class="chip llm">${esc(c.llm.providerLabel)} · ${esc(c.llm.model)} · ${c.llm.ms} ms${c.llm.via ? " · via " + esc(c.llm.via) : ""}</span></div>
          <p class="hint" style="margin:0">The LLM only helps <strong>find and rank</strong> protocol clauses. It never removes a clause and never decides eligibility — the verdict below is still made by the rule tool, decide() and the auditor.</p>
          <div class="row" style="gap:20px">
            <div style="flex:1 1 260px;min-width:0;display:flex;flex-direction:column;gap:6px"><span class="eyebrow">Queries written by the LLM</span>${c.llm.queries.map((q) => `<span class="cid" style="white-space:normal">${esc(q)}</span>`).join("") || '<span class="hint">none</span>'}</div>
            <div style="flex:2 1 360px;min-width:0;display:flex;flex-direction:column;gap:6px"><span class="eyebrow">Hybrid ranking (50% TF-IDF + 50% LLM)</span>
              ${rec.retrieved_criteria.slice().sort((a, b) => (b.hybrid_score || 0) - (a.hybrid_score || 0)).slice(0, 6).map((r) => `<div class="rank"><span class="mono" style="width:64px;flex-shrink:0">${short(r.clause_id)}</span><div class="bar" style="flex:1"><div style="width:${Math.round((r.hybrid_score || 0) * 100)}%"></div></div><span class="mono" style="width:40px;text-align:right">${(r.hybrid_score ?? 0).toFixed(2)}</span><span class="hint" style="flex:2;min-width:0">${esc(r.llm_reason || "")}</span></div>`).join("")}
            </div>
          </div>
          ${isCustom && L.enabled() ? `<div class="btns"><button class="btn" id="llmRerun">Run LLM retrieval again</button></div>` : ""}
        </section>` : c.llmError ? `
        <section class="card llmcard" aria-label="LLM retrieval"><div class="card-head"><h2>LLM-assisted retrieval</h2><span class="chip fail">failed</span></div>
          <p class="hint" style="margin:0">${esc(c.llmError)} — the pipeline fell back to plain TF-IDF retrieval, so results are still valid.</p>
          ${isCustom && L.enabled() ? `<div class="btns"><button class="btn" id="llmRerun">Try LLM retrieval again</button></div>` : ""}</section>` : (isCustom && L.enabled() ? `
        <section class="card llmcard" aria-label="LLM retrieval"><div class="card-head"><h2>LLM-assisted retrieval</h2><span class="chip pending">not used</span></div>
          <p class="hint" style="margin:0">This patient was added before LLM mode was on.</p><div class="btns"><button class="btn" id="llmRerun">Run LLM retrieval now</button></div></section>` : "");

    $app.innerHTML = `
    <div class="row">
      <aside class="card queue" aria-label="Patient queue">
        <div class="card-head"><h2>Patient queue</h2><span class="hint">${allCases().length} cases</span></div>
        <div class="qlist">${queue}</div>
        <details class="custom">
          <summary>+ Add a custom patient</summary>
          <form id="customForm" style="display:flex;flex-direction:column;gap:8px">
            <label for="customRaw">Raw summary</label>
            <textarea id="customRaw" rows="5" required placeholder="Patient P011: 52-year-old with type 2 diabetes mellitus. HbA1c 7.4%, BMI 32.0, eGFR 60, ALT 40. Medications: metformin. History: none."></textarea>
            <span class="hint">Same sentence shape as the synthetic cases. Missing labs become “unknown”.</span>
            <span class="hint" id="llmHint">${L.enabled() ? `<strong style="color:var(--teal-dark)">LLM mode on</strong> — ${esc(L.LABELS[L.load().provider])} will expand the search queries and re-rank clauses.` : "LLM mode off — plain TF-IDF retrieval. Turn it on from the top bar."}</span>
            <button class="btn primary" type="submit" id="addBtn">${L.enabled() ? "Add &amp; run with LLM" : "Add &amp; run"}</button>
          </form>
          ${S.custom.length ? `<button class="btn" id="clearCustom" style="margin-top:8px;width:100%">Remove custom cases</button>` : ""}
        </details>
      </aside>

      <div class="col mainc">
        <section class="card" aria-label="Raw summary">
          <div class="card-head">
            <span class="eyebrow">Raw case summary · ${esc(c.id)}${c.expected ? " · expected " + c.expected : " · custom"}</span>
            <div class="btns">
              <button class="btn primary" id="runBtn" ${S.timer ? "disabled" : ""}><svg width="16" height="16" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M7 4v16l13-8z"/></svg>${S.timer ? "Running…" : "Run agents"}</button>
              <button class="btn" id="stepBtn">Step</button>
              <button class="btn" id="resetBtn">Reset</button>
              ${isCustom ? `<button class="btn danger" data-del="${esc(c.id)}">Delete patient</button>` : ""}
              <label class="btn" style="font-weight:500">Speed
                <select id="speed" style="border:none;background:transparent;font:inherit;font-weight:600;color:inherit">
                  ${[1200, 700, 350].map((v) => `<option value="${v}" ${S.speed === v ? "selected" : ""}>${v === 1200 ? "Slow" : v === 700 ? "Normal" : "Fast"}</option>`).join("")}
                </select></label>
            </div>
          </div>
          <p class="raw">${esc(c.raw)}</p>
        </section>

        <section class="card" aria-label="Trial matching">
          <div class="card-head"><h2>Trial matching · ${TRIALS.length} trials checked in parallel</h2>
            <span class="hint">Eligible: <strong style="color:var(--teal-dark)">${sm.eligible.join(", ") || "none"}</strong> · Review: <strong style="color:var(--amber)">${sm.review.join(", ") || "none"}</strong></span></div>
          <p class="hint" style="margin:0">After intake, the patient fans out to one branch per trial. Each branch runs its own RAG over that trial's protocol and its own inner fan-out. Click a trial to see its branch below.</p>
          <div class="ttiles">${tiles}</div>
        </section>

        <section class="card" aria-label="Agent pipeline">
          <div class="card-head"><h2>Pipeline · ${esc(S.trial)} branch</h2>
            <div class="legend"><span>${esc(tInfo.title)}</span><span aria-live="polite">Step ${step} / 6</span></div>
          </div>
          <div class="flow">
            ${node(1, "A", "A1", "Patient Intake Agent", `Structured → age ${st.age}, diagnosis, ${nLabs} labs, ${st.medications.length} meds, ${st.conditions.length} conditions`)}
            <div class="vline ${lit(1, "A")}"></div>
            <div class="outer ${step > 1 ? "on" : ""}">
              <span class="otitle">A3 · OUTER FAN-OUT → ${TRIALS.length} trial branches in parallel</span>
              <div class="opills">${TRIALS.map((t) => `<span class="opill ${t.id === S.trial ? "sel" : ""} ${step >= 6 || t.id !== S.trial ? finalVerdict(c, t.id) : ""}">${t.id}</span>`).join("")}</div>
              <span class="hint">Showing the <strong>${esc(S.trial)}</strong> branch ↓ (the other ${TRIALS.length - 1} run the same steps at the same time)</span>
            </div>
            <div class="vline ${lit(1, "A")}"></div>
            ${node(2, "B", "B2", "Criteria Retrieval Agent (RAG)", c.llm ? `${rec.retrieved_criteria.length} / ${tClauses} ${S.trial} clauses · Hybrid RAG: TF-IDF + ${c.llm.providerLabel} query expansion & re-rank` : `${rec.retrieved_criteria.length} / ${tClauses} ${S.trial} clauses retrieved · TF-IDF over this trial's protocol only${c.llmError ? " (LLM failed → fallback)" : ""}`)}
            <div class="vline ${lit(2, "B")}"></div><div class="hline ${lit(2, "B")}"></div>
            <div class="split">
              <div class="branch"><div class="vline ${lit(2, "B")}"></div>${node(3, "B", "B4", "Exclusion Checker", `${parts.triggered.length} triggered · ${excSoft} borderline/unknown of ${ex.length} exclusions`)}<div class="vline ${lit(3, "B")}"></div></div>
              <div class="branch"><div class="vline ${lit(2, "B")}"></div>${node(3, "A", "A2", "Inclusion Evaluation", `${inc.filter((r) => r.outcome === "pass").length} / ${inc.length} inclusion clauses pass (concurrent branch)`)}<div class="vline ${lit(3, "A")}"></div></div>
            </div>
            <div class="hline ${lit(3, "A")}"></div><div class="vline ${lit(3, "A")}"></div>
            ${node(4, "A", "A2", "Eligibility Manager · decide()", `Fan-in merge → proposal: ${proposed.toUpperCase()} citing ${rec.clause_ids.map(short).join(", ")}`)}
            <div class="vline ${lit(4, "A")}"></div>
            ${node(5, "B", "B5 · A4 gate", "Evidence Auditor", rec.audit_result.passed ? `${rec.audit_result.checks} / ${rec.audit_result.checks} checks passed · every claim traces to a retrieved clause` : `FAILED → downgraded to review: ${rec.audit_result.reasons.join("; ")}`)}
            <div class="vline ${lit(5, "B")}"></div><div class="hline ${lit(5, "B")}"></div>
            <div class="split">
              <div class="branch"><div class="vline ${step >= 6 && !isReview ? "lit-A" : ""}"></div>${node(6, "A", "A6", "Final Output", `Verdict ${rec.verdict.toUpperCase()} issued · matched ${rec.matched_criteria.length}, failed ${rec.failed_criteria.length}`, isReview, isReview ? "Not used — case needs a human" : "")}</div>
              <div class="branch"><div class="vline ${step >= 6 && isReview ? "lit-A" : ""}"></div>${node(6, "A", "A7", "Human-in-the-loop", closed ? `Closed by coordinator → ${closed.verdict.toUpperCase()}` : "Referral sent · status = review_queue · awaiting coordinator note", !isReview, !isReview ? "Not needed — verdict is final" : "")}
                ${isReview && step >= 6 ? `<a class="btn amber" style="margin-top:10px" href="#/review/${esc(c.id)}/${esc(S.trial)}" data-review="${esc(c.id)}">${closed ? "View decision" : "Open coordinator review"}</a>` : ""}
              </div>
            </div>
          </div>
        </section>

        <div class="row">
          <section class="card" style="flex:1 1 300px" aria-label="Structured record">
            <h2>A1 structured record</h2><div class="fields">${fields}</div>
          </section>
          <section class="card" style="flex:1 1 380px" aria-label="Verdict and trace">
            <div class="card-head"><h2>Verdict · ${esc(S.trial)}</h2><span class="chip big ${step >= 4 ? verdictNow : "pending"}">${step >= 4 ? verdictNow : "pending"}</span></div>
            <div class="cited"><span class="hint">Governing clauses:</span>${step >= 4 ? rec.clause_ids.map((id) => `<span class="cid">${id}</span>`).join("") : '<span class="cid">—</span>'}</div>
            <div class="trace" aria-live="polite"><span class="eyebrow">Orchestrator trace</span>${trace}</div>
            <div class="btns"><button class="btn" id="dlRec" ${step < 6 ? "disabled" : ""}>Download case record JSON</button></div>
          </section>
        </div>

        ${c.guidance && step >= 6 ? (c.guidance.error ? `
        <section class="card guide" aria-label="Patient guidance"><div class="card-head"><h2>A9 · Patient guidance</h2><span class="chip fail">not available</span></div>
          <p class="hint" style="margin:0">${esc(c.guidance.error)} — the screening result above is unaffected.</p></section>` : `
        <section class="card guide" aria-label="Patient guidance">
          <div class="card-head"><h2>A9 · Patient guidance</h2><span class="chip llm">LLM · ${esc(c.guidance.model || "")}${c.guidance.ms ? " · " + c.guidance.ms + " ms" : ""}</span></div>
          ${c.guidance.summary ? `<p class="gsum">${esc(c.guidance.summary)}</p>` : ""}
          <div class="ggrid">
            ${c.guidance.risks.length ? `<div class="gcol"><span class="eyebrow">Probable risks from this report</span>${c.guidance.risks.map((r) => `<div class="gitem risk"><b>${esc(r.risk)}</b>${r.based_on ? `<span class="hint">Based on ${esc(r.based_on)}</span>` : ""}</div>`).join("")}</div>` : ""}
            ${c.guidance.immediate_steps.length ? `<div class="gcol"><span class="eyebrow">Immediate steps · to avoid health issues</span>${c.guidance.immediate_steps.map((t) => `<div class="gitem step">${esc(t)}</div>`).join("")}</div>` : ""}
            ${c.guidance.to_become_eligible.length || c.guidance.cannot_change.length ? `<div class="gcol"><span class="eyebrow">To become eligible</span>${c.guidance.to_become_eligible.map((t) => `<div class="gitem elig">${esc(t)}</div>`).join("")}${c.guidance.cannot_change.map((t) => `<div class="gitem fixed"><span class="hint">Cannot change</span>${esc(t)}</div>`).join("")}</div>` : ""}
          </div>
          <p class="hint" style="margin:0">${c.guidance.safety_filter_applied ? "<strong>Safety filter applied:</strong> a suggestion to change medicines was removed. " : ""}${esc(c.guidance.disclaimer)}</p>
        </section>`) : ""}
        ${res.trace ? `
        <section class="card skcard" aria-label="Semantic Kernel trace">
          <div class="card-head"><h2>Semantic Kernel trace</h2><span class="chip sk">Python agents · ${res.trace.length} kernel calls · ${res.timing.total} ms</span></div>
          <p class="hint" style="margin:0">This case was processed by the real Python agents. Each step below is a <span class="mono">kernel.invoke()</span> on a plugin registered in <span class="mono">build_full_kernel()</span>; the two fan-out branches ran concurrently on separate threads.</p>
          <div class="sktrace">${res.trace.map((t) => `<div class="skrow${t.branch ? " par" : ""}"><span class="tag ${/^(A|B2\+)/.test(t.step) ? "a" : "b"}">${esc(t.step)}</span><span class="mono">${esc(t.call)}</span>${t.branch ? `<span class="chip pending">${esc(t.branch)}</span>` : ""}<span class="mono ms">${t.ms} ms</span></div>`).join("")}</div>
        </section>` : ""}
        ${llmCard}
        <section class="card" aria-label="Clause results">
          <div class="card-head"><h2>Clause-by-clause results · rule_tool.apply</h2><span class="hint">${step >= 3 ? "Deterministic, no LLM · borderline margins route to review" : "Appears after fan-out (step 3)"}</span></div>
          ${step >= 3 ? `<div class="clauses">
            <div class="clist"><span class="eyebrow" style="color:var(--teal)">Inclusion · must pass</span>${inc.map(clauseRow).join("")}</div>
            <div class="clist"><span class="eyebrow" style="color:var(--slate)">Exclusion · must not trigger</span>${ex.map(clauseRow).join("")}</div>
          </div>` : `<div class="placeholder">Run the agents to see each clause evaluated.</div>`}
        </section>
      </div>
    </div>`;

    $app.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => { stopTimer(); S.sel = b.dataset.pick; S.step = 6; renderPipeline(); }));
    $app.querySelectorAll("[data-trial]").forEach((b) => b.addEventListener("click", () => { stopTimer(); S.trial = b.dataset.trial; S.step = 6; renderPipeline(); }));
    $app.querySelector("#runBtn").addEventListener("click", runAnim);
    $app.querySelector("#stepBtn").addEventListener("click", () => { stopTimer(); S.step = S.step >= 6 ? 0 : S.step + 1; renderPipeline(); });
    $app.querySelector("#resetBtn").addEventListener("click", () => { stopTimer(); S.step = 0; renderPipeline(); });
    $app.querySelector("#speed").addEventListener("change", (e) => { S.speed = +e.target.value; });
    $app.querySelector("#dlRec").addEventListener("click", () => download(c.id + "_" + S.trial + ".json", Object.assign({}, rec, closed ? { verdict: closed.verdict, status: "closed", coordinator_note: closed.note } : {})));
    $app.querySelector("#customForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const raw = $app.querySelector("#customRaw").value.trim();
      if (!raw) return;
      const m = raw.match(/\b(P\d{2,4})\b/i);
      let id = m ? m[1].toUpperCase() : "C" + String(S.custom.length + 1).padStart(3, "0");
      if (allCases().some((x) => x.id === id)) id = id + "-" + (S.custom.length + 1);
      const entry = { id, raw };
      if (API.on) {
        const btn = $app.querySelector("#addBtn"); btn.disabled = true; btn.textContent = L.enabled() ? "Python agents + LLM via Semantic Kernel…" : "Running Python agents…";
        await serverAdd(entry, L.enabled());
      } else if (L.enabled()) {
        const btn = $app.querySelector("#addBtn"); btn.disabled = true; btn.textContent = "Asking the LLM…";
        await withLLM(entry);
      }
      S.custom.push(entry); store.set("custom", S.custom);
      S.sel = id; runAnim(); updateBadge();
    });
    const rr = $app.querySelector("#llmRerun");
    if (rr) rr.addEventListener("click", async () => {
      rr.disabled = true; rr.textContent = "Asking the LLM…";
      const entry = S.custom.find((x) => x.id === c.id);
      if (API.on) await serverAdd(entry, true); else await withLLM(entry);
      store.set("custom", S.custom);
      runAnim();
    });
    $app.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = b.dataset.del;
      if (!confirmDelete(id)) return;
      stopTimer();
      TRIALS.forEach((t) => delete S.closed[ck({ id }, t.id)]);
      S.custom = S.custom.filter((x) => x.id !== id);
      store.set("custom", S.custom); store.set("closed", S.closed);
      if (S.sel === id) { S.sel = "P008"; S.step = 6; }
      renderPipeline(); updateBadge();
    }));
    const cc = $app.querySelector("#clearCustom");
    if (cc) cc.addEventListener("click", () => { S.custom.forEach((x) => TRIALS.forEach((t) => delete S.closed[ck(x, t.id)])); S.custom = []; store.set("custom", []); store.set("closed", S.closed); S.sel = "P008"; renderPipeline(); updateBadge(); });
  }

  /* ───────── optional LLM mode (only for newly added patients) ───────── */
  async function serverAdd(entry, useLLM) {
    delete entry.llm; delete entry.llmError; delete entry.guidance;
    try {
      const out = await serverRun(entry, useLLM);
      Object.assign(entry, llmFromServer(out.trials.TRIAL01.rec, out.patient_guidance));
      API.results[keyOf(entry)] = fromServer(out);
    } catch (err) {
      entry.llmError = "Server error: " + (err && err.message ? err.message : err);
    }
  }

  async function withLLM(entry) {
    delete entry.llm; delete entry.llmError; delete entry.guidance;
    // Every trial clause is always evaluated by the rule tool, so the verdicts do not depend on the LLM.
    // That lets the two LLM calls (B2 hybrid retrieval and A9 guidance) run IN PARALLEL instead of one after the other.
    const m = A.runAllTrials(entry.id, entry.raw, null);
    const briefs = {};
    Object.entries(m.trials).forEach(([tid, t]) => (briefs[tid] = { verdict: t.rec.verdict, clause_ids: t.rec.clause_ids,
      flagged: t.rec.inclusion_results.concat(t.rec.exclusion_results).filter((r) => r.outcome !== "pass").map((r) => ({ clause_id: r.clause_id, title: r.title, outcome: r.outcome, reason: r.reason })) }));
    const clauses = D.protocols.map((p) => ({ clause_id: p.clause_id, type: p.type, title: p.title, text: p.text }));
    const [aug, gd] = await Promise.allSettled([L.augment(entry.raw, clauses), L.guide(m.trials.TRIAL01.rec, briefs)]);
    if (aug.status === "fulfilled") entry.llm = aug.value;
    else entry.llmError = "LLM call failed: " + (aug.reason && aug.reason.message ? aug.reason.message : aug.reason);
    entry.guidance = gd.status === "fulfilled" ? gd.value : { error: String(gd.reason && gd.reason.message ? gd.reason.message : gd.reason) };
  }

  function initLLMControls() {
    const tgl = document.getElementById("llmToggle"), dlg = document.getElementById("llmDialog");
    const f = document.getElementById("llmForm");
    const paint = () => {
      const s = L.load(), on = L.enabled();
      tgl.setAttribute("aria-pressed", String(on));
      tgl.querySelector(".state").textContent = on ? "On" : "Off";
      tgl.title = on ? `LLM mode on · ${L.LABELS[s.provider]} · ${L.modelOf(s)}` : "LLM mode off";
    };
    const open = () => {
      const s = L.load();
      f.elements.provider.value = s.provider; f.elements.model.value = s.model; f.elements.model.placeholder = L.MODELS[s.provider];
      f.elements.apiKey.value = s.apiKey; f.elements.enabled.checked = s.enabled || !s.apiKey;
      document.getElementById("llmErr").textContent = "";
      dlg.showModal();
    };
    tgl.addEventListener("click", () => {
      const s = L.load();
      if (!s.apiKey) return open();
      s.enabled = !s.enabled; L.save(s); paint(); route();
    });
    document.getElementById("llmSettings").addEventListener("click", open);
    f.elements.provider.addEventListener("change", () => { f.elements.model.placeholder = L.MODELS[f.elements.provider.value]; });
    document.getElementById("llmCancel").addEventListener("click", () => dlg.close());
    document.getElementById("llmClear").addEventListener("click", () => { L.save({ enabled: false, provider: f.elements.provider.value, model: "", apiKey: "" }); dlg.close(); paint(); route(); });
    f.addEventListener("submit", (e) => {
      e.preventDefault();
      const key = f.elements.apiKey.value.trim();
      if (f.elements.enabled.checked && !key) { document.getElementById("llmErr").textContent = "Enter an API key to turn LLM mode on."; return; }
      L.save({ enabled: f.elements.enabled.checked, provider: f.elements.provider.value, model: f.elements.model.value.trim(), apiKey: key });
      dlg.close(); paint(); route();
    });
    paint();
  }

  function runAnim() {
    stopTimer(); S.step = 0; renderPipeline();
    S.timer = setInterval(() => {
      S.step++;
      if (S.step >= 6) { S.step = 6; stopTimer(); }
      renderPipeline();
    }, S.speed);
    renderPipeline();
  }

  /* ════════════════════ COORDINATOR REVIEW VIEW ════════════════════ */
  function renderReview() {
    const q = [];
    allCases().forEach((x) => TRIALS.forEach((t) => { if (result(x, t.id).rec.verdict === "review") q.push({ c: x, tid: t.id, key: x.id + "/" + t.id }); }));
    const hp = location.hash.split("/"), fromHash = ((hp[2] || "") + "/" + (hp[3] || "TRIAL01")).toUpperCase();
    if (hp[2] && q.some((it) => it.key.toUpperCase() === fromHash)) S.reviewSel = q.find((it) => it.key.toUpperCase() === fromHash).key;
    if (!q.some((it) => it.key === S.reviewSel)) S.reviewSel = (q.find((it) => !closedOf(it.c, it.tid)) || q[0] || {}).key;

    if (!q.length) { $app.innerHTML = `<div class="card empty"><h2>No cases need review</h2><p class="muted">Every case got a clean verdict from the agents.</p><a class="btn primary" href="#/pipeline">Back to pipeline</a></div>`; return; }

    const item = q.find((x) => x.key === S.reviewSel), c = item.c, tid = item.tid, K = ck(c, tid);
    const { rec } = result(c, tid);
    const closed = S.closed[K];
    const flags = rec.inclusion_results.concat(rec.exclusion_results).filter((r) => r.outcome === "borderline" || r.outcome === "unknown");
    const proto = {}; D.protocols.forEach((p) => (proto[p.clause_id] = p));
    const ruleTxt = (r) => r.check === "range" ? `[${r.min}, ${r.max}] ± ${r.borderline_margin}` : r.check === "numeric" ? `${r.op} ${r.value}${r.borderline_margin ? " ± " + r.borderline_margin : ""}` : r.check;
    const hint = (tid === "TRIAL01" && D.review_hints[c.id]) || "reviewed by coordinator for " + tid;
    const draft = S.draft[K] ?? (closed ? closed.note : S.token + " - " + hint);
    const tok = A.parseToken(draft);
    const pv = tok === "ELIGIBLE" ? "eligible" : tok === "INELIGIBLE" ? "ineligible" : "review";
    const incPass = rec.inclusion_results.filter((r) => r.outcome === "pass").length;
    const excSoft = rec.exclusion_results.filter((r) => r.outcome !== "pass").length;

    $app.innerHTML = `
    <div class="page-head">
      <div><h1>Review queue</h1><p>Borderline or missing data never auto-decides. Each item is one <strong>patient × trial</strong> branch that was routed here by the manager or auditor; only a note that <strong>starts</strong> with a decision token can change the verdict.</p></div>
      <div class="tabs" role="tablist" aria-label="Review cases">
        ${q.map((x) => `<button class="tab" role="tab" aria-selected="${x.key === item.key}" data-rv="${esc(x.key)}"><span class="mono" style="font-weight:600">${esc(x.c.id)} · ${esc(x.tid)}</span><span class="chip ${closedOf(x.c, x.tid) ? "closed" : "review_queue"}">${closedOf(x.c, x.tid) ? "closed" : "review_queue"}</span></button>`).join("")}
      </div>
    </div>
    <div class="row">
      <section class="card" style="flex:1 1 520px" aria-label="Referral">
        <div class="card-head"><h2>Referral · ${esc(c.id)} for ${esc(tid)}</h2><span class="chip review">System verdict: review</span></div>
        <span class="hint" style="margin-top:-6px">${esc((TINFO[tid] || {}).title || tid)}</span>
        <p class="raw" style="background:var(--ground);padding:14px 16px;border-radius:10px">${esc(c.raw)}</p>
        <span class="eyebrow">Why the agents could not decide</span>
        ${flags.map((f) => `<div class="flag"><div class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8A4B00" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg></div>
          <div style="display:flex;flex-direction:column;gap:4px;min-width:0"><span style="font-weight:600">${esc(f.title)} <span class="mono muted" style="font-weight:400;font-size:12px">${f.clause_id}</span> <span class="chip ${f.outcome}">${f.outcome}</span></span>
          <span class="muted" style="font-size:13px">${esc(proto[f.clause_id].text)}</span>
          <span style="font-size:13px">${esc(f.reason)}</span>
          <div class="btns" style="gap:6px;margin-top:4px"><span class="pill">value: ${esc(f.evidence ?? "null")}</span><span class="pill">rule: ${esc(ruleTxt(proto[f.clause_id].rule))}</span></div></div></div>`).join("")}
        <div class="stats3">
          <div class="stat"><span class="k">Inclusion</span><span class="v">${incPass} / ${rec.inclusion_results.length} pass</span></div>
          <div class="stat"><span class="k">Exclusion flags</span><span class="v">${excSoft}</span></div>
          <div class="stat"><span class="k">Audit gate</span><span class="v" style="color:var(--teal-dark)">${rec.audit_result.passed ? "PASS" : "FAIL"} · ${rec.audit_result.checks}</span></div>
        </div>
      </section>

      <section class="card" style="flex:1 1 400px" aria-label="Coordinator decision">
        <h2>Coordinator decision</h2>
        <span class="eyebrow">1 · Pick a decision token</span>
        <div class="tokens">${["ELIGIBLE", "INELIGIBLE", "CONFIRM REVIEW"].map((t) => `<button class="token ${t.split(" ")[0]}" aria-pressed="${tok === t}" data-tok="${t}">${t}</button>`).join("")}</div>
        <label for="note" class="eyebrow">2 · Coordinator note</label>
        <textarea id="note" rows="4">${esc(draft)}</textarea>
        <span class="hint">The note must start with the token (optionally in brackets). Free text like “not eligible because…” never flips a verdict by accident.</span>
        <pre class="json" id="jsonPreview">${esc(jsonPreview(c.id + "_" + tid, pv, closed ? "closed" : "review_queue", draft))}</pre>
        <div id="err" role="alert" class="hint" style="color:var(--red);font-weight:600"></div>
        <div class="btns">
          <button class="btn primary" id="save" style="flex:1 1 200px;min-height:48px">${closed ? "Update decision" : "Save note &amp; close case"}</button>
          ${closed ? `<button class="btn" id="reopen">Reopen</button>` : ""}
          <a class="btn" href="#/pipeline" id="back">Back to pipeline</a>
        </div>
        ${closed ? `<div class="ok" role="status"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0B5E5E" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>${esc(c.id)} · ${esc(tid)} closed as “${closed.verdict}” · ${new Date(closed.at).toLocaleString()}</div>` : ""}
      </section>
    </div>`;

    $app.querySelectorAll("[data-rv]").forEach((b) => b.addEventListener("click", () => { S.reviewSel = b.dataset.rv; history.replaceState(null, "", "#/review/" + b.dataset.rv); renderReview(); }));
    $app.querySelectorAll("[data-tok]").forEach((b) => b.addEventListener("click", () => {
      S.token = b.dataset.tok;
      const cur = S.draft[K] ?? draft;
      const rest = cur.replace(/^\s*\[?\s*(CONFIRM REVIEW|INELIGIBLE|ELIGIBLE)\s*\]?\s*[-:–]?\s*/i, "");
      S.draft[K] = S.token + " - " + (rest || hint);
      renderReview();
    }));
    const note = $app.querySelector("#note");
    note.addEventListener("input", () => {
      S.draft[K] = note.value;
      const t = A.parseToken(note.value);
      $app.querySelectorAll("[data-tok]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tok === t)));
      $app.querySelector("#jsonPreview").textContent = jsonPreview(c.id + "_" + tid, t === "ELIGIBLE" ? "eligible" : t === "INELIGIBLE" ? "ineligible" : "review", closed ? "closed" : "review_queue", note.value);
    });
    $app.querySelector("#save").addEventListener("click", () => {
      const tmp = { verdict: "review", status: "review_queue" };
      const r = A.applyCoordinatorNote(tmp, note.value);
      if (!r.ok) { $app.querySelector("#err").textContent = r.error; return; }
      S.closed[K] = { verdict: tmp.verdict, note: tmp.coordinator_note, at: Date.now() };
      delete S.draft[K];
      store.set("closed", S.closed);
      renderReview(); updateBadge();
    });
    const ro = $app.querySelector("#reopen");
    if (ro) ro.addEventListener("click", () => { delete S.closed[K]; delete S.draft[K]; store.set("closed", S.closed); renderReview(); updateBadge(); });
    $app.querySelector("#back").addEventListener("click", () => { S.sel = c.id; S.trial = tid; S.step = 6; });
  }
  function confirmDelete(id) {
    try { return window.confirm("Delete patient " + id + " from the list?"); } catch (e) { return true; }
  }
  function jsonPreview(id, verdict, status, note) {
    return `// data/case_store/${id}.json\n{\n  "verdict": "${verdict}",\n  "status": "${status}",\n  "coordinator_note": ${JSON.stringify(note)}\n}`;
  }

  /* ════════════════════ EVALUATION VIEW ════════════════════ */
  function evaluate() {
    const rows = S.cases.map((c) => {
      const { rec } = result(c, "TRIAL01");
      const retrieved = new Set(rec.retrieved_criteria.map((r) => r.clause_id));
      const recall = c.expected_ids.filter((x) => retrieved.has(x)).length / c.expected_ids.length;
      return {
        case_id: c.id, expected: c.expected, verdict: rec.verdict, verdict_correct: rec.verdict === c.expected,
        expected_clauses: c.expected_ids, cited_clauses: rec.clause_ids,
        clause_correct: c.expected_ids.every((x) => rec.clause_ids.includes(x)),
        audit_passed: rec.audit_result.passed, retrieval_recall: recall, clauses_retrieved: rec.retrieved_criteria.length, note: c.note
      };
    });
    const n = rows.length, mean = (f) => rows.reduce((a, r) => a + f(r), 0) / n;
    return {
      agent: "Web UI · JS port of the agent pipeline", cases: n,
      verdict_accuracy: mean((r) => +r.verdict_correct), clause_citation_rate: mean((r) => +r.clause_correct),
      audit_pass_rate: mean((r) => +r.audit_passed), mean_retrieval_recall: mean((r) => r.retrieval_recall),
      mean_clauses_retrieved: mean((r) => r.clauses_retrieved), total_clauses: D.protocols.filter((p) => p.clause_id.startsWith("TRIAL01-")).length, rows
    };
  }

  function renderEvaluation() {
    const t0 = performance.now();
    const E = evaluate();
    const ms = (performance.now() - t0).toFixed(1);
    const pct = (x) => Math.round(x * 100) + "%";
    const kpi = (label, v, sub, b) => `<div class="kpi ${b ? "b" : ""}"><span class="hint" style="font-weight:600">${label}</span><span class="n">${pct(v)}</span><div class="bar"><div style="width:${v * 100}%"></div></div><span class="hint">${sub}</span></div>`;
    const cnt = (v) => E.rows.filter((r) => r.verdict === v).length;
    $app.innerHTML = `
    <div class="page-head">
      <div><h1>Evaluation report</h1><p>TRIAL01 metrics for all ${E.cases} labelled patients (same as <span class="mono">evaluate_partA.py</span>), plus the full <strong>patient × trial</strong> matrix from the outer fan-out. ${API.on ? "Computed by the Python agents via Semantic Kernel." : "Computed in your browser."}</p></div>
      <div class="btns"><button class="btn" id="rerun">Re-run</button><button class="btn primary" id="dl">Download results JSON</button></div>
    </div>
    <div class="kpis">
      ${kpi("Verdict accuracy", E.verdict_accuracy, `${E.rows.filter((r) => r.verdict_correct).length} / ${E.cases} cases match expected`)}
      ${kpi("Correct clause cited", E.clause_citation_rate, "Governing clause IDs cited")}
      ${kpi("Audit pass rate", E.audit_pass_rate, "B5 evidence gate")}
      ${kpi("Mean retrieval recall", E.mean_retrieval_recall, `${E.mean_clauses_retrieved.toFixed(1)} / ${E.total_clauses} clauses per case`, true)}
    </div>
    <div class="row">
      <section class="card" style="flex:999 1 640px;padding:20px 0 8px" aria-label="Per-case results">
        <h2 style="padding:0 24px">Per-case results</h2>
        <div class="tablewrap"><table>
          <thead><tr><th scope="col">Case</th><th scope="col">Expected</th><th scope="col">Verdict</th><th scope="col">Cited clauses</th><th scope="col">Audit</th><th scope="col">Recall</th><th scope="col">Why</th></tr></thead>
          <tbody>${E.rows.map((r) => `<tr>
            <td><a class="mono" style="font-weight:600" href="#/pipeline" data-open="${r.case_id}">${r.case_id}</a></td>
            <td><span class="chip ${r.expected}">${r.expected}</span></td>
            <td><span class="chip ${r.verdict}">${r.verdict}</span> <span class="${r.verdict_correct ? "good" : "bad"}" aria-label="${r.verdict_correct ? "correct" : "wrong"}">${r.verdict_correct ? "✓" : "✗"}</span></td>
            <td class="mono" style="font-size:12px">${r.cited_clauses.map(short).join(", ")}</td>
            <td class="${r.audit_passed ? "good" : "bad"}">${r.audit_passed ? "PASS" : "FAIL"}</td>
            <td>${pct(r.retrieval_recall)}</td>
            <td class="muted">${esc(r.note)}</td></tr>`).join("")}</tbody>
        </table></div>
      </section>
      <section class="card" style="flex:1 1 300px" aria-label="Verdict mix">
        <h2>Verdict mix</h2>
        <div class="mix" role="img" aria-label="${cnt("eligible")} eligible, ${cnt("ineligible")} ineligible, ${cnt("review")} review">
          <div style="flex:${cnt("eligible")};background:var(--teal)"></div><div style="flex:${cnt("ineligible")};background:var(--red-bar)"></div><div style="flex:${cnt("review")};background:var(--amber-bright)"></div>
        </div>
        <div class="mixrow"><span><span class="sw" style="background:var(--teal)"></span>Eligible</span><strong>${cnt("eligible")}</strong></div>
        <div class="mixrow"><span><span class="sw" style="background:var(--red-bar)"></span>Ineligible</span><strong>${cnt("ineligible")}</strong></div>
        <div class="mixrow"><span><span class="sw" style="background:var(--amber-bright)"></span>Review → coordinator</span><strong>${cnt("review")}</strong></div>
        <div style="border-top:1px solid var(--line-soft);padding-top:14px;display:flex;flex-direction:column;gap:6px">
          <span class="eyebrow">Shared contract</span>
          <span style="font-size:13px">Semantic Kernel plugins · <span class="mono" style="font-size:12px">run(case_record) → case_record</span> · JSON case store · clause IDs <span class="mono" style="font-size:12px">TRIAL0n-INC/EXC-nn</span></span>
        </div>
      </section>
    </div>
    ${matrixCard()}`;
    $app.querySelector("#rerun").addEventListener("click", renderEvaluation);
    $app.querySelector("#dl").addEventListener("click", () => download("results_web.json", E));
    $app.querySelectorAll("[data-open]").forEach((a) => a.addEventListener("click", () => { S.sel = a.dataset.open; if (a.dataset.opentrial) S.trial = a.dataset.opentrial; S.step = 6; }));
  }

  /* ════════════════════ ASK THE AGENT (Semantic Kernel + AI connector) ════════════════════ */
  const AG = { busy: false, log: [] };
  function renderAgent() {
    const s = L.load();
    const ready = API.on && s.apiKey;
    const examples = ["Is patient P008 eligible for the trial?", "Check this patient: 61-year-old with type 2 diabetes mellitus. HbA1c 8.5%, BMI 29.0, eGFR 70, ALT 30. Medications: metformin, liraglutide. History: none.", "Which exclusion clause covers kidney function, and what is its threshold?"];
    $app.innerHTML = `
    <div class="page-head">
      <div><h1>Ask the agent</h1><p>A Semantic Kernel agent with an <strong>AI connector</strong> (${esc(L.LABELS[s.provider] || s.provider)} · ${esc(L.modelOf(s))}). It answers by <strong>calling our agents as kernel plugins</strong> through automatic function calling — the verdict always comes from the rule-based pipeline; the LLM only explains it.</p></div>
    </div>
    ${!API.on ? `<div class="card empty"><h2>Start the Python server first</h2><p class="muted">This page needs the real Python agents and Semantic Kernel. In the project folder run:</p><pre class="json" style="text-align:left">pip install -r requirements.txt
python server.py</pre><p class="muted">then open <span class="mono">http://localhost:8000/#/agent</span>.</p></div>` :
    !s.apiKey ? `<div class="card empty"><h2>Add an API key</h2><p class="muted">Open the gear next to <b>LLM mode</b> and paste a key (Gemini has a free tier). The key is sent only to your own local server.</p><button class="btn primary" id="agOpen">Open LLM settings</button></div>` : `
    <div class="row">
      <section class="card" style="flex:1 1 420px" aria-label="Question">
        <label for="agQ" class="eyebrow">Your question</label>
        <textarea id="agQ" rows="4">${esc(AG.draft || examples[0])}</textarea>
        <div class="btns"><button class="btn primary" id="agSend" ${AG.busy ? "disabled" : ""}>${AG.busy ? "Agent is thinking…" : "Ask"}</button></div>
        <span class="eyebrow">Try</span>
        ${examples.map((e, i) => `<button class="btn" style="justify-content:flex-start;text-align:left;height:auto;padding:10px 14px;font-weight:500" data-ex="${i}">${esc(e)}</button>`).join("")}
      </section>
      <section class="card" style="flex:1.4 1 480px" aria-label="Conversation">
        <h2>Conversation</h2>
        ${AG.log.length ? AG.log.map((m) => `
          <div class="agq"><span class="eyebrow">You</span><p style="margin:4px 0 0">${esc(m.q)}</p></div>
          ${m.error ? `<div class="flag"><span>${esc(m.error)}</span></div>` : `
          ${(m.tool_calls || []).map((t) => `<div class="skrow par"><span class="tag a">tool</span><span class="mono" style="white-space:normal;word-break:break-word">${esc(t)}</span></div>`).join("") || '<div class="hint">No tool calls were made.</div>'}
          <div class="aga"><span class="eyebrow">Agent</span><div style="white-space:pre-wrap;margin-top:4px">${esc(m.answer)}</div></div>`}`).join("") : '<div class="placeholder">Ask a question — the tool calls the LLM makes into our agents will appear here.</div>'}
      </section>
    </div>`}`;
    const op = $app.querySelector("#agOpen"); if (op) op.addEventListener("click", () => document.getElementById("llmSettings").click());
    if (!ready) return;
    const q = $app.querySelector("#agQ");
    q.addEventListener("input", () => (AG.draft = q.value));
    $app.querySelectorAll("[data-ex]").forEach((b) => b.addEventListener("click", () => { AG.draft = examples[+b.dataset.ex]; renderAgent(); }));
    $app.querySelector("#agSend").addEventListener("click", async () => {
      const question = q.value.trim(); if (!question) return;
      AG.busy = true; AG.draft = question; renderAgent();
      try {
        const r = await fetch("api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, llm: L.load() }) });
        const out = await r.json();
        AG.log.unshift(r.ok ? { q: question, answer: out.answer, tool_calls: out.tool_calls } : { q: question, error: out.error || "Request failed" });
      } catch (e) { AG.log.unshift({ q: question, error: String(e) }); }
      AG.busy = false; renderAgent();
    });
  }

  /* ════════════════════ ARCHITECTURE VIEW ════════════════════ */
  function matrixCard() {
    const pts = allCases();
    const matched = pts.filter((c) => TRIALS.some((t) => result(c, t.id).rec.verdict === "eligible")).length;
    const rescued = pts.filter((c) => result(c, "TRIAL01").rec.verdict !== "eligible" && TRIALS.some((t) => t.id !== "TRIAL01" && result(c, t.id).rec.verdict === "eligible")).length;
    return `<section class="card" style="margin-top:24px;padding:20px 0 8px" aria-label="Trial matching matrix">
      <div class="card-head" style="padding:0 24px"><h2>Trial matching matrix · outer fan-out</h2>
        <span class="hint"><strong>${matched} / ${pts.length}</strong> patients eligible for at least one trial · <strong>${rescued}</strong> not eligible for TRIAL01 but matched elsewhere</span></div>
      <div class="tablewrap"><table class="matrix">
        <thead><tr><th scope="col">Patient</th>${TRIALS.map((t) => `<th scope="col" title="${esc(t.title)}">${t.id}<br><span style="font-weight:500;text-transform:none;letter-spacing:0">${esc(t.short)}</span></th>`).join("")}</tr></thead>
        <tbody>${pts.map((c) => `<tr><td><a class="mono" style="font-weight:600" href="#/pipeline" data-open="${esc(c.id)}">${esc(c.id)}</a></td>${TRIALS.map((t) => { const v = finalVerdict(c, t.id); return `<td><a href="#/pipeline" data-open="${esc(c.id)}" data-opentrial="${t.id}" class="chip ${v}" style="text-decoration:none">${closedOf(c, t.id) ? "✓ " : ""}${v}</a></td>`; }).join("")}</tr>`).join("")}</tbody>
      </table></div>
    </section>`;
  }

  function renderAbout() {
    const card = (tag, part, name, file, desc) => `<div class="arch"><span class="tag" style="background:${part === "A" ? "var(--teal)" : "var(--slate)"}">${tag}</span><strong>${name}</strong><span class="mono hint">${file}</span><span style="font-size:13px">${desc}</span></div>`;
    $app.innerHTML = `
    <div class="page-head"><div><h1>How the agents work</h1><p>A raw patient summary is read once by the intake agent, then <strong>fans out to ${TRIALS.length} trial branches in parallel</strong>. Inside every branch, retrieval grounds the decision in that trial's protocol, deterministic rules (no LLM judging) evaluate each clause in a second, inner fan-out, an auditor gates the verdict, and anything uncertain goes to a human.</p></div><a class="btn primary" href="#/pipeline">Try it live</a></div>
    <div class="archgrid">
      ${card("A1", "A", "Patient Intake Agent", "part_a_agents/patient_intake_agent.py", "Regex + keyword mapper turn free text into {age, diagnosis, labs, medications, conditions}; medication aliases (glargine → insulin) feed the rule tool.")}
      ${card("B2", "B", "Criteria Retrieval Agent", "agents/criteria_retrieval_agent.py", "Chunks the 13 TRIAL01 clauses, embeds them with hashed TF-IDF and runs one cosine query per patient signal against an in-memory vector store.")}
      ${card("B3", "B", "Deterministic rule tool", "tools/rule_tool.py", "numeric, range, medication_any and text_any checks from each clause's Rule-JSON. Values inside a borderline margin → borderline; missing data → unknown.")}
      ${card("B4", "B", "Exclusion Checker", "agents/exclusion_checker_agent.py", "Fan-out branch 1: runs every retrieved exclusion clause through the rule tool.")}
      ${card("A2", "A", "Eligibility Manager", "part_a_agents/eligibility_manager_agent.py", "Fan-out branch 2 evaluates inclusions concurrently; fan-in decide() merges both: any trigger/unmet → ineligible, any borderline/unknown → review, else eligible.")}
      ${card("A3 · outer", "A", "Trial fan-out (two levels)", "multi_trial.py · sk_pipeline.py", "Intake runs once, then one thread per trial. Each trial branch has its own vector store and its own inner B4 ‖ A2 fan-out; the fan-in builds the trial-match summary. A coverage guard makes sure every criterion of the trial is evaluated.")}
      ${card("A3 · A4", "A", "Orchestrator + gate", "orchestrator.py", "ThreadPoolExecutor fan-out / fan-in, then the auditor gate. A failed audit can never release a verdict — it downgrades to review.")}
      ${card("B5", "B", "Evidence Auditor", "agents/evidence_auditor_agent.py", "Checks every result cites a retrieved clause with evidence, and the verdict is consistent with the rule results.")}
      ${card("A6 · A7", "A", "Final output · Human-in-the-loop", "human_loop.py", "Clean verdicts are issued; review cases go to the trial coordinator, whose note must start with ELIGIBLE / INELIGIBLE / CONFIRM REVIEW to close the case.")}
      ${card("B2 + LLM", "A", "Optional LLM mode (hybrid RAG)", "docs/llm.js · Atharwa/llm_retrieval.py", "Off by default. When switched on, each newly added patient gets LLM query expansion and clause re-ranking (50% TF-IDF + 50% LLM). The LLM never removes a clause or decides eligibility; on any error the system falls back to TF-IDF.")}
      ${card("A5", "B", "Shared case record", "shared/case_record.py", "One JSON record per case, passed agent-to-agent via run(case_record) → case_record and saved to data/case_store/.")}
    </div>
    ${TRIALS.map((t) => `<section class="card" style="margin-top:24px"><div class="card-head"><h2>${t.id} · ${esc(t.title)}</h2><span class="chip pending">synthetic</span></div>
      <p class="hint" style="margin:0">${esc(t.overview || "")}</p>
      <div class="tablewrap"><table><thead><tr><th>Clause</th><th>Type</th><th>Criterion</th><th>Rule</th></tr></thead><tbody>
      ${D.protocols.filter((p) => p.clause_id.startsWith(t.id + "-")).map((p) => `<tr><td class="mono">${p.clause_id}</td><td><span class="chip ${p.type === "inclusion" ? "pass" : "unknown"}">${p.type}</span></td><td>${esc(p.text)}</td><td class="mono" style="font-size:12px">${esc(JSON.stringify(p.rule))}</td></tr>`).join("")}
      </tbody></table></div>
    </section>`).join("")}`;
  }

  /* ───────── utils ───────── */
  function download(name, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  initLLMControls();
  route();
  paintEngine();
  initBackend();
})();
