# Clinical Trial Eligibility Matching Desk — Part A
## Atharwa Dewasthali (Reg: 12307876)

CSE476 · CA2 · Q1 · Group 1. This folder holds **Part A** (A1–A8) of the work split:
Patient Intake Agent, Eligibility Manager Agent, Fan-out/Fan-in Orchestrator,
Human-in-the-loop path, and the Part A evaluation script.

> Academic demonstration only. All patients are synthetic. Not medical advice.

---

## What Part A adds on top of Part B

Part B (partner's folder) provides the RAG retrieval (B2), deterministic rule tool (B3),
Exclusion Checker (B4), and Evidence Auditor gate (B5).

Part A provides the **orchestrating brain**:

| Task | File | Description |
|------|------|-------------|
| A1 | `part_a_agents/patient_intake_agent.py` | Structures raw text → age, diagnosis, labs, meds, conditions |
| A2 | `part_a_agents/eligibility_manager_agent.py` | Inclusion-rule branch (fan-out) + verdict (fan-in) |
| A3+A4+A6 | `orchestrator.py` | Fan-out/fan-in pipeline + auditor gate + final output |
| A5 | `shared/case_record.py` (Part B) | Shared JSON store (reused, not duplicated) |
| A7 | `human_loop.py` | Human-in-the-loop: routes review cases to trial coordinator |
| A8 | `evaluate_partA.py` | Runs all 10 patients through real A1+A2 (not stubs) |
| — | `framework_partA.py` | Semantic Kernel full-system kernel (A + B plugins) |
| — | `demo_partA.py` | Step-by-step demo for one patient |

---

## Architecture

```
Raw Summary
    │
    ▼
[A1] Patient Intake Agent  → structured {age, diagnosis, labs, medications, conditions}
    │
    ▼
[B2] Criteria Retrieval Agent  (RAG → retrieved_criteria[]; both branches need it)
    │
    ├──────────── Fan-out (A3, concurrent threads) ────────────┐
    ▼                                                          ▼
[B4] Exclusion Checker Agent                 [A2] Inclusion evaluation
  (rule_tool → exclusion_results[])            (rule_tool → inclusion_results[])
    │                                                          │
    └──────────────────── Fan-in (A3) ─────────────────────────┘
                               │
                               ▼
               [A2] Eligibility Manager decide()
                 (merge results → verdict proposal)
                               │
                               ▼
               [B5] Evidence Auditor Gate (A4)
               ┌───────────────┴───────────────┐
            PASS                             FAIL
               │                               │
               ▼                               ▼
       [A6] Final Output            [A7] Human-in-the-loop
       eligible / ineligible         coordinator note → closed
```

---

## Run

```bash
# From CA2Agent\Atharwa\
pip install semantic-kernel>=1.0        # optional — agents also run without it

# Full evaluation (all 10 patients, real A1+A2):
python evaluate_partA.py

# Step-by-step demo (default: P008 — the borderline case):
python demo_partA.py
python demo_partA.py P001
python demo_partA.py P008 "ELIGIBLE - borderline HbA1c acceptable per PI decision"

# Human-in-the-loop interactive CLI (loads a saved review case):
python human_loop.py P008
```

---

## Shared Contract (agreed with Part B)

| Item | Location |
|------|----------|
| Framework: **Semantic Kernel** | `framework_partA.build_full_kernel()` registers all agents |
| Shared case record schema | `../CLINICAL TRIAL ELIGIBILITY MATCHING DESK/shared/case_record.py` |
| Clause ID format `TRIAL01-INC-03` / `TRIAL01-EXC-05` | `../CLINICAL TRIAL.../data/protocols/` |
| Agent interface `run(case_record) → case_record` | every module in `agents/` |
| Verdicts `eligible` / `ineligible` / `review` | enforced by auditor |

---

## Group-of-3 Add-on: Human-in-the-Loop (A7)

The `human_loop.py` module implements the **human-in-the-loop path**:
- Borderline / review cases are formatted into a detailed referral for the trial coordinator
- Coordinator's note is written back into the shared case record (`coordinator_note` field)
- The note must **start** with a decision token: `ELIGIBLE`, `INELIGIBLE` or `CONFIRM REVIEW`
  (optionally in brackets). Only that leading token can override the verdict, so free text
  like "not eligible because…" never flips a verdict by accident.
- A case is closed (`status = "closed"`) only when a coordinator actually enters a note.
  In automated runs (evaluation, demo without a note) review cases stay in
  `status = "review_queue"` until `python main.py loop <case_id>` is used.

Borderline cases: **P008** (HbA1c 9.1 at edge), **P009** (eGFR missing), **P010** (BMI + eGFR both at edge)

---

## Expected Output (Part A evaluation)

```
Verdict accuracy      : 100%  (10 cases)
Correct clause cited  : 100%
Audit pass rate       : 100%
Mean retrieval recall : 100%  (governing clauses retrieved)
Clauses retrieved     : 13.0 / 13 per case
```

Retrieval recall is the share of each case's governing clauses (`expected_clause_ids`)
that B2 retrieved. `python main.py` and `python evaluate_partA.py` share the same
`evaluate()` function and write an identical results file.

Results written to `Atharwa/results_partA.json`.
