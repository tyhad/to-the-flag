# AGENTS.md

## What this is
To the Flag (working name): a what-if tool for F1 title fights. The owner sets results for the
remaining sessions and sees the final WDC table, the paths to the title, and model odds.
It also serves JSON feeds to the owner's streaming overlay (LiveOverlay Studio, port 3000).
Personal, local-first tool: no accounts, no hosting.

## Current status
Phases 0 (data, in the separate `F1GStats` repo), 1 (engine), 2 (API, web UI, overlay feed) and 3 (Monte Carlo odds: the "Likely?" tab, `/api/feed/odds`, the backtest and the model card) are done.
There is no active task list. Ask the owner what comes next. Ideas and known weaknesses are in `docs/MODEL.md` (the model loses to "points so far" at predicting a single race) and `docs/PHASE_3.md` ("Known limits").

## Read first, in this order
1. `SPEC.md`: product, domain rules, data contract, phases, decisions.
2. `DESIGN.md`: visual rules and tokens.
3. `docs/PHASE_2.md` and `docs/PHASE_1.md` describe the finished web UI, feed and engine; read them for behavior and limits. `docs/FEED.md` documents the overlay feed.
4. `docs/PHASE_3.md` (the odds task list, as built) and `docs/MODEL.md` (the model card: parameters, backtest results, limits). Read `docs/MODEL.md` before changing anything in the odds model.

If code and documents disagree, follow the documents and ask the owner.

## Stack and commands (from Phase 1)
Bun + TypeScript, Elysia (API), Tailwind v4 (web), `bun:sqlite`.
Phase 1 must provide these scripts with exactly these names:
- `bun install`
- `bun run dev`
- `bun test`
- `bun run typecheck`
- `bun run check`: prints season status and paths from the real data file
- `bun run build`: bundles the web UI into `dist/` (the page and the odds worker, `dist/oddsWorker.js`)
- `bun run backtest`: walk-forward test of the odds model (`scripts/backtest.ts`); rerun it after any change to the model and update `docs/MODEL.md`

## Planned layout
- `engine/`: pure functions (points, standings, countback, Path Solver, and the Monte Carlo odds: `strength`, `simulate`, `odds`, `rng`)
- `data/`: read-only loader for `f1gstats.sqlite` (the only place besides `scripts/` that touches the database)
- `scripts/`: CLI tools (`check.ts`, `exportFixture.ts`, `addClassified.ts`, `backtest.ts`)
- `api/`: Elysia routes, including `/api/feed/*` for the overlay
- `web/`: what-if UI (`components/`, `viewModel/` for the testable logic, hooks, and `oddsWorker.ts`, which is bundled as its own file)
- `shared/`: small pure helpers used by both server and browser (scenario share codec)
- `tests/fixtures/`: small hand-made season data for rule tests

## Hard rules
- `engine/` is pure: no imports from Elysia, the DOM, `fs`, or `bun:sqlite`; plain data in, plain data out. Only `data/` and `scripts/` read files or the database.
- Never write to `f1gstats.sqlite`. Open it read-only. Scenarios go in `to-the-flag.sqlite`.
- Check `meta.schema_version >= 2` when opening the data file; refuse to run otherwise.
- Never hardcode round count, driver count, sprint weekends, or team colors. Derive from data.
- Use only tokens from `DESIGN.md`. No raw hex in components. Fonts are self-hosted.
- Team colors come only from `teamColor()` in `web/theme/teams.ts`. Never type a team hex anywhere else.
- "Possible?" (no model) and "Likely?" (Monte Carlo) stay visually separate.
- Never show 0% or 100% from simulation; show `<1%` / `>99%`. Label simulated numbers "Model estimate".
- Odds code lives in flat files in `engine/`, uses only the seeded `createRng` (never `Math.random`), and formats every probability through `formatProbability`.
- `PORT` (default 3100) and `HOST` (default 127.0.0.1) come from env. Never hardcode `localhost` in URLs.
- The browser never touches SQLite. It gets one `SeasonState` from `/api/season` and runs the engine locally.
- The web UI makes no external network requests; fonts and assets are bundled.
- No secrets in the repo. Do not commit `.sqlite` files or `.env`.

## How to work
- One phase at a time, in the order given in `SPEC.md`. Do not add features from later phases.
- Write the rule tests (points tables, shortened races, countback) before the engine code.
- Small commits with clear messages. Run `bun test` and `bun run typecheck` before saying "done".
- Tests must not depend on `../F1GStats/f1gstats.sqlite`. Build databases with `tests/dbHelpers.ts` (`buildDb`, or `buildFixtureDb` for the Round 16 season).
- A test that opens a scenario database (`ttfDbPath`) uses its own file per test (see `tests/oddsFeed.test.ts`). The owner works on Windows, where an open SQLite file cannot be deleted, so a shared file leaks one test's scenarios into the next.
- Logic that can be tested without a browser goes in `web/viewModel/` or `engine/`, with tests; components stay thin. For anything visual, say what was checked in a real browser and what was not.
- If a model default changes, say why in `docs/MODEL.md` and update the tests that pin it (`tests/strength.test.ts`, `tests/simulate.test.ts`, the golden snapshot in `tests/odds.test.ts`).
- If a rule is ambiguous, ask the owner instead of guessing.