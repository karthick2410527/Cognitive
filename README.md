# Cognimetric v2

An adaptive cognitive assessment engine built to the eleven-document v2 specification, split into two
projects:

| Folder | What it is | Run |
|---|---|---|
| [`backend/`](backend/README.md) | Node/TypeScript API, workers W1–W4, PostgreSQL schema, the five domain plugins, lexicon data, and the shared `core` package (Item Protocol, solver, deterministic renderer) | `cd backend && npm install && npm run setup && npm run dev` |
| [`frontend/`](frontend/README.md) | React app: onboarding, task runners and timing harness, report, admin console | `cd frontend && npm install && npm run dev` |

Start the backend first (API on :4000), then open http://localhost:5173.

> This engine produces scores, not diagnoses. See `backend/README.md` → "Known limitations".
