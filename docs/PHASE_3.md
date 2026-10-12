# Phase 3: Odds ("Likely?")

Branch: `phase-3-odds`. One commit per step. Tests first wherever there is logic. Read `SPEC.md` (sections 4, 7, 8 F3, 9), `DESIGN.md`, `docs/PHASE_1.md`, `docs/PHASE_2.md`, and `docs/FEED.md` before starting.

**Scope:** a season-only Monte Carlo model, its API feed, the "Likely?" tab with a form-weight slider, a backtest, and a model card.
**Not in Phase 3:** multi-season priors (`prior_carryover` stays reserved), starting-grid or track adjustments, WCC Path Solver, LAN mode, image export.

## Decisions (D20 to D24 approved)

| # | Decision | Recommendation |
|---|---|---|
| D20 | Unspecified drivers in a locked session | In "Likely?" they still race and finish where the model expects. In "Possible?" they score 0 (Phase 1 decision b). The UI says so in plain words. **Approved.** |
| D21 | How a DNF is handled | A result row with `classified = false` is a DNF. In the pace fit it has weight 0 (it does not make the driver look slow). In the simulation, a driver's retirement chance is their own record blended with the grid average (the average counts as 4 virtual races). Sprint chance = race chance × 0.5. **Approved.** |
| D22 | Where the simulation runs | In the browser, inside a Web Worker. The server runs the same engine code for the overlay feed. **Approved.** |
| D23 | Form-weight slider | Included. It scales how much this season's form matters (0% = all drivers equal, 100% = full form), so the audience can see how much the assumption moves the numbers. **Approved.** |
| D24 | Defaults (half-life, prior strength, sigma, DNF prior) | The values in `OddsParams` below, tuned only coarsely by the backtest (Step 10) and recorded in `docs/MODEL.md`. **Approved.** |

All decisions are settled; start with Step 1.

## What exists (verified on a fresh clone of `main` @ `8c86e3c`)

- Typecheck is clean; `bun run build` takes about 0.3 s and `dist/` makes no external requests.
- 667 tests in 38 files. On the owner's machine all pass. On a fresh clone **11 fail**: `tests/api.test.ts`, `tests/feed.test.ts` and `tests/scenarios.test.ts` read `../F1GStats/f1gstats.sqlite` (the live file). Step 1 fixes that.
- Hooks for this phase: `web/components/AnalysisRail.tsx` (the "Likely?" tab is disabled), `api/routes/feed.ts` (`/odds` returns `{ available: false }`), `scripts/build.ts` (one entry: `web/index.html`), `tests/dbHelpers.ts` (`buildDb`, `defaultSeed`), `engine/countback.ts` (`compareStanding`, `addPosition`, `emptyCounts`).
- **`ResultRow` has no DNF information.** The database has `is_classified`; the engine does not carry it. Step 2 adds it.
- Engine rules to respect (`tests/enginePurity.test.ts`): files stay flat in `engine/`, import only `./name`, and never use `Math.random`, `Date.now`, `new Date(`, or the words `process`, `Bun`, `document`, `window`, `localStorage`, `fetch`, `console`.

Real data on 2026-10-11 (`bun run check`): as of Round 16 with the Singapore sprint already in, 7 races left. ANT 325, RUS 236, HAM 221, LEC 197, VER 196, NOR 189; six alive, nobody clinched. The test fixture stays the Round 16 snapshot (8 sessions left).

## Findings from a throwaway prototype (not production code)

On the Round 16 fixture, with a Plackett-Luce fit and 10,000 simulated seasons:
- A naive version took about 0.65 s for 10k simulations × 8 sessions. The budget below leaves room.
- ANT won essentially every simulation (an 84-point lead with 8 sessions left). Expect ">99%" for ANT and "<1%" for most others. The interesting numbers appear once the owner locks results in the sandbox.
- Treating DNFs as last place pushed RUS (second in points) out of the top eight strengths. The fit must leave non-classified finishers out. Step 4 has a test for it.

## Layout added in this phase

