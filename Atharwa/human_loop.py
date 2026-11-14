"""A7 - Human-in-the-Loop Path.

When the Evidence Auditor (B5) or the Eligibility Manager (A2) produces a
`review` verdict, this module:

  1. Formats a human-readable referral for the trial coordinator, citing
     every borderline / unknown / audit-failed clause.
  2. Accepts the coordinator's note (from stdin in interactive mode, or
     from a passed string in automated / test mode).
  3. Writes the note back into the shared case record and sets
     status = "closed".

The completed record is then saved to the shared JSON store (A5).

Entry point:
    route_to_coordinator(case_record, coordinator_note=None) -> case_record

Interactive CLI:
    python human_loop.py <case_id>   (loads from data/case_store/<case_id>.json)
"""
from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

_HERE  = Path(__file__).resolve().parent
_PARTB = _HERE.parent / "CLINICAL TRIAL ELIGIBILITY MATCHING DESK"
for _p in (_HERE, _PARTB):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from shared.case_record import load_case, save_case   # type: ignore[import]

# ─────────────────────────── helpers ──────────────────────────────────────

_REVIEW_STORE = _PARTB / "data" / "case_store"


def _build_referral(rec: dict) -> str:
    """Generate a formatted referral summary for the coordinator."""
    lines: list[str] = [
        "=" * 70,
        f"TRIAL COORDINATOR REVIEW REQUEST",
        f"Case ID  : {rec['case_id']}",
        f"Time     : {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        "=" * 70,
        "",
        "PATIENT SUMMARY",
        "-" * 40,
        rec.get("raw_summary", "(not available)"),
        "",
        "STRUCTURED DATA",
        "-" * 40,
    ]
    s = rec.get("structured") or {}
    lines.append(f"  Age        : {s.get('age')}")
    lines.append(f"  Diagnosis  : {s.get('diagnosis')}")
    lines.append(f"  Labs       : {s.get('labs')}")
    lines.append(f"  Medications: {s.get('medications')}")
    lines.append(f"  Conditions : {s.get('conditions')}")
    lines.append("")

    # Borderline / unknown inclusion results
    inc_issues = [r for r in (rec.get("inclusion_results") or [])
                  if r.get("outcome") in ("borderline", "unknown", "fail")]
    if inc_issues:
        lines.append("FLAGGED INCLUSION CRITERIA")
        lines.append("-" * 40)
        for r in inc_issues:
            lines.append(f"  [{r['clause_id']}] {r['title']}")
            lines.append(f"    Outcome : {r['outcome'].upper()}")
            lines.append(f"    Evidence: {r['evidence']}")
            lines.append(f"    Reason  : {r['reason']}")
        lines.append("")

    # Borderline / triggered exclusion results
    exc_issues = [r for r in (rec.get("exclusion_results") or [])
                  if r.get("outcome") in ("borderline", "unknown") or r.get("triggered")]
    if exc_issues:
        lines.append("FLAGGED EXCLUSION CRITERIA")
        lines.append("-" * 40)
        for r in exc_issues:
            status = "TRIGGERED" if r.get("triggered") else r["outcome"].upper()
            lines.append(f"  [{r['clause_id']}] {r['title']}")
            lines.append(f"    Status  : {status}")
            lines.append(f"    Evidence: {r['evidence']}")
            lines.append(f"    Reason  : {r['reason']}")
        lines.append("")

    # Audit reasons (if any)
    audit = rec.get("audit_result") or {}
    if audit.get("reasons"):
        lines.append("AUDIT FLAGS")
        lines.append("-" * 40)
        for reason in audit["reasons"]:
            lines.append(f"  • {reason}")
        lines.append("")

    lines += [
        "Clause IDs behind review verdict:",
        "  " + ", ".join(rec.get("clause_ids") or []),
        "",
        "=" * 70,
        "COORDINATOR DECISION REQUIRED",
        "Please enter your decision note below.",
        "Format: [ELIGIBLE|INELIGIBLE|CONFIRM REVIEW] — your reasoning",
        "=" * 70,
    ]
    return "\n".join(lines)


def _parse_coordinator_verdict(note: str) -> str | None:
    """Try to extract an explicit verdict override from the coordinator's note."""
    note_upper = note.upper()
    if "ELIGIBLE" in note_upper and "INELIGIBLE" not in note_upper:
        return "eligible"
    if "INELIGIBLE" in note_upper:
        return "ineligible"
    return None   # keep "review" if coordinator doesn't override


# ─────────────────────────── main entry point ─────────────────────────────

def route_to_coordinator(
    case_record: dict,
    coordinator_note: str | None = None,
    interactive: bool = False,
) -> dict:
    """Route a 'review' verdict case to the trial coordinator.

    Args:
        case_record:      The shared case record (must have verdict=="review").
        coordinator_note: Pre-supplied coordinator note (for automated runs).
                          If None and interactive=True, prompts stdin.
                          If None and interactive=False, uses a default stub note.
        interactive:      If True, print the referral and read note from stdin.

    Returns:
        Updated case record with coordinator_note set and status="closed".
    """
    if case_record.get("verdict") != "review":
        # Nothing to do — not a review case
        return case_record

    referral = _build_referral(case_record)

    if interactive:
        print(referral)
        try:
            note = input("Coordinator note: ").strip()
        except (EOFError, KeyboardInterrupt):
            note = "No coordinator input received."
    elif coordinator_note is not None:
        note = coordinator_note
    else:
        # Automated stub — generate a default note based on clause IDs
        clause_list = ", ".join(case_record.get("clause_ids") or [])
        note = (
            f"[AUTO-STUB] Case {case_record['case_id']} routed for review. "
            f"Borderline / uncertain clauses: {clause_list}. "
            f"Awaiting clinical coordinator decision."
        )

    # Write the coordinator note back into the shared record
    existing = case_record.get("coordinator_note") or ""
    separator = "\n" if existing else ""
    timestamp  = datetime.now().strftime("%Y-%m-%d %H:%M")
    case_record["coordinator_note"] = (
        existing + separator +
        f"[coordinator @ {timestamp}] {note}"
    )

    # Allow coordinator to override verdict
    override = _parse_coordinator_verdict(note)
    if override:
        case_record["verdict"] = override

    # Close the case
    case_record["status"] = "closed"
    return case_record


# ─────────────────────────── CLI entry point ──────────────────────────────

def main(case_id: str, store_dir: Path = _REVIEW_STORE) -> None:
    """Interactive CLI: load a case, present referral, capture coordinator note."""
    try:
        rec = load_case(case_id, store_dir)
    except FileNotFoundError:
        print(f"Case '{case_id}' not found in {store_dir}.")
        sys.exit(1)

    if rec.get("verdict") != "review":
        print(f"Case '{case_id}' has verdict='{rec['verdict']}' — not in review queue.")
        sys.exit(0)

    rec = route_to_coordinator(rec, interactive=True)
    save_case(rec, store_dir)
    print(f"\n✓ Case {case_id} closed. Status: {rec['status']}")
    print(f"  Final verdict   : {rec['verdict']}")
    print(f"  Coordinator note: {rec['coordinator_note']}")


if __name__ == "__main__":
    _cid = sys.argv[1] if len(sys.argv) > 1 else "P008"
    main(_cid)
