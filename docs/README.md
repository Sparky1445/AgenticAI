# Eligibility Matching Desk — Web UI

Static website for the CA2 Clinical Trial Eligibility Matching Desk. No build step, no backend:
the agents (A1 intake, B2 retrieval, B3 rule tool, B4 exclusions, A2 manager, B5 auditor, A7 human loop)
are ported to JavaScript in `agents.js` and run in the browser on the same 10 synthetic patients
and 13 TRIAL01 clauses as the Python code. Result: 100% verdict accuracy, 100% clause citation,
100% audit pass, 100% retrieval recall.

| File | Role |
|---|---|
| `index.html` | Shell + navigation |
| `styles.css` | Palette and layout (responsive, phone-friendly) |
| `data.js` | Patients (`patients.json`) and protocol clauses (`protocols/*.md`) |
| `agents.js` | JS port of the agent pipeline |
| `app.js` | Screens: Live pipeline · Coordinator review · Evaluation · Architecture |

## Run locally
Open `index.html` in a browser, or: `python -m http.server 8000 -d docs` → http://localhost:8000

## Host on GitHub Pages
1. Commit and push the `docs/` folder.
2. GitHub repo → Settings → Pages → Source: *Deploy from a branch* → branch `Atharwa` (or `main`), folder `/docs` → Save.
3. Site goes live at `https://sparky1445.github.io/AgenticAI/`.

Netlify / Vercel: drag-and-drop the `docs` folder, or set the publish directory to `docs` with no build command.

> Academic demonstration only. All patients are synthetic. Not medical advice.

## Optional LLM mode (hybrid RAG)
Off by default. Turn it on from the **LLM mode** switch in the top bar (gear icon → pick Google Gemini,
OpenAI or Anthropic Claude and paste your API key — it is stored only in your browser).

When on, every **newly added patient** gets:
1. **LLM query expansion** — the LLM writes extra search queries from the raw summary, run through the same TF-IDF index.
2. **LLM re-ranking** — every clause gets a 0–1 relevance score + reason; hybrid score = 50% TF-IDF + 50% LLM.

The LLM never removes a clause and never decides eligibility (rule tool + decide() + auditor still do).
Any error falls back to plain TF-IDF. Python equivalent: `python main.py add "<summary>" --llm`
with `LLM_PROVIDER`, `LLM_API_KEY` (and optional `LLM_MODEL`) set — see `Atharwa/llm_retrieval.py`.