```
engine/    rng.ts  strength.ts  simulate.ts  odds.ts      (flat, pure)
scripts/   addClassified.ts  backtest.ts
web/       oddsWorker.ts  useOdds.ts  components/OddsPanel.tsx  viewModel/odds.ts
docs/      MODEL.md
```

## Steps

### Step 1: Housekeeping

**Goal:** tests that pass anywhere, and the stale-scenario fix that SPEC decision D18 deferred.

**Change:**
- In `tests/api.test.ts`, `tests/feed.test.ts` and `tests/scenarios.test.ts`, replace `REAL_DB_PATH` with a database built by `buildDb()` from `tests/dbHelpers.ts`. Keep one optional "real database smoke" test that is skipped when the sibling file does not exist (`test.skipIf`).
- `PUT /api/scenarios/:id` (`api/routes/scenarios.ts`): when `locks` or `contenders` change, set `as_of_round` to the current round; a rename keeps it.

**Tests first:** a stale scenario stays stale after a rename and becomes current after a lock change.

**Check:** in a fresh clone **without** a sibling `F1GStats` folder, `bun test` has 0 failures.

**Commits:** `test(api): build databases from seeds instead of the real file`, `fix(api): refresh as_of_round when locks change`

### Step 2: Carry the DNF flag

**Goal:** the engine knows who was classified.

**Change:**
- `engine/types.ts`: `ResultRow.classified: boolean`.
- `data/loadSeason.ts`: read `is_classified`.
- `tests/dbHelpers.ts`: `SeedResult` gets an optional `classified` (default true). `tests/helpers.ts` (`makeState`) must be able to express a DNF.
- `scripts/addClassified.ts <db> <fixture>`: adds `classified` to every row of `tests/fixtures/season-2026-r16.json` by matching round, kind and driver against the database. Do **not** re-export the fixture: the database now contains later rounds and the fixture must stay the Round 16 snapshot. The script refuses to write if any row has no match.

**Tests first:** the loader maps `is_classified`; every fixture row has `classified`; at least one fixture row is `false`; all existing counts (352 race rows, 110 sprint rows, 8 remaining sessions) are unchanged.

**Commit:** `feat(data): carry the classified flag on result rows`

### Step 3: Seeded random numbers

**Goal:** deterministic randomness inside the pure engine.

**Change (`engine/rng.ts`):** `createRng(seed)` returning `next()` (uniform in [0, 1)), `gumbel()`, `normal()`; and `hashSeed(...parts: string[])` (a stable 32-bit hash, for example FNV-1a). Use a small generator such as mulberry32. No `Math.random`.

**Tests first:** the same seed gives the same sequence; different seeds differ; `hashSeed` has golden values; over 100k draws the mean of `next()` is about 0.5, the Gumbel mean is about 0.5772, and `normal()` has mean about 0 and standard deviation about 1; `next()` never returns 1.

**Commit:** `feat(engine): seeded random numbers`

### Step 4: Fit driver strengths and DNF rates

**Goal:** the model inputs, from this season only.

**Change (`engine/strength.ts`):** `fitStrengths(state, params)` returns `{ theta, effectiveRaces, dnfRate, roundsCompleted }`, all keyed by driver code.
- **Pace:** a Plackett-Luce fit on each race and sprint session that has results. Use only classified finishers, in finishing order (a non-classified result has weight 0, so a retirement never makes a driver look slow). Weight each session by `0.5^((asOfRound − round) / recencyHalfLife)`, times `sprintWeight` for sprints. Regularize with a prior: for example the MM algorithm with a dummy item of strength 1 that every driver beats once and loses to once, with weight `priorStrength`. Any equivalent regularized fit is fine if the tests pass. Normalize so the mean log strength is 0. A driver with no data gets 0.
- `effectiveRaces[d]`: the sum of session weights in which `d` was classified.
- **DNF rate (race sessions only):** `(Σ w · nonClassified + α · p̄) / (Σ w · appearances + α)`, where `p̄` is the weighted field rate and `α = dnfPriorSessions`.

