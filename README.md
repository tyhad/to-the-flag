# To the Flag
Alternative title-fight what-if tool for F1. Read SPEC.md and DESIGN.md first.

## Commands
Requires [Bun](https://bun.sh).

| Command | What it does |
|---|---|
| `bun install` | Install dependencies |
| `bun run dev` | Run `scripts/check.ts` in watch mode |
| `bun test` | Run all tests |
| `bun run typecheck` | Type-check the whole project (`tsc --noEmit`) |
| `bun run check` | Print season status and paths from the real data file |
| `bun scripts/verifyStandings.ts [db]` | Check the engine's base table equals F1GStats `driver_standings` (order and points) |
| `bun scripts/exportFixture.ts <db> <out.json>` | Snapshot the loaded season as a JSON test fixture |

## Configuration
Copy `.env.example` to `.env` and adjust. All values are optional.

| Variable | Default | Meaning |
|---|---|---|
| `F1GSTATS_DB` | `../F1GStats/f1gstats.sqlite` | Path to the read-only F1GStats database |
| `PORT` | `3100` | Server port (used from Phase 2) |
| `HOST` | `127.0.0.1` | Server host (used from Phase 2) |
