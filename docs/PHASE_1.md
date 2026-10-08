# Phase 1: Engine core

**Status: all 7 steps done (pending merge).** Branch: `phase-1-engine`. One commit per step. **Tests first**: write the test, watch it fail, then implement.
Phase 0 is done (F1GStats `main` @ `ccd268b`). Read `SPEC.md` (sections 4, 7, 8) and F1GStats `docs/DATA_CONTRACT.md` before starting.

**Scope:** engine + read-only loader + a CLI check. **Not in Phase 1:** API, web UI, Monte Carlo, WCC Path Solver, dead heat, shortened-sprint scale.

## What exists (do not guess)

`f1gstats.sqlite`, `meta.schema_version = 2`, tables: `schedule_full`, `race_results` (Race + Sprint), `qualifying_results`, `data_health`, plus the old standings tables.

Snapshot of the real 2026 data as of Round 16 (use for sanity checks; these numbers change as the season goes on):

| Fact | Value |
|---|---|
| Rounds in schedule / sprint weekends / completed | 23 / 6 / 16 |
| `race_results` rows | 352 Race (16 × 22), 110 Sprint (5 × 22) |
| `qualifying_results` rows | 347 over 16 rounds (5 rows missing) |
| Drivers in standings / per round | 23 / 22 (one driver no longer races) |
| Constructors | 11 |
| Sum of driver points = sum of constructor points | 1796 |
| Remaining sessions | 7 races + 1 sprint = 8 |
| Max points still available | driver 7 × 25 + 8 = 183, team 7 × 43 + 15 = 316 |

## Layout

```
config.ts          env: F1GSTATS_DB, PORT, HOST
engine/            PURE: types.ts points.ts countback.ts scenario.ts sessions.ts standings.ts status.ts solver.ts index.ts
data/              impure edge: loadSeason.ts (bun:sqlite, read-only)
scripts/           check.ts, exportFixture.ts, verifyStandings.ts, statusReport.ts
tests/             *.test.ts, helpers.ts (makeState builder), fixtures/
```

Only `data/` and `scripts/` may import `bun:sqlite` or `fs`. Nothing under `engine/` may.

## Domain decisions for this phase

- **a. Active driver** = appears in the latest completed round's Race or Sprint results. Inactive drivers keep their points but cannot score in locks (error).
- **b. Unspecified drivers** in a locked session score 0 and count as outside the points zone. This equals assuming harmless fillers take the other positions, which holds when at least 9 active drivers are already eliminated (inactive drivers cannot fill positions). The solver reports `exact: false` otherwise.
- **c. Current points** are summed from `race_results` (Race + Sprint). The loader verifies they equal `driver_standings`; if not, throw `DataInconsistentError`.
- **d. Constructor points** use `constructor_id` on each result row (handles mid-season team changes).
- **e. Remaining sessions** = every `(round, race)` and `(round, sprint if has_sprint)` without result rows. If a round has `status = completed` but one of its sessions has no results, throw `DataInconsistentError`.
- **f. Countback** (FIA A2.1.4.c): compare the count of P1, then P2, then P3 … over **Race** results only (sprints excluded, config flag `includeSprint = false`); if still tied, the same on qualifying positions. A missing qualifying row means no placement that round. Constructors: same counts across both cars.
- **g. Scenario locks:** `fixed` maps driver → position inside the points zone (race 1–10, sprint 1–8) or `"out"`. A lock may carry `tier` (`lt25 | ge25 | ge50 | full`, default `full`) for a shortened race. A sprint lock means a completed sprint.

## Steps

### Step 1: Scaffold

**Goal:** an empty project that installs, typechecks, and tests.

