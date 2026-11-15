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