**Tests first:**
- Synthetic recovery: simulate 20 races from known strengths with the seeded RNG; the fitted strengths have rank correlation ≥ 0.9 with the truth.
- Shrinkage: with 1 race the spread of strengths is smaller than with 16.
- A DNF does not lower pace: a driver with many non-classified results but fast classified ones has the same strength as in a variant where the DNF rows are removed.
- Recency: the same results in a different order give more weight to the later ones.
- A driver with no sessions: strength 0 and `effectiveRaces` 0.
- DNF rates lie in (0, 1) and sit near the field average when a driver has few sessions.
- The fit is deterministic.

**Note from implementation:** with `priorStrength = 1` the dummy-item prior is too weak for a 20-car field. One race gave a spread of strengths (sd 1.16) wider than a full season's (0.78), and the shrinkage test above could not pass. Measured over 20 seeds on synthetic seasons, a weight of 3 gives 0.46 after 1 race, rising steadily to 0.67 after 16 (true spread 0.73). The default is now **3**; rank order is unaffected by the prior. Step 10's backtest may retune it. `StrengthParams` (`recencyHalfLife`, `sprintWeight`, `priorStrength`, `dnfPriorSessions`) lives in `engine/strength.ts`; Step 5's `OddsParams` extends it.

**Commit:** `feat(engine): strength and DNF fit`

### Step 5: Simulate the rest of the season

**Goal:** the Monte Carlo core.

```ts
interface OddsParams {
  nSims: number;           // default 10_000
  seed?: number;           // default hashSeed(season, asOfRound, canonical scenario JSON, key params)
  formWeight: number;      // 0..1, default 1: theta' = formWeight * theta
  recencyHalfLife: number; // default 8 rounds
  sprintWeight: number;    // default 0.5
  priorStrength: number;   // default 3 (was sketched as 1; see the note under Step 4)
  strengthSigma: number;   // default 0.25: per-driver sigma = strengthSigma * sqrt(K / (K + effectiveRaces)), K = 6
  dnfPriorSessions: number;// default 4
  sprintDnfFactor: number; // default 0.5
  includeDnf: boolean;     // default true
}
```