**Change:**
- `bun init` (TypeScript, no framework), then `bun add -d typescript @types/bun`.
- `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `noEmit`, `module: ESNext`, `moduleResolution: bundler`, `target: ESNext`, `types: ["bun"]`.
- Scripts in `package.json`: `dev` = `bun --watch scripts/check.ts`, `check` = `bun scripts/check.ts`, `test` = `bun test`, `typecheck` = `tsc --noEmit`. Add a stub `scripts/check.ts` that prints "not implemented".
- `config.ts` reads `F1GSTATS_DB` (default `../F1GStats/f1gstats.sqlite`), `PORT` (default `3100`), `HOST` (default `127.0.0.1`). Add `.env.example` with these.
- `tests/config.test.ts`: defaults and env override (so `bun test` is not empty).
- Commit the lockfile Bun creates. Add the commands to `README.md`.

**Check:** `bun install`, `bun test`, `bun run typecheck` all pass.

**Commit:** `chore: scaffold Bun + TypeScript`

### Step 2: Points tables

**Goal:** the FIA tables as data, with tests.

**Change (`engine/points.ts`):**
- `type DistanceTier = "lt25" | "ge25" | "ge50" | "full"`.
- `GP_POINTS` (four columns), `SPRINT_POINTS`.
- `gpPoints(position, tier = "full")`, `sprintPoints(position)`, `sessionMaxPoints(kind)` (25 / 8), `teamSessionMaxPoints(kind)` (43 / 15), `zoneSize(kind)` (10 / 8).

**Tests first:**
- Every cell of the table in `DATA_CONTRACT.md` section 4.
- Column totals 16 / 52 / 79 / 101; sprint total 36.
- Positions beyond the zone return 0; positions < 1 or non-integers throw `RangeError`.

**Commit:** `feat(engine): FIA 2026 points tables`

### Step 3: Types, loader, fixtures

**Goal:** read the real data into plain objects, and make test data easy.

**Change:**
- `engine/types.ts`:
  ```ts
  type SessionKind = "race" | "sprint";
  type SessionKey = `${number}:${SessionKind}`;
  interface ResultRow { round: number; kind: SessionKind; driver: string; team: string; position: number; points: number }
  interface QualiRow { round: number; driver: string; position: number }
  interface RoundInfo { round: number; name: string; hasSprint: boolean; status: "completed" | "scheduled" }
  interface SeasonState {
    season: number; asOfRound: number;
    rounds: RoundInfo[]; results: ResultRow[]; qualifying: QualiRow[];
    drivers: { code: string; name: string; active: boolean }[];
    teams: { id: string; name: string }[];
    health: { status: "ok" | "warn" | "fail"; checkedAt: string };
  }
  interface SessionLock { fixed: Record<string, number | "out">; tier?: DistanceTier }
  interface Scenario { locks: Record<SessionKey, SessionLock> }
  ```
  `driver` is `driver_abbr`; `team` is `constructor_id`.
- `data/loadSeason.ts`: `new Database(path, { readonly: true })`. Throw `SchemaVersionError` if `meta.schema_version < 2`. Read the latest `data_health` row and return it as `health`. Apply decisions a, c, d, e. Throw `DataInconsistentError` on mismatch.
- `scripts/exportFixture.ts <db> <out.json>` writes the loader output to `tests/fixtures/season-2026-r16.json` (commit it; it is public data and small).
- `tests/helpers.ts`: `makeState(...)` builder for hand-made seasons (few drivers, few rounds) so tests stay readable.

**Tests:** loader on the real fixture gives `asOfRound = 16`, 8 remaining sessions (7 race + 1 sprint), 22 active and 1 inactive driver, sum of points 1796. Loader throws on schema version 1, on standings mismatch, and on a completed round missing a session.

**Commit:** `feat(data): read-only season loader and fixtures`

### Step 4: Standings and countback

**Goal:** locked results in, projected tables out.

**Change:**
- `engine/standings.ts`: `computeDriverStandings(state, scenario?)` and `computeConstructorStandings(state, scenario?)` return rows `{ id, points, basePoints, delta, rank, baseRank, counts }` sorted by rank. Locked sessions add points per decision g; unspecified drivers add 0 (decision b).
- `engine/countback.ts`: compare points, then P1 count, P2 count … (Race only), then qualifying counts. Locked race results count toward position counts.
- `validateScenario(state, scenario)` throws `InvalidScenarioError` for: a session that is not remaining, an unknown or inactive driver, a position outside the zone, a duplicate position within a session, or a lock on a session that already has results.

**Tests first (hand-made with `makeState`):**
- Points add up correctly for a locked race and a locked sprint.
- Tie on points broken by wins; sprint wins do not count; tie on all counts broken by qualifying.
- Constructor points follow `constructor_id` after a mid-season team change.
- A shortened-race lock (`ge50`) gives 19-14-12-…; each tier tested.
- Every `InvalidScenarioError` case.

**Check:** on the real fixture, the base table (no locks) equals `driver_standings` order and points.

**Commit:** `feat(engine): standings projection and countback`

### Step 5: Title status

**Goal:** `clinched | alive | eliminated` per driver, exactly.

**Change (`engine/status.ts`):** `driverStatus(state, scenario?)` returns `{ driver, status, points, maxPossible, gapToLeader, pointsToClinch }`. Remaining sessions are those without results and without a lock; locked points are already in `points`.
- **Eliminated:** in the witness scenario "X wins every remaining session, everyone else unspecified", X does not rank first (this includes countback).
- **Clinched:** for every rival R, in the witness "R wins every remaining session, the leader unspecified", R does not rank first.
- Otherwise **alive**.
- Both witnesses go through `computeDriverStandings`, so ties follow the countback rules. No second implementation of the rules.

**Tests first:** a 3-driver case with one clinched, one alive, one eliminated; a tie that only countback decides; locks that change a status; an inactive driver is always `eliminated`.

**Check:** on the real fixture, list the statuses and compare with the real championship picture. Sum of `maxPossible − points` for an active driver equals 183.

**Commit:** `feat(engine): title status`

### Step 6: Path Solver (WDC)

**Goal:** the "Possible?" answer, with no model and no probabilities.

**Why no DP:** if the target driver X wins every remaining session, that is never worse for X (swap X into P1 and the displaced driver loses points; countback only improves). So feasibility and the main numbers have closed forms, and the standings engine verifies them.

**Change (`engine/solver.ts`):** `solveWdc(state, driver, scenario?) → PathResult`
```ts
interface PathResult {
  driver: string;
  verdict: "clinched" | "alive" | "eliminated";
  exact: boolean;                 // true when ≥ 9 non-contender drivers exist (decision b)
  points: number; maxPossible: number;
  pointsNeeded: number | null;    // strict: biggest rival points − X points + 1, floor 0; null if impossible
  difficulty: number | null;      // pointsNeeded / remaining max for X, 0..1
  minWins: { total: number; races: number; sprints: number } | null;
  rivalBudgets: { driver: string; budget: number; paceLimit: number | null }[];
  easiest: Scenario | null;       // witness for minWins; can be loaded into the sandbox
}
```
- **Contenders** = active drivers not eliminated by status.
- **minWins:** smallest `w` such that the witness "X wins `w` remaining sessions (races first, then sprints, in calendar order), finishes P2 in the rest, everyone else unspecified" ranks X first. If none, `null`.
- **rivalBudgets** (if X wins every remaining session): `budget = (X.points + X max remaining) − R.points − 1`. This is conservative (ties through countback are not relied on). `paceLimit` is the smallest position `p` (1–10, 11 = outside the points zone) where `races × gpPoints(p) + sprints × sprintPoints(p) ≤ budget`; `null` if `budget < 0`. UI wording later: "R must not finish better than P{p} in every session".
- **difficulty** is a share of points, never a probability.

**Tests first (hand-made):** one clear case per output; a tie that only countback decides `minWins`; `exact = false` when contenders leave fewer than 9 fillers; the `easiest` scenario passes `validateScenario` and, run through `computeDriverStandings`, ranks X first.

**Check:** on the real fixture, `solveWdc` for each non-eliminated driver; the numbers agree with a quick hand calculation for one driver.

**Commit:** `feat(engine): WDC path solver`

### Step 7: CLI check

**Goal:** see everything on the real data.

**Change:** `scripts/check.ts [--db path] [--driver CODE] [--json]` loads the season and prints: data health, as-of round, remaining sessions, active and inactive driver counts, the WDC table with status, and for each contender the `PathResult` summary. `--json` prints the same as JSON (the shape Phase 2 will serve).

**Check:** `bun run check` on the real database prints a table whose points match F1GStats `driver_standings` and whose statuses make sense against the real championship.

**Commit:** `feat: check CLI`

## Phase 1 is done when

1. `bun test` and `bun run typecheck` pass.
2. `bun run check` on the real database shows health `ok`, as-of Round 16 (or newer), the correct remaining sessions, and a WDC table equal to F1GStats `driver_standings`.
3. No file under `engine/` imports `bun:sqlite`, `fs`, Elysia, or the DOM.
4. One scenario ("the leader wins every remaining session") checked by hand or in a spreadsheet equals the engine output.
5. `SPEC.md` phase table and decisions are updated, and `AGENTS.md` status reflects Phase 1.

Then open a pull request `phase-1-engine` → `main` and merge.

## Known limits (deliberate)

- Rival budgets are independent; joint feasibility of several rivals at once is not checked.
- `exact` is false when too few harmless fillers exist (early season).
- Dead heat and a shortened-sprint scale are not supported.
- "Active driver" assumes a driver who skips one round was not replaced; revisit if that happens.
- A weekend in progress (sprint done, race not) is supported by decision e, but only when the data file already contains the sprint results.
- WCC has projected standings (Step 4) but no status or solver yet.
- `minWins` assumes every other contender scores nothing from here, so it is 0 for most contenders mid-season. Use `rivalBudgets` for realistic limits.

## Implementation notes (as built)

Where the code adds to or fixes the text above:

- Extra files: `engine/sessions.ts` (session keys, `remainingSessions`, `activeDrivers`), `engine/scenario.ts` (`validateScenario`, `InvalidScenarioError` with a `code`), and the scripts `verifyStandings.ts` and `statusReport.ts`.
- `InvalidScenarioError` has one more case than listed: `invalid_tier`. A tier on a sprint lock is ignored (a sprint has one scale).
- Standings rows: `{ id, points, basePoints, delta, rank, baseRank, counts }`. `delta` = points - basePoints. `counts` = `{ race: number[], quali: number[] }` where index i is the number of finishes in position i + 1 (all positions, also outside the points zone). A full tie falls back to the id.
- Locks are credited to the driver's latest known team for constructors; qualifying rows without a result that round use the nearest known team.
- Status: inactive drivers are always eliminated. `clinched` = nobody else can be champion. `pointsToClinch` is conservative (highest rival `maxPossible` - points + 1; 0 when clinched; null when eliminated).
- Solver: `rivalBudgets` lists the other contenders only, in table order. `paceLimit` is exported for testing.
- `scripts/check.ts` shows `pointsToClinch` (not `pointsNeeded`) for the table leader, because the leader has nobody ahead and "needs 0" would mislead; a clinched leader prints "title clinched".
- `scripts/check.ts` exit codes: 0 ok, 1 error, 2 when `data_health` is `fail`. `--json` prints the `CheckReport` shape that Phase 2 will serve.
- `tests/enginePurity.test.ts` enforces "done" rule 3: engine files import only other engine files and use no runtime, DOM, network, clock or randomness.
