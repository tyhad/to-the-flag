# Phase 5: WCC Path Solver ("Possible?" for constructors)

Branch: `phase-5-wcc`. One commit per step. Tests first wherever there is logic. Read `docs/PHASE_1.md` (the driver solver this copies), `SPEC.md` (sections 4, 8 F2, 9, 12), `DESIGN.md`, `docs/PHASE_2.md` (UI and feed) and `AGENTS.md`.

**Scope:** the same exact, model-free answers the driver title already has, for the constructors' title: status, a path (what has to happen), a CLI report, feed routes, status tags in the WCC table, and a "Constructors" view in the "Possible?" tab.
**Not in Phase 5:** changes to the odds model ("Likely?" already covers teams, decision D27), LAN mode, multi-season prior, joint feasibility of several rival teams.

## Decisions (all approved)

| # | Decision | Recommendation |
|---|---|---|
| D34 | What a team "wins" in a session, and the baseline | The extreme case for a team is a **one-two**: its active cars finish P1 and P2. When it does not win, the best it can do is P2 and P3 (someone else wins). The measure is **`minOneTwos`**: the fewest one-twos (races first, then sprints, in calendar order) such that the team ranks first, with P2 and P3 in the rest and everyone else unspecified. A rival team's pace limit is the best pair of places its cars may take in every session once the team has the one-twos: P3-P4, P5-P6, P7-P8, P9-P10, or outside the points. **Approved.** |
| D35 | Where it lives in the UI | A "Drivers / Constructors" switch inside the "Possible?" tab (default Drivers). The WCC table gets the same status tags the WDC table has. **Approved.** |
| D36 | Feed | Two new routes: `/api/feed/team-status` and `/api/feed/team-path/:team`. The existing routes do not change. **Approved.** |

## What exists (verified on a fresh clone of `main` @ `9df8e99`)

- 1095 tests pass, 2 skipped, 0 fail; typecheck clean; build emits `dist/oddsWorker.js`.
- Driver side to copy: `engine/status.ts` (`driverStatus`, `witnessScenario`), `engine/solver.ts` (`solveWdc`, `paceLimit`, `PathResult`), `engine/report.ts` (`buildCheckReport`), `web/viewModel/path.ts`, `web/components/PathPanel.tsx`, `api/routes/feed.ts`.
- `computeConstructorStandings` already scores teams (both cars, countback summed over the cars). Points follow each result row's `team`; points from a **locked** session go to the driver's **latest** team. `teamAt` in `engine/standings.ts` is internal.
- The WCC tab of the table has **no status tags yet** (`constructorRows` in `web/viewModel/tower.ts`).
- `engine/` rules (`tests/enginePurity.test.ts`): flat files, imports only `./name`, no `Math.random`, `Date.now`, `new Date(`, `process`, `Bun`, `document`, `window`, `localStorage`, `fetch`, `console`.

## The math (so nobody has to guess)

- **Dominance:** if a team's cars finish P1 and P2 in every open session, that is never worse for the team than any other arrangement. Swapping its cars into the top places only moves other drivers down (they score the same or less), and the team's countback improves (more first and second places). So, like the driver title, a team can be champion **if and only if** it ranks first in the witness "its active cars take P1 and P2 in every open session, everyone else unspecified" (decision b: unspecified drivers score 0).
- **Cars:** a team's cars are its active drivers (present in the latest completed round) by their **latest** team. Normally two. With one car the team can only take P1 (the maximum drops to 25 per race, 8 per sprint).
- **Maximum per session:** race 25 + 18 = 43, sprint 8 + 7 = 15 (for two cars).
- **Fillers:** in the witness, P3 to P10 must be taken by drivers who cannot hurt the team: active drivers on teams that are themselves eliminated. A race needs 8 of them. `exact` is true when at least 8 exist; otherwise the result is optimistic and says so.
- **Statuses:** `eliminated` when the team does not rank first in its own witness; `clinched` when it can be champion and no other team can; `alive` otherwise. A team with no active cars is always eliminated.

