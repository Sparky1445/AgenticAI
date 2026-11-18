"""Semantic Kernel AI connector layer.

Gives the kernel a real chat-completion service (an "AI connector"), so
Semantic Kernel itself calls the LLM. Used in two places:

  1. LLM mode retrieval  (llm_retrieval.py) — the query-expansion / re-ranking
     prompt is sent through the kernel's chat service.
  2. Agent chat          (`python main.py ask "..."`) — an LLM agent with
     automatic function calling. It answers questions by CALLING our agents as
     kernel plugins (check_patient, get_clause, list_patients). The verdict always
     comes from the rule-based pipeline; the LLM only explains it.

Configuration (environment variables):
  LLM_PROVIDER    gemini | openai | anthropic | azure | ollama   (default: gemini)
  LLM_API_KEY     your key (not needed for ollama)
  LLM_MODEL       model / Azure deployment name (optional except for azure)
  AZURE_OPENAI_ENDPOINT   only for azure, e.g. https://<name>.openai.azure.com/
  LLM_BASE_URL    optional override of the OpenAI-compatible endpoint

Gemini, Claude and Ollama are reached through their OpenAI-compatible
endpoints with SK's OpenAIChatCompletion connector; Azure uses AzureChatCompletion.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Annotated

_HERE = Path(__file__).resolve().parent
_PARTB = _HERE.parent / "CLINICAL TRIAL ELIGIBILITY MATCHING DESK"
for _p in (_HERE, _PARTB):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

try:
    from semantic_kernel import Kernel
    from semantic_kernel.connectors.ai.function_choice_behavior import FunctionChoiceBehavior
    from semantic_kernel.connectors.ai.open_ai import (
        AzureChatCompletion, OpenAIChatCompletion, OpenAIChatPromptExecutionSettings)
    from semantic_kernel.contents import ChatHistory
    from semantic_kernel.contents.function_call_content import FunctionCallContent
    from semantic_kernel.functions import kernel_function
    SK_AVAILABLE = True
except ImportError:                                    # pragma: no cover
    SK_AVAILABLE = False

DEFAULT_MODELS = {"gemini": "gemini-2.5-flash", "openai": "gpt-4o-mini",
                  "anthropic": "claude-haiku-4-5", "ollama": "llama3.1", "azure": ""}
BASE_URLS = {"gemini": "https://generativelanguage.googleapis.com/v1beta/openai/",
             "anthropic": "https://api.anthropic.com/v1/",
             "ollama": "http://localhost:11434/v1",
             "openai": None}
SERVICE_ID = "chat"
PATIENTS_FILE = _PARTB / "data" / "patients.json"
PROTOCOL_DIR = _PARTB / "data" / "protocols"


def _require_sk() -> None:
    if not SK_AVAILABLE:
        raise RuntimeError("semantic-kernel is not installed: pip install semantic-kernel")


def config(provider: str | None = None, api_key: str | None = None, model: str | None = None) -> dict:
    provider = (provider or os.getenv("LLM_PROVIDER") or "gemini").lower()
    return {"provider": provider,
            "api_key": api_key or os.getenv("LLM_API_KEY") or ("ollama" if provider == "ollama" else ""),
            "model": model or os.getenv("LLM_MODEL") or DEFAULT_MODELS.get(provider, ""),
            "base_url": os.getenv("LLM_BASE_URL") or BASE_URLS.get(provider),
            "endpoint": os.getenv("AZURE_OPENAI_ENDPOINT", "")}


def make_chat_service(cfg: dict):
    """Create the Semantic Kernel AI connector for the chosen provider."""
    _require_sk()
    if not cfg["api_key"]:
        raise RuntimeError("LLM_API_KEY is not set")
    if cfg["provider"] == "azure":
        if not (cfg["endpoint"] and cfg["model"]):
            raise RuntimeError("azure needs AZURE_OPENAI_ENDPOINT and LLM_MODEL (deployment name)")
        return AzureChatCompletion(service_id=SERVICE_ID, deployment_name=cfg["model"],
                                   endpoint=cfg["endpoint"], api_key=cfg["api_key"])
    if cfg["provider"] not in BASE_URLS:
        raise RuntimeError(f"Unknown LLM_PROVIDER '{cfg['provider']}' "
                           "(use gemini, openai, anthropic, azure or ollama)")
    from openai import AsyncOpenAI
    client = AsyncOpenAI(api_key=cfg["api_key"], base_url=cfg["base_url"]) if cfg["base_url"] \
        else AsyncOpenAI(api_key=cfg["api_key"])
    return OpenAIChatCompletion(service_id=SERVICE_ID, ai_model_id=cfg["model"], async_client=client)


def build_ai_kernel(cfg: dict | None = None):
    """Full kernel (all Part A + Part B plugins) + an AI connector + the desk tools."""
    _require_sk()
    from framework_partA import build_full_kernel
    cfg = cfg or config()
    kernel = build_full_kernel()
    kernel.add_service(make_chat_service(cfg))
    kernel.add_plugin(EligibilityDeskTools(), plugin_name="desk")
    return kernel


# ─────────────────────────── 1. plain completion (used by LLM mode) ─────────

async def _complete(prompt: str, cfg: dict) -> str:
    kernel = Kernel()
    kernel.add_service(make_chat_service(cfg))
    chat = kernel.get_service(SERVICE_ID)
    history = ChatHistory()
    history.add_user_message(prompt)
    settings = OpenAIChatPromptExecutionSettings(service_id=SERVICE_ID, temperature=0, max_tokens=1500)
    result = await chat.get_chat_message_content(history, settings, kernel=kernel)
    return str(result)


def complete(prompt: str, provider=None, api_key=None, model=None) -> str:
    """Send one prompt through the Semantic Kernel AI connector (sync wrapper)."""
    return asyncio.run(_complete(prompt, config(provider, api_key, model)))


# ─────────────────────────── 2. agent chat with function calling ───────────

class EligibilityDeskTools:
    """Plugin the LLM agent can call. Every verdict comes from the rule-based pipeline."""

    @kernel_function(name="check_patient",
                     description="Run a patient summary through the full multi-agent eligibility pipeline "
                                 "(intake, RAG retrieval, exclusion + inclusion checks, auditor). "
                                 "Returns the rule-based verdict, matched/failed criteria and clause IDs.")
    def check_patient(self,
                      patient_summary: Annotated[str, "Free-text patient summary, e.g. '58-year-old with type 2 "
                                                      "diabetes mellitus. HbA1c 9.1%, BMI 30.0, eGFR 70, ALT 30. "
                                                      "Medications: metformin. History: none.'"],
                      case_id: Annotated[str, "Patient ID such as P008, or NEW"] = "NEW") -> str:
        from orchestrator import run_pipeline, extract_output
        rec = run_pipeline(case_id, patient_summary)
        flagged = [{"clause_id": r["clause_id"], "title": r["title"], "outcome": r["outcome"], "reason": r["reason"]}
                   for r in rec["inclusion_results"] + rec["exclusion_results"] if r["outcome"] != "pass"]
        out = extract_output(rec)
        out.update(flagged_clauses=flagged, audit_passed=rec["audit_result"]["passed"])
        return json.dumps(out)

    @kernel_function(name="list_patients", description="List the synthetic patients in the database with their summaries.")
    def list_patients(self) -> str:
        pats = json.loads(PATIENTS_FILE.read_text(encoding="utf-8"))
        return json.dumps([{"case_id": p["case_id"], "summary": p["raw_summary"]} for p in pats])

    @kernel_function(name="get_clause", description="Get the full text of a TRIAL01 protocol clause by its ID, e.g. TRIAL01-EXC-02.")
    def get_clause(self, clause_id: Annotated[str, "Clause ID like TRIAL01-INC-03"]) -> str:
        p = PROTOCOL_DIR / f"{clause_id.strip().upper()}.md"
        return p.read_text(encoding="utf-8") if p.exists() else f"No clause named {clause_id}"


SYSTEM_PROMPT = """You are the assistant of a clinical-trial eligibility desk for trial TRIAL01
(phase 3 oral add-on therapy for type 2 diabetes on metformin).
Rules:
- To judge any patient you MUST call desk-check_patient. Never decide eligibility yourself.
- For a known patient ID, first call desk-list_patients to get the summary, then desk-check_patient.
- Report the verdict exactly as returned, explain it in plain language, and cite the clause IDs.
- If the verdict is "review", say that a trial coordinator must decide and why.
- Academic demo with synthetic data; not medical advice."""


async def _ask(question: str, cfg: dict) -> dict:
    kernel = build_ai_kernel(cfg)
    chat = kernel.get_service(SERVICE_ID)
    history = ChatHistory()
    history.add_system_message(SYSTEM_PROMPT)
    history.add_user_message(question)
    settings = OpenAIChatPromptExecutionSettings(
        service_id=SERVICE_ID, temperature=0,
        function_choice_behavior=FunctionChoiceBehavior.Auto(filters={"included_plugins": ["desk"]}))
    answer = await chat.get_chat_message_content(history, settings, kernel=kernel)
    calls = [f"{item.plugin_name}.{item.function_name}({item.arguments})"
             for msg in history.messages for item in msg.items if isinstance(item, FunctionCallContent)]
    return {"answer": str(answer), "tool_calls": calls}


def ask(question: str, provider=None, api_key=None, model=None) -> dict:
    """Ask the Semantic Kernel agent a question; it calls our agents as tools."""
    return asyncio.run(_ask(question, config(provider, api_key, model)))
