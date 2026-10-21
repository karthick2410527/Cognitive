# Cognimetric v2 — frontend

React 18 + Vite + Tailwind client for the Cognimetric engine: onboarding with an accessibility
profile, runners for every Item Protocol (single, encode → delay → retrieve, timed blocks,
delayed-recall capture), the client timing harness (Doc 09 §7), the session report, and the
authoring console (bank health, review queue with the six-question rubric, reject telemetry,
prompt versions, manual generation).

## Run

The backend must be running (see `../backend`). Then:

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173, proxies /v2 to API_URL (default http://localhost:4000)
```

`npm run build` type-checks and produces `dist/` for static hosting; serve it behind the same origin
as the API, or set the backend's `CORS_ORIGIN` to the frontend origin.

## Shared code

`@cognimetric/core` resolves to `../backend/core` (`file:` dependency, Vite alias, tsconfig path).
It supplies the Item Protocol types and the deterministic SVG renderer used for timed-block stimuli,
so the UI draws exactly what the backend validated. Nothing else from the backend is imported, and
only its own `node_modules` are used (including `zod`, the core package's one runtime dependency).

## Layout

```
src/api.ts            API client and unit types
src/timing/harness.ts double-rAF onset, event timestamps, long-task / focus monitoring, calibration
src/runners/          TimedBlock, ChoiceItem, ItemRunners (single, encode-delay-retrieve, probes), Fillers
src/pages/            Home, Start, Session, Report, Probes, admin/Admin
src/components/       Layout and UI primitives
```
