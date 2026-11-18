"""Local server: website + the real Python agents running through Semantic Kernel.

    python server.py            → open http://localhost:8000

The website (docs/) detects this server automatically. When it is running:
  • every patient is processed by the Python agents via kernel.invoke(...)
    and the page shows the Semantic Kernel trace of each plugin call;
  • the "Ask the agent" page talks to a Semantic Kernel agent with an AI
    connector that calls our agents as tools (needs an API key, entered in the
    website's LLM settings or set as LLM_API_KEY).
Without this server (e.g. on GitHub Pages) the website falls back to its
in-browser JavaScript copy of the agents.

Standard library only (plus semantic-kernel from requirements.txt).
"""
from __future__ import annotations

import json
import sys
import traceback
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DOCS = ROOT / "docs"
for _p in (ROOT / "Atharwa", ROOT / "CLINICAL TRIAL ELIGIBILITY MATCHING DESK"):
    sys.path.insert(0, str(_p))

try:
    import semantic_kernel
    import sk_pipeline
    SK_OK, SK_VERSION, SK_ERR = True, semantic_kernel.__version__, None
except Exception as exc:                                   # semantic-kernel missing or broken
    SK_OK, SK_VERSION, SK_ERR = False, None, f"{type(exc).__name__}: {exc}"

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


def _llm_cfg(body: dict) -> dict:
    """LLM settings sent by the website (key stays on this machine) or env vars."""
    s = body.get("llm") or {}
    return {k: v for k, v in {"provider": s.get("provider"), "api_key": s.get("apiKey"),
                              "model": s.get("model")}.items() if v}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(DOCS), **kw)

    def log_message(self, fmt, *args):
        if self.path.startswith("/api/"):
            sys.stderr.write("  %s %s\n" % (self.command, self.path))

    def _json(self, code: int, obj) -> None:
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/health":
            info = {"ok": True, "engine": "python", "semantic_kernel": SK_OK, "sk_version": SK_VERSION, "error": SK_ERR}
            if SK_OK:
                info["plugins"] = sk_pipeline.kernel_info()
                info["trials"] = sk_pipeline.multi_trial.trial_info()
            return self._json(200, info)
        return super().do_GET()

    def do_POST(self):
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or "{}")
            if self.path == "/api/run":
                if not SK_OK:
                    return self._json(503, {"error": "semantic-kernel not available: " + str(SK_ERR)})
                out = sk_pipeline.run_all_trials_sk(body["case_id"], body["raw"],
                                                    use_llm=bool(body.get("use_llm")), llm=_llm_cfg(body))
                return self._json(200, out)
            if self.path == "/api/ask":
                import sk_ai
                cfg = _llm_cfg(body)
                return self._json(200, sk_ai.ask(body["question"], cfg.get("provider"),
                                                  cfg.get("api_key"), cfg.get("model")))
            return self._json(404, {"error": "unknown endpoint"})
        except Exception as exc:
            traceback.print_exc()
            return self._json(500, {"error": f"{type(exc).__name__}: {exc}"})


if __name__ == "__main__":
    print("=" * 64)
    print("  Clinical Trial Eligibility Matching Desk — local server")
    print(f"  Semantic Kernel: {'v' + SK_VERSION if SK_OK else 'NOT available (' + str(SK_ERR) + ')'}")
    print(f"  Open  http://localhost:{PORT}   (Ctrl+C to stop)")
    print("=" * 64)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
