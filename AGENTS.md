# AGENTS.md

## What this is
To the Flag (working name): a what-if tool for F1 title fights. The owner sets results for the
remaining sessions and sees the final WDC table, the paths to the title, and (later) model odds.
It also serves JSON feeds to the owner's streaming overlay (LiveOverlay Studio, port 3000).
Personal, local-first tool: no accounts, no hosting.

## Current status
No code yet. Phase 0 (data) happens in the separate `F1GStats` repo (Python fetcher).
Do not scaffold anything here until the owner says Phase 1 starts.

## Read first, in this order
1. `SPEC.md`: product, domain rules, data contract, phases, decisions.
2. `DESIGN.md`: visual rules and tokens.

If code and documents disagree, follow the documents and ask the owner.

## Stack and commands (from Phase 1)
Bun + TypeScript, Elysia (API), Tailwind v4 (web), `bun:sqlite`.
Phase 1 must provide these scripts with exactly these names:
- `bun install`
- `bun run dev`
- `bun test`
- `bun run typecheck`

## Planned layout
- `engine/`: pure functions (points, standings, countback, Path Solver, later Monte Carlo)
- `api/`: Elysia routes, including `/api/feed/*` for the overlay
- `web/`: what-if UI
- `tests/fixtures/`: small hand-made season data for rule tests

## Hard rules
- `engine/` is pure: no imports from Elysia, the DOM, or `fs`; plain data in, plain data out.
- Never write to `f1gstats.sqlite`. Open it read-only. Scenarios go in `to-the-flag.sqlite`.
- Check `meta.schema_version >= 2` when opening the data file; refuse to run otherwise.
- Never hardcode round count, driver count, sprint weekends, or team colors. Derive from data.
- Use only tokens from `DESIGN.md`. No raw hex in components. Fonts are self-hosted.
- "Possible?" (no model) and "Likely?" (Monte Carlo) stay visually separate.
- Never show 0% or 100% from simulation; show `<1%` / `>99%`. Label simulated numbers "Model estimate".
- `PORT` (default 3100) and `HOST` (default 127.0.0.1) come from env. Never hardcode `localhost` in URLs.
- No secrets in the repo. Do not commit `.sqlite` files or `.env`.

## How to work
- One phase at a time, in the order given in `SPEC.md`. Do not add features from later phases.
- Write the rule tests (points tables, shortened races, countback) before the engine code.
- Small commits with clear messages. Run `bun test` and `bun run typecheck` before saying "done".
- If a rule is ambiguous, ask the owner instead of guessing.