Real data check (the Round 16 fixture, 8 sessions left: 7 races + 1 sprint): Mercedes 556, Ferrari 405, McLaren 316, Red Bull 298, then RB 90, Alpine 68, Haas 27, Audi 17, Williams 12, Aston Martin 7, Cadillac 0; the sum is 1796. Four teams are alive, seven eliminated. Every team can still score 316 (7 × 43 + 15). Drivers on eliminated teams: 14, so `exact` is true. Expected from a prototype: Ferrari needs 152 points (556 − 405 + 1), McLaren 241, Red Bull 259; with every rival scoring nothing, Ferrari and McLaren need **0** one-twos (P2 and P3 everywhere is 244 points) and Red Bull needs **2** (two races as one-twos lift 244 to 264); Mercedes, the leader, needs 166 more points to be safe against every rival scoring the maximum (Ferrari's 721 − 556 + 1).

## Layout added in this phase

```
engine/    teams.ts  teamStatus.ts  teamSolver.ts     (flat, pure; exported from index.ts)
web/       viewModel/teamPath.ts  components/TeamPathPanel.tsx
```

## Steps

### Step 1: Cars and the team witness

**Goal:** the building blocks.

**Change (`engine/teams.ts`):**
- `teamCars(state)`: a map from team id to its active cars, ordered by current driver points (highest first), then driver code.
- `teamSessionMax(cars, kind)`: the points of the top `cars` places (43 and 15 for two cars).
- `teamWitnessScenario(state, scenario, team, offset = 0)`: the scenario plus the team's cars on P(1 + offset), P(2 + offset), … in every remaining session the scenario does not lock. Existing locks stay. Does not modify its inputs.

**Tests first (hand-made with `makeState`):** cars exclude inactive drivers; a driver follows their latest team after a mid-season change; ordering; `teamSessionMax` for 1 and 2 cars; the witness locks only open sessions and keeps the scenario's locks; `offset: 1` gives P2 and P3.

**Commit:** `feat(engine): team cars and witness`

### Step 2: Team status

**Goal:** `clinched | alive | eliminated` per team, exactly.

**Change (`engine/teamStatus.ts`):** `teamStatus(state, scenario?)` returns `{ team, status, points, maxPossible, gapToLeader, pointsToClinch }` per team in projected table order, built on `computeConstructorStandings` and `teamWitnessScenario`. `pointsToClinch` follows the driver rule: 0 when clinched, `null` when eliminated, otherwise the highest rival `maxPossible` minus the team's points plus 1 (at least 1). Throws `InvalidScenarioError` for a bad scenario.

**Tests first:** a 3-team case with one clinched, one alive, one eliminated; a countback tie decided by the combined counts of both cars; a lock that changes a status; a one-car team's maximum; an inactive-only team is eliminated; invariants (someone can always still be champion; clinched means all others are out); inputs are not modified. The real fixture: 4 alive, 7 eliminated, nobody clinched, every `maxPossible − points` is 316, points sum to 1796.

**Commit:** `feat(engine): team title status`

### Step 3: Team path solver

**Goal:** the "Possible?" answer for a team.

**Change (`engine/teamSolver.ts`):** `solveWcc(state, team, scenario?) → TeamPathResult`
```ts
interface TeamPathResult {
  team: string;
  verdict: "clinched" | "alive" | "eliminated";   // same as teamStatus
  exact: boolean;               // at least 8 active drivers on eliminated teams
  points: number; maxPossible: number;
  pointsNeeded: number | null;  // strict: highest other team's points - points + 1, floor 0; null if eliminated
  difficulty: number | null;    // pointsNeeded / what the team can still score, 0..1
  minOneTwos: { total: number; races: number; sprints: number } | null;
  rivalBudgets: { team: string; budget: number; paceLimit: number | null }[];
  easiest: Scenario | null;     // the minOneTwos witness merged with the scenario
}
```
- **minOneTwos:** scan `w` from 0 up; in the first `w` open sessions (races first, then sprints, calendar order) the cars take P1.., in the rest P2..; the first `w` where the team ranks first in `computeConstructorStandings` wins. `null` if none.
- **rivalBudgets** (if the team has the one-two in every open session): for each other team that is not eliminated, `budget = maxPossible − rival points − 1`. `teamPaceLimit(budget, races, sprints)` returns the first place of the best pair the rival may take in every session: the smallest of 3, 5, 7, 9 whose pair points, summed over the sessions, fit in the budget; 11 means outside the points; `null` when the budget is negative.
- Same conservative limits as the driver solver: rival budgets are independent, and ties settled by countback are not relied on.

**Tests first:** one clear case per output; `minOneTwos` where a countback tie matters; races before sprints; a one-car team; `exact = false` with fewer than 8 fillers; `teamPaceLimit` boundaries (negative budget, 0, one pair step, sprints with fewer scoring places); `easiest` passes `validateScenario` and, run through `computeConstructorStandings`, ranks the team first; verdict equals `teamStatus`; an eliminated team has `null` path fields; an unknown team throws `RangeError`; inputs are not modified.
Real fixture: Ferrari needs 152 (`minOneTwos` 0), McLaren 241 (0), Red Bull 259 (2 races, 0 sprints).

**Commit:** `feat(engine): team path solver`

### Step 4: Check report and CLI

**Goal:** see it on the real data.

**Change:** `buildCheckReport` (in `engine/report.ts`) also returns the WCC table with statuses and, per contender team, the `TeamPathResult`; `formatCheckReport` prints a WCC table and a "Paths to the constructors' title" section. `scripts/check.ts` gets `--team ID` (any team id, also an eliminated one, case-insensitive; unknown is an error with the list of valid ids). `--json` includes the new parts. Existing output for drivers does not change.

**Tests first:** the report shape, `--team`, unknown team error, the JSON round trip, the text for a leader (clinch copy, not "needs 0") and for an eliminated team.

**Check:** `bun run check` on the real database prints a WCC table that matches the constructor standings and statuses that make sense.

**Commit:** `feat(cli): constructors table and paths in check`

### Step 5: Feed

**Goal:** the overlay can read it.

**Change:** `GET /api/feed/team-status` (rows: `rank, team, name, points, status, max_possible, gap_to_leader, points_to_clinch`, plus the usual `updated_at`, `as_of_round`, `data_status`, `season`, and the flattened `top1_*` fields) and `GET /api/feed/team-path/:team` (404 for an unknown team id). Both honor the active scenario like the driver routes do (including D26: an active scenario that no longer fits is ignored). Update `docs/FEED.md`.

**Tests first:** shape; flattened fields agree with the arrays; 404; the output changes after activating a scenario; same 503 behavior as the other routes.

**Commit:** `feat(api): team status and team path feed`

### Step 6: Status tags in the WCC table

**Goal:** the WCC tab says who is alive.

**Change (`web/viewModel/tower.ts`):** `constructorRows` fills `status` from `teamStatus`, with the same "long shot" rule as drivers (gap at least two thirds of what the team can still score, using the team maxima). No tag for a team with no active car. Components stay as they are.

**Tests first (view-model):** each status, a long shot, the tag copy, a clinched team, and a scenario that changes a status.

**Commit:** `feat(web): constructor status tags`

### Step 7: Constructors in "Possible?"

**Goal:** the team path, in plain words.

**Change:**
- A "Drivers / Constructors" switch at the top of the "Possible?" tab (reuse `Tabs`); the choice survives a switch to "Likely?".
- Workspace state gets the chosen team (default: the team in second place if alive, else the first alive one).
- `web/viewModel/teamPath.ts` (pure) and `web/components/TeamPathPanel.tsx`: team select (alive teams first, then the rest), verdict headline, difficulty meter (reuse `DifficultyMeter` and the bands in `web/config.ts`), `minOneTwos`, rival budgets, the `exact` note, and "Load easiest path into sandbox".
- Loading a team's path puts its two cars into the contender list (up to the existing maximum of 8) so the picker shows the locks; if the list is full, say so in plain words and keep what fits.
- Copy:
  - eliminated: "{Team} cannot win the constructors' title any more."
  - alive: "{Team} can still win the constructors' title."
  - clinched: "{Team} has clinched the constructors' title."
  - the leader while still alive: "{Team} lead. {n} more points clinch the constructors' title, if every rival scores the maximum." (never "needs 0")
  - needs: "Needs at least {n} one-twos ({races} races, {sprints} sprint) if every rival scores nothing." and for 0: "No one-twos needed: P2 and P3 in every session is enough if every rival scores nothing."
  - rival budget: "If {Team} finish 1-2 in every remaining session, {Rival} can score at most {budget} more points, and never better than P{p} and P{p+1} in every session." For 11: "outside the points in every session"; for a negative budget: "cannot be beaten this way".
  - `exact = false`: "Estimate: too few other drivers are left to fill the points positions."
- "Possible?" shows no probabilities anywhere; "Likely?" is unchanged.

**Tests first (view-model):** the copy for each verdict, the budget phrasing at p = 3, 5, 7, 9, 11 and a negative budget, band selection, default team, loading `easiest` adds the cars to the contenders (and the full-list case), and the loaded scenario passes `validateScenario`.

**Check:** on the real data, pick Ferrari: the numbers agree with a hand calculation (points needed = leader's points − Ferrari's points + 1). For the leader the panel shows the clinch copy.

**Commit:** `feat(web): constructors in possible`

### Step 8: Polish and docs

**Change:** keyboard walkthrough of the new switch, select and button (visible focus, tab order); layout at 1920×1080 and 1280 wide; the `DESIGN.md` checklist (section 11); `docs/PHASE_5.md` marked as built; README and `docs/FEED.md` current; `SPEC.md` phase table and decisions updated; `AGENTS.md` status updated.

**Commit:** `chore: constructors polish and docs`

## Phase 5 is done when

1. In a fresh clone **without** any extra files, `bun test` and `bun run typecheck` pass and `bun run build` works.
2. Invariants hold in tests: someone can always still be champion; clinched means every other team is eliminated; an eliminated team has `null` path fields; `easiest` always ranks its team first.
3. `bun run check` on the real database prints a WCC table and team paths that agree with the constructor standings and with a hand calculation for one team.
4. `/api/feed/team-status` and `/api/feed/team-path/:team` return the documented shapes.
5. The WCC table shows status tags, and the "Possible?" tab has a working Constructors view, offline.
6. The `DESIGN.md` checklist passes; `SPEC.md` and `AGENTS.md` are updated.

Then open a pull request `phase-5-wcc` → `main` and merge.

## Known limits (deliberate)

- Rival budgets are independent: two rival teams cannot both take P3-P4, and that is not checked.
- `exact` needs at least 8 active drivers on eliminated teams (a race has eight places behind a one-two). Early in the season the result is optimistic and says so.
- Teams with one active car are handled, but a rival's pace ladder always assumes two cars.
- Drivers' points from a locked session go to their latest team (as in the standings), so a team change after the last completed round is not modeled.
