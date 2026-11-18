"""Part A Semantic Kernel wiring.

Registers BOTH Part A agents (A1, A2) AND Part B agents (B2, B4, B5)
as SK plugins under one kernel — the full system kernel.

Usage:
    from Atharwa.framework_partA import build_full_kernel
    kernel = build_full_kernel()
    # call via: kernel.plugins["patient_intake"]["run"]
"""
from __future__ import annotations

import sys
from pathlib import Path

_HERE  = Path(__file__).resolve().parent
_PARTB = _HERE.parent / "CLINICAL TRIAL ELIGIBILITY MATCHING DESK"
for _p in (_HERE, _PARTB):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

try:
    from semantic_kernel import Kernel
    from semantic_kernel.functions import kernel_function
    SK_AVAILABLE = True
except ImportError:
    SK_AVAILABLE = False
    Kernel = None          # type: ignore

    def kernel_function(*_a, **_k):  # type: ignore
        def deco(f): return f
        return deco


def build_full_kernel():
    """Create a Kernel with all Part A + Part B agents registered as plugins."""
    if not SK_AVAILABLE:
        raise RuntimeError("semantic-kernel not installed: pip install semantic-kernel>=1.0")

    # Part A agents
    from part_a_agents.patient_intake_agent      import PatientIntakePlugin
    from part_a_agents.eligibility_manager_agent import EligibilityManagerPlugin
    from orchestrator                            import OrchestratorPlugin

    # Part B agents
    from agents import (                                       # type: ignore[import]
        criteria_retrieval_agent,
        exclusion_checker_agent,
        evidence_auditor_agent,
    )

    kernel = Kernel()

    # Part A
    kernel.add_plugin(PatientIntakePlugin(),      plugin_name="patient_intake")
    kernel.add_plugin(EligibilityManagerPlugin(), plugin_name="eligibility_manager")
    kernel.add_plugin(OrchestratorPlugin(),       plugin_name="orchestrator")
    from llm_retrieval import LLMRetrievalPlugin   # optional LLM mode (needs LLM_API_KEY at call time)
    kernel.add_plugin(LLMRetrievalPlugin(),       plugin_name="llm_retrieval")
    from multi_trial import TrialMatchingPlugin    # outer fan-out: per-trial retrieval
    kernel.add_plugin(TrialMatchingPlugin(),      plugin_name="trial_matching")

    # Part B (re-registered here for completeness in the unified kernel)
    kernel.add_plugin(criteria_retrieval_agent.CriteriaRetrievalPlugin(),
                      plugin_name="criteria_retrieval")
    kernel.add_plugin(exclusion_checker_agent.ExclusionCheckerPlugin(),
                      plugin_name="exclusion_checker")
    kernel.add_plugin(evidence_auditor_agent.EvidenceAuditorPlugin(),
                      plugin_name="evidence_auditor")

    return kernel
