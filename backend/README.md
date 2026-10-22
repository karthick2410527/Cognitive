# Cognimetric v2 — backend

An adaptive cognitive assessment engine built to the eleven-document v2 specification. Items are
authored under constraint by an LLM, then the application validates, solves, renders, banks and
adaptively serves them. The LLM is a content author; the engine is the psychometrician, solver,
renderer and judge; PostgreSQL is the calibrated bank.

> **This engine produces scores, not diagnoses.** No normative sample exists yet, so the report
> uses the "no normative sample" claim language (Doc 10 §6).

## Quick start

Requirements: Node 20+, PostgreSQL 16+ with `pgvector` and `pgcrypto` (Postgres.app includes both).

```bash
cd backend
npm install
cp .env.example .env          # defaults work for local development
npm run setup                 # create database, migrate, seed the bank (no API key needed)
npm run dev                   # API on :4000 + workers
```

| Command | What it does |
|---|---|
| `npm test` | Vitest: core invariants, engine units, P3 visual gate, DB integration incl. throwaway sixth plugin (uses `cognimetric_test`) |
| `npm run typecheck` | Type-checks `core/` and the server |
| `npm run seed -- --k 6` | Seed every bank cell to K items through the full 5-gate pipeline |
| `npm run simulate -- 2000` | Doc 05 §9 simulation suite against the live bank's parameters |
| `npm run simulate:client -- http://localhost:4000/v2` | Drive a full session over HTTP with a synthetic test-taker |
| `npm run exemplars` | Rebuild L3 exemplar files from the plugin authors (solver-verified) |
| `npm run db:reset` | Drop, recreate and migrate the development database |

Set `LLM_PROVIDER=gemini` and `GEMINI_API_KEY` to generate with a real model; everything else is unchanged.

## Layout

`core/` is published as the `@cognimetric/core` package and is also consumed by `../frontend`: the
same deterministic renderer draws what the validator solved (Doc 01 §4.6).

```
core/           Item Protocol + Zod schemas, plugin SDK, seeded PRNG, deterministic SVG renderer,
                matrix rule taxonomy / independent solver / fair-tree distractors / context-blind
                solver / canonical hashing, trial sequencer, robust statistics. Shared by server and web.
plugins/<id>    manifest.json, brief.md, research.md, exemplars/, author/, solvers/, validators/,
                renderers/, expanders/, scoring/, calibration/   (memory, attention, executive,
                language, processing_speed)
src/            API (/v2), session runtime, adaptive engine (staircase → EAP/2PL, max-information-
                balanced selection, Sympson–Hetter, stopping rules), 4-layer prompt assembly and
                governance, providers (gemini, local), W2 validation pipeline, workers W1/W3/W4
scripts/        setup, seeding, exemplar builder, simulation suite, synthetic HTTP client
test/           Vitest suites and the throwaway-plugin fixture
data/lexicon    Per-locale lexical service data (APPROXIMATE placeholder norms — see below)
```

Adding a domain: drop a folder into `plugins/` and restart. The registry asserts the contract at
boot (weights, levers, anchors, modules, exemplars, solver/auto-promote rule) and names the plugin
and assertion on failure. CI proves this with a throwaway plugin (`test/fixtures`).

## What is implemented, by document

- **Doc 01** — modular monolith + workers; full schema (plus `item_rejections`, `block_submissions`,
  `cell_breakers`, `provider_status`, `lever_models`); Tier A/B/C serving with substitution distance;
  idempotent responses; resumable sessions; API with `engine_version` + `trace_id`.
- **Doc 02** — L0 verbatim; L1 compiled from manifest + brief and hash-checked at boot; L3 exemplars per
  band; L2 from enumerations only (injection-safe); stable prefix ordering; repair turn for structural
  failures only; shortfall retries; per-cell circuit breaker; daily spend cap; probation for new
  prompt versions.
- **Doc 03** — manifest schema, nine hooks, anchored-interpolation lever policy, registry assertions.
- **Doc 04** — closed rule taxonomy, independent solver, engine-owned fair-tree distractors,
  context-blind gate (12.9 % on 500 matrices in CI; gate ≤ 20 %), canonical hash + 768-d structural
  embedding (pgvector, cosine ≥ 0.93), deterministic SVG in default / high-contrast / large variants.
- **Doc 05** — four-block plan as data, staircase for the first two responses then EAP on a 61-point
  grid (MLE stored for diagnostics), MIRT loadings, blocks folded in as normal observations,
  selection, all stopping rules, cross-session probes, report with intervals and no composite.
- **Docs 06–09** — 3 task types per plugin (15 total), each with author, solver, scoring; SATO
  control; d′ with lures; difference scores; simple-RT motor baseline; timing harness (double-rAF
  onset, event timestamps, long-task / focus monitoring, per-trial verdicts, device calibration,
  server cross-checks).
- **Doc 10** — reject telemetry, review rubric, accessibility substitution principle, report
  suppression, claim language.

## Plugin design docs

Each plugin has a short design note, `plugins/<id>/doc.md` (what it tests, how questions are asked, Easy → Hard
levers, references), shown in the app at `/docs`. `test/pluginDocs.test.ts` fails if a doc and its manifest
disagree (task types, lever names). `npm run docs:docx` exports them to `../docs/plugins/*PluginDocs.docx`.

## Known limitations (read before using any result)

- **Lexical norms are placeholders.** `data/lexicon` values are hand-estimated, not SUBTLEX /
  Kuperman / Brysbaert. Replace before calibration.
- **Exemplars are solver-verified, not human-reviewed.** Each file says so; Doc 03 §8 step 5 applies.
- **Timed-block norms (μ, σ) are provisional** and flagged on every block score.
- **Simulation gate P2 does not pass yet**: recovery RMSE ≈ 0.52 (target < 0.35) at K≈6–8 per cell,
  uncalibrated parameters and ~7 items per domain. Bias and SE calibration pass.
- **Audio**: only memory has an audio task type (synthetic sounds, `audio_recognition_forced_choice`);
  vision-impaired profiles still report attention, executive function etc. as "not measured".
- **Not built**: integration/embedding perceptual organisation and ternary
  relations in matrices, dual-task, production (ASR) naming, DIF screening, MIRT joint refit.
- **Queue**: generation jobs use Postgres (`FOR UPDATE SKIP LOCKED`) rather than Redis/BullMQ.
- **Content variety**: flanker, interference and choice-RT block specs have few distinct contents,
  so their cells hit the near-duplicate gate and circuit breakers; their bank depth is below K_min.
