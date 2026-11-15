# Clinical Trial Eligibility Matching Desk — Part B

CSE476 · CA2 · Q1 · Group 1. This folder holds **Part B** (B1–B7) of the work split:
protocol corpus, Criteria Retrieval Agent (RAG), deterministic rule tool, Exclusion Checker
Agent, Evidence Auditor Agent (gate), 10 synthetic patients, and the evaluation script.

> Academic demonstration only. All patients are synthetic. Not medical advice.

## Shared contract (agreed with Part A)

| Item | Where |
|---|---|
| Framework: **Semantic Kernel** | [framework.py](framework.py) registers each agent as an SK plugin (`build_kernel()`) |
| Shared case record schema | [shared/case_record.py](shared/case_record.py) — `new_case`, `save_case`, `load_case` (JSON store) |
| Clause ID format `TRIAL01-INC-03` / `TRIAL01-EXC-05` | [data/protocols/](data/protocols/) |
| Agent interface `run(case_record) -> case_record` | every module in [agents/](agents/) |
| Verdicts `eligible` / `ineligible` / `review` | enforced by the auditor |

## What each Part B task maps to

| # | Task | File |
|---|---|---|
| B1 | Trial protocol documents (13 clauses + overview, each with `Clause ID` and `Rule-JSON`) | `data/protocols/*.md` |
| B2 | Criteria Retrieval Agent — chunking → local hashed TF-IDF embeddings → in-memory cosine vector store → per-signal queries | `agents/criteria_retrieval_agent.py` |
| B3 | Deterministic rule tool (`numeric`, `range`, `medication_any`, `text_any`; borderline margins; no LLM) | `tools/rule_tool.py` |
| B4 | Exclusion Checker Agent — runs every retrieved exclusion clause through the rule tool | `agents/exclusion_checker_agent.py` |
| B5 | Evidence Auditor Agent — every claim must trace to a retrieved clause; verdict must match results; fail ⇒ `review` | `agents/evidence_auditor_agent.py` |
| B6 | 10 synthetic patients with known verdicts (2 eligible, 5 ineligible, 3 borderline → review) | `data/patients.json` |
| B7 | Evaluation — verdict accuracy, correct-clause citation rate, audit pass rate, retrieval recall | `evaluation/evaluate.py` → `evaluation/results.json` |

`evaluation/stub_pipeline.py` contains tiny deterministic stand-ins for A1 (intake) and A2 (manager)
plus a linear version of the A3/A4 flow, so Part B can be run and graded on its own. Part A replaces them.

## Run

```bash
pip install -r requirements.txt      # semantic-kernel (optional: agents also run without it)
python -m evaluation.evaluate        # B7 metrics over all 10 patients
python demo.py P008                  # walk one case through every agent (live demo)
```

Current result on the 10 cases:

```
Verdict accuracy      : 100%
Correct clause cited  : 100%
Audit pass rate       : 100%
Mean retrieval recall : 100%
```

Each processed case is written to `data/case_store/<case_id>.json` (the shared record store, A5).

## Protocol TRIAL01 (synthetic)

Inclusion: INC-01 age ≥ 18 · INC-02 T2DM diagnosis · INC-03 HbA1c ≥ 7.0 · INC-04 BMI 25–40 · INC-05 on metformin
Exclusion: EXC-01 age > 75 · EXC-02 HbA1c > 9.0 · EXC-03 eGFR < 45 · EXC-04 insulin / GLP-1 RA · EXC-05 type 1 diabetes ·
EXC-06 pregnancy · EXC-07 pancreatitis · EXC-08 ALT > 120

Values within a clause's `borderline_margin` of a threshold, or missing labs, produce `borderline` / `unknown`
outcomes, which the manager turns into `review` — this is what feeds the human-in-the-loop path (A7).

## Integration notes for Part A

- Fan-out: after intake, call `criteria_retrieval_agent.run` then `exclusion_checker_agent.run`
  (the checker needs `retrieved_criteria`). Fan-in: manager fills `inclusion_results`, `verdict`, `clause_ids`.
- Gate: call `evidence_auditor_agent.run` **after** the manager; if `audit_result.passed` is false the agent
  already sets `verdict = "review"`, `status = "review_queue"` and appends reasons to `coordinator_note`.
- Via SK: `kernel = framework.build_kernel(); kernel.plugins["evidence_auditor"]["run"]` takes/returns the record as JSON.
- The manager can reuse `tools.rule_tool.apply(rule, "inclusion", structured)` for inclusion clauses.