**Change (`engine/simulate.ts`):** `simulateSeason(state, scenario, params)` returns win counts per driver and per team, plus summed final points for averages.
- Only active drivers race. Remaining sessions come from `remainingSessions(state)`.
- Per simulation: draw each driver's strength `theta' + sigma * normal()`.
- **Open session:** each driver retires with their DNF probability; finishers are ordered by Plackett-Luce (add Gumbel noise to the strength, sort descending); retirees go to the back in random order and score nothing.
- **Locked session (decision D20):** `fixed[d]` as a number places `d` at that position; `"out"` places `d` at the back with no points. All other drivers race as in an open session and fill the free positions in order. A lock's `tier` applies to a locked race.
- Points follow the engine's tables. WCC points go to each driver's latest team.
- **Champion:** most points; ties go through `compareStanding` using race-position counts from the state plus the simulated race positions (sprints excluded), then qualifying counts from the state (future qualifying is not simulated), then driver id. Apply the countback only when the top is tied.
- **Performance:** typed arrays, no per-simulation objects. Target under 1 s for 10k simulations on the real fixture; tests allow 3 s.

**Tests first (hand-made with `makeState`):**
- The same seed gives identical results.
- Win counts sum to `nSims` for drivers and for teams.
- A driver the engine calls eliminated never wins; a clinched driver always wins.
- With nothing left to run, the outcome is deterministic and equals the `computeDriverStandings` leader.
- Two identical drivers with no DNFs get equal chances within 3 standard errors.
- A much faster driver wins almost always; `formWeight: 0` makes all drivers equal.
- Locking X on P1 in every remaining session raises X's chance; marking X `out` lowers it (or leaves it at 0 or 100%).
- A fixed position appears in every simulation (a test hook or a statistic is enough).
- A countback tie at the top resolves like `computeDriverStandings`.

**Commit:** `feat(engine): season simulation`

### Step 6: Odds and probability formatting

**Goal:** one function the API and the UI both call.

**Change (`engine/odds.ts`):** `computeOdds(state, scenario?, params?)` returns:
```ts
interface OddsRow { id: string; wins: number; probability: number; display: string; avgPoints: number; status?: "clinched" | "alive" | "eliminated" }
interface OddsResult {
  asOfRound: number; roundsCompleted: number; lowConfidence: boolean;   // true when fewer than 5 rounds are complete
  nSims: number; seed: number; params: OddsParams;
  wdc: OddsRow[]; wcc: OddsRow[];    // drivers with wins > 0, or alive/clinched; sorted by probability
  maxStdError: number;               // max sqrt(p (1 - p) / nSims)
}
```
`formatProbability(p)`: `p < 0.01` gives `"<1%"`; `0.01 ≤ p < 0.10` gives one decimal (`"3.4%"`); `0.10 ≤ p ≤ 0.99` gives a whole percent (`"47%"`); `p > 0.99` gives `">99%"`. If one-decimal rounding reaches `10.0`, show `"10%"`. Never `"0%"` or `"100%"`.

**Tests first:** a `formatProbability` boundary table (0, 0.0049, 0.01, 0.0949, 0.0996, 0.10, 0.99, 0.9901, 1); `lowConfidence` with a 3-round state; the seed is stable for the same inputs; rows are sorted; a golden win-count snapshot on a tiny hand-made state.

**Commit:** `feat(engine): odds and probability formatting`

### Step 7: Overlay feed

**Goal:** the odds, as flat JSON.

**Change:** `GET /api/feed/odds` computes `computeOdds` on the server for the active scenario (or the base season when none is active). Payload: `available: true`, `model: "estimate"`, `label: "Model estimate"`, `as_of_round`, `low_confidence`, `n_sims`, `scenario: { id, name } | null`, `wdc` and `wcc` row arrays (`rank, id, win_pct, display`, and `base_display` when a scenario is active), and flattened `top1_*` to `top10_*`. Cache the result by season ETag, active scenario id and version, and params, so repeated polling does not resimulate. Same 503 behavior as the other routes. Update `docs/FEED.md`.

**Tests first:** shape; two calls return an identical body; the body changes after activating a scenario; the cache is hit on the second call; 503 on bad data.

**Commit:** `feat(api): odds feed`

### Step 8: Web Worker and hook

**Goal:** the UI stays responsive while the model runs.

**Change:**
- `web/oddsWorker.ts` imports from `../engine` and answers `{ id, state, scenario, params }` with `{ id, result }` (or an error).
- `web/useOdds.ts` debounces by about 250 ms, ignores out-of-date responses by request id, and exposes `idle | calculating | ready | error` while keeping the previous result available (shown dimmed).
- `scripts/build.ts` bundles the worker (an extra entry point or the way Bun supports `new Worker(new URL(...))`). It must still work offline from `dist/`; `scripts/dev.ts` rebuilds it too.
- A pure protocol module (for example `web/viewModel/oddsRequests.ts`) holds the request-id logic so it can be unit-tested.
- Optional, only if a full run takes more than about 1 s on the owner's machine: while the slider or a lock is changing, run 2,000 simulations as a labeled preview, then the full 10,000 after 300 ms of calm.

**Tests first:** the protocol logic (latest request wins, stale responses dropped, errors reported). `tests/offline.test.ts` and `tests/design-tokens.test.ts` keep passing.

**Check:** `bun run build`, open the app offline, and confirm the worker file loads from `127.0.0.1` only.

**Commit:** `feat(web): odds worker and hook`

### Step 9: "Likely?" panel

**Goal:** the model's answer, honestly labeled.

**Change:**
- Enable the "Likely?" tab (`web/components/AnalysisRail.tsx`). Add `web/components/OddsPanel.tsx` and `web/viewModel/odds.ts`.
- Header: "Model estimate" and "as of Round N"; a `low confidence` tag when `lowConfidence` is true.
- WDC and WCC toggle. Probability bars per `DESIGN.md` section 6: 8px track, value text, color band by probability (default: at least 50% green, 10 to 50% yellow, under 10% orange, in `web/config.ts`). Show only drivers who are still alive. Clinched and eliminated are stated in words, not as a percentage. Add one line such as "{n} drivers are out of the title fight."
- When the scenario has locks: a delta against the base in percentage points ("▲ 12 pp", "▼ 8 pp", "●"), never by color alone.
- **Form-weight slider** (steps of 10%): "All drivers equal" to "This season's form", default 100%. When it is not 100%, say "What-if: form weight X%."
- A "How this works" disclosure at the `note` size: "The model uses this season's results: where drivers finish and how often they retire. It does not know about upgrades, tracks or weather. The number comes from 10,000 simulated seasons. Drivers you did not set in a locked session still race."
- States: calculating (previous values dimmed with "Updating…"), error (plain words, how to fix), no data.
- "Possible?" and "Likely?" stay separate tabs; no figure mixes them.

**Tests first (view-model):** band selection, delta formatting, which rows are listed (alive only), clinched and eliminated copy, the low-confidence tag, slider values to `formWeight`.

**Check:** on the real data, ANT is shown as ">99%" or very high, eliminated drivers are not listed, and locking ANT out of the next two races while RUS wins both visibly moves RUS's number. The numbers never show `0%` or `100%`.

**Commit:** `feat(web): likely panel`

### Step 10: Backtest and model card

**Goal:** know whether the model beats naive guesses, and write down its limits.

**Change (`scripts/backtest.ts`):** a walk-forward test. For each completed race from round 6 on, fit on the earlier rounds only, predict that race (P(win) and P(podium) per active driver, from single-session simulations), and compare with what happened. Report log loss, Brier score and a reliability table (bins such as 0–5%, 5–10%, …), against two baselines: uniform over active drivers, and proportional to points so far. Run a small grid over `recencyHalfLife` (4, 8, 16, no decay) and `priorStrength` (0.5, 1, 2). Change defaults only if a setting is clearly better, and say so.
Write `docs/MODEL.md`: what the model is, every parameter and default, the backtest results, and the limits (one season; about 11 test races; no upgrades, tracks, weather or grid positions; title odds cannot be calibrated from a single season; strength uncertainty is a heuristic).

**Acceptance:** the model's log loss is lower than the uniform baseline's; the script prints a readable table; `docs/MODEL.md` exists.

**Commit:** `feat(scripts): walk-forward backtest` and `docs: add model card`

### Step 11: Polish and hardening

**Change:** keyboard walkthrough of the "Likely?" tab (tabs, toggle, slider, disclosure) with visible focus; reduced motion respected; layout at 1920×1080 and 1280 wide; the `DESIGN.md` checklist (section 11); README and `docs/FEED.md` current; `SPEC.md` phase table and decisions updated; `AGENTS.md` status updated.

**Commit:** `chore: odds polish and docs`

## Phase 3 is done when

1. In a fresh clone **without** the sibling database, `bun test` and `bun run typecheck` pass, and `bun run build` works.
2. A seeded run is reproducible; win counts sum to `nSims`; eliminated drivers never win and clinched drivers always win (tests).
3. The "Likely?" tab works offline: the worker loads, the slider and scenario locks change the numbers, and the UI never freezes.
4. `GET /api/feed/odds` returns the shape above, cached.
5. The backtest beats the uniform baseline, and `docs/MODEL.md` records the results and limits.
6. No `0%` or `100%` is shown anywhere; every simulated number says "Model estimate" and "as of Round N".
7. The `DESIGN.md` checklist passes; `SPEC.md` and `AGENTS.md` are updated.

Then open a pull request `phase-3-odds` → `main` and merge.

## Known limits (deliberate)

- Season-only: no prior from earlier seasons, so early-season numbers are wide and flagged `low confidence` below 5 completed rounds.
- Strength uncertainty is a simple heuristic, not a full Bayesian posterior.
- Future qualifying results are not simulated; the final countback level uses past qualifying only.
- Drivers are modeled one by one; teammates share no car effect beyond their own results.
- One season of data means title odds cannot be calibrated, only sanity-checked.
