/* UI layer: hash router + views. All agent logic lives in agents.js. */
(function () {
  const D = window.CT_DATA, A = window.CT_AGENTS;
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
    step: 6,
    timer: null,
    speed: 700,
    closed: store.get("closed", {}), // case_id -> {verdict, note, at}
    reviewSel: null,
    token: "ELIGIBLE",
    draft: {}
  };
  const allCases = () => S.cases.concat(S.custom);
  const cache = {};
  const result = (c) => (cache[c.id + "|" + c.raw] ||= A.runPipeline(c.id, c.raw));
  const finalVerdict = (c) => (S.closed[c.id] ? S.closed[c.id].verdict : result(c).rec.verdict);

  /* ───────── router ───────── */
  const routes = { pipeline: renderPipeline, review: renderReview, evaluation: renderEvaluation, about: renderAbout };
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
    const n = allCases().filter((c) => result(c).rec.verdict === "review" && !S.closed[c.id]).length;
    const b = document.getElementById("reviewCount");
    b.textContent = n; b.classList.toggle("zero", n === 0);
  }

  /* ════════════════════ PIPELINE VIEW ════════════════════ */
  function stopTimer() { if (S.timer) { clearInterval(S.timer); S.timer = null; } }

  function renderPipeline() {
    const c = allCases().find((x) => x.id === S.sel) || allCases()[0];
    S.sel = c.id;
    const { rec, parts, proposed, timing } = result(c);
    const step = S.step;
    const isReview = proposed === "review" || rec.verdict === "review";
    const closed = S.closed[c.id];

    const queue = allCases().map((x) => {
      const r = result(x).rec, v = finalVerdict(x);
      const sub = r.structured.age != null ? `${r.structured.age} y · HbA1c ${r.structured.labs.hba1c ?? "?"}${r.structured.labs.egfr == null ? " · eGFR ?" : ""}` : "unparsed";
      return `<button class="qitem" data-pick="${esc(x.id)}" aria-current="${x.id === c.id}">
        <span><span class="qid">${esc(x.id)}</span><br><span class="qsub">${esc(sub)}</span></span>
        <span class="chip ${v}">${S.closed[x.id] ? "✓ " : ""}${v}</span></button>`;
    }).join("");

    const st = rec.structured;
    const nLabs = Object.keys(st.labs).length;
    const ex = rec.exclusion_results, inc = rec.inclusion_results;
    const excSoft = ex.filter((r) => r.outcome === "borderline" || r.outcome === "unknown").length;
    const node = (k, part, tag, name, out, skip, wait) => {
      let s = step > k ? "done" : step === k ? "active" : "pending";
      if (skip) s = step >= k ? "skipped" : "pending";
      const lab = { pending: "Waiting", active: "Running…", done: "Done ✓", skipped: "Skipped" }[s];
      const o = step >= k && !skip ? out : wait || "Awaiting upstream output";
      return `<div class="node part${part} ${s}"><div class="top"><span class="tag">${tag}</span><span class="state">${lab}</span></div><span class="name">${name}</span><span class="out">${esc(o)}</span></div>`;
    };
    const lit = (k, part) => (step > k ? "lit-" + part : "");
    const verdictNow = closed ? closed.verdict : rec.verdict;

    const T = [
      ["d", `$ run_pipeline("${c.id}")`],
      ["a", `[A1] intake → age=${st.age}, dx="${st.diagnosis}", ${nLabs} labs, ${st.medications.length} meds  (${timing.A1} ms)`],
      ["b", `[B2] retrieve → ${rec.retrieved_criteria.length} clauses, top: ${short(rec.retrieved_criteria[0].clause_id)} (${rec.retrieved_criteria[0].score})`],
      ["a", `[A3] fan-out ⇉ B4: ${parts.triggered.length} triggered, ${excSoft} unsure ‖ A2: ${inc.filter((r) => r.outcome === "pass").length}/5 pass`],
      ["a", `[A2] fan-in decide() → proposal: ${proposed} [${rec.clause_ids.map(short).join(", ")}]`],
      [rec.audit_result.passed ? "b" : "w", `[B5] audit gate → ${rec.audit_result.passed ? "PASS" : "FAIL"} (${rec.audit_result.checks} checks)`],
      isReview ? ["w", `[A7] routed to coordinator → status=${closed ? "closed (" + closed.verdict + ")" : "review_queue"}`] : ["a", `[A6] final verdict: ${rec.verdict.toUpperCase()}  · total ${timing.total} ms`]
    ];
    const trace = (step === 0 ? [["d", "Ready — press Run agents"]] : T.slice(0, step + 1)).map((t) => `<span class="ln ${t[0]}">${esc(t[1])}</span>`).join("");

    const fields = step >= 1 ? [
      ["Age", st.age != null ? st.age + " y" : null], ["Diagnosis", st.diagnosis || null],
      ["HbA1c", st.labs.hba1c != null ? st.labs.hba1c + " %" : null], ["BMI", st.labs.bmi ?? null],
      ["eGFR", st.labs.egfr ?? null], ["ALT", st.labs.alt != null ? st.labs.alt + " U/L" : null],
      ["Medications", st.medications.join(", ") || "none"], ["Conditions", st.conditions.join(", ") || "none"]
    ].map(([k, v]) => `<div class="field"><span class="k">${k}</span><span class="v ${v == null ? "missing" : ""}">${esc(v ?? "missing")}</span></div>`).join("")
      : `<div class="field" style="grid-column:1/-1"><span class="k">Status</span><span class="v">Not parsed yet</span></div>`;

    const score = {}; rec.retrieved_criteria.forEach((r) => (score[r.clause_id] = r.score));
    const clauseRow = (r) => `<div class="clause"><span class="chip ${r.outcome}">${r.outcome}</span><div><div class="t">${esc(r.title)}<span class="mono">${short(r.clause_id)} · sim ${score[r.clause_id]}</span></div><div class="r">${esc(r.reason)}</div></div></div>`;

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
            <button class="btn primary" type="submit">Add &amp; run</button>
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
              <label class="btn" style="font-weight:500">Speed
                <select id="speed" style="border:none;background:transparent;font:inherit;font-weight:600;color:inherit">
                  ${[1200, 700, 350].map((v) => `<option value="${v}" ${S.speed === v ? "selected" : ""}>${v === 1200 ? "Slow" : v === 700 ? "Normal" : "Fast"}</option>`).join("")}
                </select></label>
            </div>
          </div>
          <p class="raw">${esc(c.raw)}</p>
        </section>

        <section class="card" aria-label="Agent pipeline">
          <div class="card-head"><h2>Fan-out / fan-in pipeline</h2>
            <div class="legend"><span><span class="sw" style="background:var(--teal)"></span>Part A · Atharwa</span><span><span class="sw" style="background:var(--slate)"></span>Part B · partner</span><span aria-live="polite">Step ${step} / 6</span></div>
          </div>
          <div class="flow">
            ${node(1, "A", "A1", "Patient Intake Agent", `Structured → age ${st.age}, diagnosis, ${nLabs} labs, ${st.medications.length} meds, ${st.conditions.length} conditions`)}
            <div class="vline ${lit(1, "A")}"></div>
            ${node(2, "B", "B2", "Criteria Retrieval Agent (RAG)", `${rec.retrieved_criteria.length} / ${D.protocols.length} clauses retrieved · TF-IDF cosine over protocol docs`)}
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
                ${isReview && step >= 6 ? `<a class="btn amber" style="margin-top:10px" href="#/review/${esc(c.id)}" data-review="${esc(c.id)}">${closed ? "View decision" : "Open coordinator review"}</a>` : ""}
              </div>
            </div>
          </div>
        </section>

        <div class="row">
          <section class="card" style="flex:1 1 300px" aria-label="Structured record">
            <h2>A1 structured record</h2><div class="fields">${fields}</div>
          </section>
          <section class="card" style="flex:1 1 380px" aria-label="Verdict and trace">
            <div class="card-head"><h2>Verdict</h2><span class="chip big ${step >= 4 ? verdictNow : "pending"}">${step >= 4 ? verdictNow : "pending"}</span></div>
            <div class="cited"><span class="hint">Governing clauses:</span>${step >= 4 ? rec.clause_ids.map((id) => `<span class="cid">${id}</span>`).join("") : '<span class="cid">—</span>'}</div>
            <div class="trace" aria-live="polite"><span class="eyebrow">Orchestrator trace</span>${trace}</div>
            <div class="btns"><button class="btn" id="dlRec" ${step < 6 ? "disabled" : ""}>Download case record JSON</button></div>
          </section>
        </div>

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
    $app.querySelector("#runBtn").addEventListener("click", runAnim);
    $app.querySelector("#stepBtn").addEventListener("click", () => { stopTimer(); S.step = S.step >= 6 ? 0 : S.step + 1; renderPipeline(); });
    $app.querySelector("#resetBtn").addEventListener("click", () => { stopTimer(); S.step = 0; renderPipeline(); });
    $app.querySelector("#speed").addEventListener("change", (e) => { S.speed = +e.target.value; });
    $app.querySelector("#dlRec").addEventListener("click", () => download(c.id + ".json", Object.assign({}, rec, S.closed[c.id] ? { verdict: S.closed[c.id].verdict, status: "closed", coordinator_note: S.closed[c.id].note } : {})));
    $app.querySelector("#customForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const raw = $app.querySelector("#customRaw").value.trim();
      if (!raw) return;
      const m = raw.match(/\b(P\d{2,4})\b/i);
      let id = m ? m[1].toUpperCase() : "C" + String(S.custom.length + 1).padStart(3, "0");
      if (allCases().some((x) => x.id === id)) id = id + "-" + (S.custom.length + 1);
      S.custom.push({ id, raw }); store.set("custom", S.custom);
      S.sel = id; runAnim(); updateBadge();
    });
    const cc = $app.querySelector("#clearCustom");
    if (cc) cc.addEventListener("click", () => { S.custom.forEach((x) => delete S.closed[x.id]); S.custom = []; store.set("custom", []); store.set("closed", S.closed); S.sel = "P008"; renderPipeline(); updateBadge(); });
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
    const q = allCases().filter((c) => result(c).rec.verdict === "review");
    const fromHash = (location.hash.split("/")[2] || "").toUpperCase();
    if (fromHash && q.some((c) => c.id.toUpperCase() === fromHash)) S.reviewSel = q.find((c) => c.id.toUpperCase() === fromHash).id;
    if (!q.some((c) => c.id === S.reviewSel)) S.reviewSel = (q.find((c) => !S.closed[c.id]) || q[0] || {}).id;

    if (!q.length) { $app.innerHTML = `<div class="card empty"><h2>No cases need review</h2><p class="muted">Every case got a clean verdict from the agents.</p><a class="btn primary" href="#/pipeline">Back to pipeline</a></div>`; return; }

    const c = q.find((x) => x.id === S.reviewSel);
    const { rec } = result(c);
    const closed = S.closed[c.id];
    const flags = rec.inclusion_results.concat(rec.exclusion_results).filter((r) => r.outcome === "borderline" || r.outcome === "unknown");
    const proto = {}; D.protocols.forEach((p) => (proto[p.clause_id] = p));
    const ruleTxt = (r) => r.check === "range" ? `[${r.min}, ${r.max}] ± ${r.borderline_margin}` : r.check === "numeric" ? `${r.op} ${r.value}${r.borderline_margin ? " ± " + r.borderline_margin : ""}` : r.check;
    const hint = D.review_hints[c.id] || "reviewed by coordinator";
    const draft = S.draft[c.id] ?? (closed ? closed.note : S.token + " - " + hint);
    const tok = A.parseToken(draft);
    const pv = tok === "ELIGIBLE" ? "eligible" : tok === "INELIGIBLE" ? "ineligible" : "review";
    const incPass = rec.inclusion_results.filter((r) => r.outcome === "pass").length;
    const excSoft = rec.exclusion_results.filter((r) => r.outcome !== "pass").length;

    $app.innerHTML = `
    <div class="page-head">
      <div><h1>Review queue</h1><p>Borderline or missing data never auto-decides. These cases were routed here by the manager and auditor; only a note that <strong>starts</strong> with a decision token can change the verdict.</p></div>
      <div class="tabs" role="tablist" aria-label="Review cases">
        ${q.map((x) => `<button class="tab" role="tab" aria-selected="${x.id === c.id}" data-rv="${esc(x.id)}"><span class="mono" style="font-weight:600">${esc(x.id)}</span><span class="chip ${S.closed[x.id] ? "closed" : "review_queue"}">${S.closed[x.id] ? "closed" : "review_queue"}</span></button>`).join("")}
      </div>
    </div>
    <div class="row">
      <section class="card" style="flex:1 1 520px" aria-label="Referral">
        <div class="card-head"><h2>Referral for ${esc(c.id)}</h2><span class="chip review">System verdict: review</span></div>
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
        <pre class="json" id="jsonPreview">${esc(jsonPreview(c.id, pv, closed ? "closed" : "review_queue", draft))}</pre>
        <div id="err" role="alert" class="hint" style="color:var(--red);font-weight:600"></div>
        <div class="btns">
          <button class="btn primary" id="save" style="flex:1 1 200px;min-height:48px">${closed ? "Update decision" : "Save note &amp; close case"}</button>
          ${closed ? `<button class="btn" id="reopen">Reopen</button>` : ""}
          <a class="btn" href="#/pipeline" id="back">Back to pipeline</a>
        </div>
        ${closed ? `<div class="ok" role="status"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0B5E5E" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>${esc(c.id)} closed as “${closed.verdict}” · ${new Date(closed.at).toLocaleString()}</div>` : ""}
      </section>
    </div>`;

    $app.querySelectorAll("[data-rv]").forEach((b) => b.addEventListener("click", () => { S.reviewSel = b.dataset.rv; history.replaceState(null, "", "#/review/" + b.dataset.rv); renderReview(); }));
    $app.querySelectorAll("[data-tok]").forEach((b) => b.addEventListener("click", () => {
      S.token = b.dataset.tok;
      const cur = S.draft[c.id] ?? draft;
      const rest = cur.replace(/^\s*\[?\s*(CONFIRM REVIEW|INELIGIBLE|ELIGIBLE)\s*\]?\s*[-:–]?\s*/i, "");
      S.draft[c.id] = S.token + " - " + (rest || hint);
      renderReview();
    }));
    const note = $app.querySelector("#note");
    note.addEventListener("input", () => {
      S.draft[c.id] = note.value;
      const t = A.parseToken(note.value);
      $app.querySelectorAll("[data-tok]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tok === t)));
      $app.querySelector("#jsonPreview").textContent = jsonPreview(c.id, t === "ELIGIBLE" ? "eligible" : t === "INELIGIBLE" ? "ineligible" : "review", closed ? "closed" : "review_queue", note.value);
    });
    $app.querySelector("#save").addEventListener("click", () => {
      const tmp = { verdict: "review", status: "review_queue" };
      const r = A.applyCoordinatorNote(tmp, note.value);
      if (!r.ok) { $app.querySelector("#err").textContent = r.error; return; }
      S.closed[c.id] = { verdict: tmp.verdict, note: tmp.coordinator_note, at: Date.now() };
      delete S.draft[c.id];
      store.set("closed", S.closed);
      renderReview(); updateBadge();
    });
    const ro = $app.querySelector("#reopen");
    if (ro) ro.addEventListener("click", () => { delete S.closed[c.id]; delete S.draft[c.id]; store.set("closed", S.closed); renderReview(); updateBadge(); });
    $app.querySelector("#back").addEventListener("click", () => { S.sel = c.id; S.step = 6; });
  }
  function jsonPreview(id, verdict, status, note) {
    return `// data/case_store/${id}.json\n{\n  "verdict": "${verdict}",\n  "status": "${status}",\n  "coordinator_note": ${JSON.stringify(note)}\n}`;
  }

  /* ════════════════════ EVALUATION VIEW ════════════════════ */
  function evaluate() {
    const rows = S.cases.map((c) => {
      const { rec } = A.runPipeline(c.id, c.raw);
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
      agent: "Web UI · JS port of Part A + Part B", cases: n,
      verdict_accuracy: mean((r) => +r.verdict_correct), clause_citation_rate: mean((r) => +r.clause_correct),
      audit_pass_rate: mean((r) => +r.audit_passed), mean_retrieval_recall: mean((r) => r.retrieval_recall),
      mean_clauses_retrieved: mean((r) => r.clauses_retrieved), total_clauses: D.protocols.length, rows
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
      <div><h1>Evaluation report</h1><p>All ${E.cases} synthetic patients run live through the full pipeline in your browser just now (${ms} ms) — same metrics as <span class="mono">evaluate_partA.py</span>.</p></div>
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
          <span style="font-size:13px">Semantic Kernel plugins · <span class="mono" style="font-size:12px">run(case_record) → case_record</span> · JSON case store · clause IDs <span class="mono" style="font-size:12px">TRIAL01-INC/EXC-nn</span></span>
        </div>
      </section>
    </div>`;
    $app.querySelector("#rerun").addEventListener("click", renderEvaluation);
    $app.querySelector("#dl").addEventListener("click", () => download("results_web.json", E));
    $app.querySelectorAll("[data-open]").forEach((a) => a.addEventListener("click", () => { S.sel = a.dataset.open; S.step = 6; }));
  }

  /* ════════════════════ ARCHITECTURE VIEW ════════════════════ */
  function renderAbout() {
    const card = (tag, part, name, file, desc) => `<div class="arch"><span class="tag" style="background:${part === "A" ? "var(--teal)" : "var(--slate)"}">${tag}</span><strong>${name}</strong><span class="mono hint">${file}</span><span style="font-size:13px">${desc}</span></div>`;
    $app.innerHTML = `
    <div class="page-head"><div><h1>How the agents work</h1><p>A raw patient summary flows through six agents. Retrieval grounds every decision in a protocol clause; deterministic rules (no LLM judging) evaluate each clause; an auditor gates the verdict; anything uncertain goes to a human.</p></div><a class="btn primary" href="#/pipeline">Try it live</a></div>
    <div class="archgrid">
      ${card("A1", "A", "Patient Intake Agent", "part_a_agents/patient_intake_agent.py", "Regex + keyword mapper turn free text into {age, diagnosis, labs, medications, conditions}; medication aliases (glargine → insulin) feed the rule tool.")}
      ${card("B2", "B", "Criteria Retrieval Agent", "agents/criteria_retrieval_agent.py", "Chunks the 13 TRIAL01 clauses, embeds them with hashed TF-IDF and runs one cosine query per patient signal against an in-memory vector store.")}
      ${card("B3", "B", "Deterministic rule tool", "tools/rule_tool.py", "numeric, range, medication_any and text_any checks from each clause's Rule-JSON. Values inside a borderline margin → borderline; missing data → unknown.")}
      ${card("B4", "B", "Exclusion Checker", "agents/exclusion_checker_agent.py", "Fan-out branch 1: runs every retrieved exclusion clause through the rule tool.")}
      ${card("A2", "A", "Eligibility Manager", "part_a_agents/eligibility_manager_agent.py", "Fan-out branch 2 evaluates inclusions concurrently; fan-in decide() merges both: any trigger/unmet → ineligible, any borderline/unknown → review, else eligible.")}
      ${card("A3 · A4", "A", "Orchestrator + gate", "orchestrator.py", "ThreadPoolExecutor fan-out / fan-in, then the auditor gate. A failed audit can never release a verdict — it downgrades to review.")}
      ${card("B5", "B", "Evidence Auditor", "agents/evidence_auditor_agent.py", "Checks every result cites a retrieved clause with evidence, and the verdict is consistent with the rule results.")}
      ${card("A6 · A7", "A", "Final output · Human-in-the-loop", "human_loop.py", "Clean verdicts are issued; review cases go to the trial coordinator, whose note must start with ELIGIBLE / INELIGIBLE / CONFIRM REVIEW to close the case.")}
      ${card("A5", "B", "Shared case record", "shared/case_record.py", "One JSON record per case, passed agent-to-agent via run(case_record) → case_record and saved to data/case_store/.")}
    </div>
    <section class="card" style="margin-top:24px"><h2>Protocol TRIAL01 (synthetic)</h2>
      <div class="tablewrap"><table><thead><tr><th>Clause</th><th>Type</th><th>Criterion</th><th>Rule</th></tr></thead><tbody>
      ${D.protocols.map((p) => `<tr><td class="mono">${p.clause_id}</td><td><span class="chip ${p.type === "inclusion" ? "pass" : "unknown"}">${p.type}</span></td><td>${esc(p.text)}</td><td class="mono" style="font-size:12px">${esc(JSON.stringify(p.rule))}</td></tr>`).join("")}
      </tbody></table></div>
    </section>`;
  }

  /* ───────── utils ───────── */
  function download(name, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  route();
})();
