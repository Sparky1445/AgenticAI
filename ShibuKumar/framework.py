"""Semantic Kernel wiring (Shared Contract item 1).

Each Part B agent is exposed as a Semantic Kernel plugin so Part A's
orchestrator can call it either as a plain `run(case_record)` module or
through the kernel (`kernel.plugins["criteria_retrieval"]["run"]`).

No paid service is used: embeddings are local (see agents/criteria_retrieval_agent.py)
and all judging is deterministic, so no chat-completion connector is required.
"""
from __future__ import annotations

import json

try:
    from semantic_kernel import Kernel
    from semantic_kernel.functions import kernel_function
    SK_AVAILABLE = True
except ImportError:  # keeps the modules importable in a bare interpreter
    SK_AVAILABLE = False
    Kernel = None  # type: ignore

    def kernel_function(*_a, **_k):  # type: ignore
        def deco(f):
            return f
        return deco


def build_kernel():
    """Create a Kernel with all Part B agents registered as plugins."""
    if not SK_AVAILABLE:
        raise RuntimeError("semantic-kernel is not installed: pip install -r requirements.txt")
    from agents import criteria_retrieval_agent, exclusion_checker_agent, evidence_auditor_agent

    kernel = Kernel()
    kernel.add_plugin(criteria_retrieval_agent.CriteriaRetrievalPlugin(), plugin_name="criteria_retrieval")
    kernel.add_plugin(exclusion_checker_agent.ExclusionCheckerPlugin(), plugin_name="exclusion_checker")
    kernel.add_plugin(evidence_auditor_agent.EvidenceAuditorPlugin(), plugin_name="evidence_auditor")
    return kernel


def to_json(rec: dict) -> str:
    return json.dumps(rec)


def from_json(s: str) -> dict:
    return json.loads(s)
