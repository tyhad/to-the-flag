# Phase 4: Model v2 (history data, calibration, grid signal)

Branch: `phase-4-model`. One commit per step. Tests first wherever there is logic. Read `docs/MODEL.md` (the v1 model card) before anything else, then `SPEC.md` (sections 8 F3, 9, 12), `docs/PHASE_3.md`, and `AGENTS.md`.

**Goal:** make the odds model measurably better at predicting races, using more data than one season, and never adopt a change without evidence.
**Not in Phase 4:** WCC Path Solver, LAN mode, multi-season priors (all planned later, see D32), weather or track-type effects, a Bayesian posterior for strength uncertainty.

## What "calibration" means here

Three kinds of work, in order of how much they gain:
1. **Structural changes** (a different way to fit pace, a new signal such as the grid). These move the scores the most.
2. **Tuning** (half-life, prior strength, and so on). Cheap, but with a single season it easily overfits.
3. **Measurement** (when the model says 30%, does it happen 30% of the time?). Honest reporting, not an improvement by itself.

Tuning on 11 races is what produced the weak spots in `docs/MODEL.md`. This phase fixes the method first: more data, a fixed protocol, and an adoption rule.

## Decisions (all Proposed; D29 to D32 need the owner)

| # | Decision | Recommendation |
|---|---|---|
| D29 | History data | Fetch seasons 2022 to 2025 with F1GStats into separate files `../F1GStats/history/f1gstats-<season>.sqlite`. Not committed. Used only by scripts to evaluate and tune. |
| D30 | Evaluation protocol | Tune on 2022 to 2024. Validate on 2025. Confirm once on 2026 (the live season). Adopt a change only if, on the validation season, it beats the current model by more than 2 standard errors **and** at least 0.005 per race (the rule from `MODEL.md`), it improves at least 3 of the 4 history seasons, and it is not worse than 1 standard error on 2026 or on rounds 3 to 5 of every season. |
| D31 | Model versioning | `MODEL_VERSION` (`"v1"`, `"v2"`) in `OddsResult` and in the feed. The v1 behavior stays reproducible with parameters. A change of default behavior bumps the version. |
| D32 | Roadmap after Phase 4 | Phase 5: WCC Path Solver (this season is live). Phase 6: LAN mode + write token + small ops tools (refresh script, PNG export). Phase 7: multi-season prior (needs this phase's history data; matters from the start of the next season). The owner may reorder. |

## What exists (verified on a fresh clone of `main` @ `51aa904`)

- 996 tests pass, 1 skipped (the optional real-database smoke), 0 fail; typecheck clean; build emits `dist/oddsWorker.js`.
- `bun run backtest` reproduces the `MODEL.md` numbers exactly.
- Hooks: `engine/strength.ts` (`fitStrengths`, `StrengthParams`), `engine/simulate.ts` (`OddsParams`, `simulateSeason`, `forecastRace`, `checkParams`, `deriveSeed`), `engine/odds.ts`, `scripts/backtest.ts` (`walkForward`, `scoreMethod`, `compareCells`, `compareMethods`, `stateBefore`), `data/loadSeason.ts`, `tests/dbHelpers.ts` (`buildDb`).
- `ResultRow` carries `classified` but not `grid`. The database has `race_results.grid` for every race and `starting_grid` for the previous, current and next round.

## Findings from a throwaway experiment (2026 only, rounds 6 to 16; not production code)

Score = win log loss + podium log loss (lower is better). Current default 0.4411; "points so far" 0.3864.
- **Did not help:** DNF settings (0.4409 to 0.4442); scaling the strengths (best 0.4305); blending the model with "points so far" (worse the more model is mixed in).
- **Helped a lot:** fitting the Plackett-Luce model on the first K finishing places only, because the full-order fit spends its effort ordering the midfield and leaves about 2% win probability on drivers who never win.

| Fit | Score |
|---|---|
| All places, prior 3 (v1) | 0.4411 |
| Top 10, prior 3 | 0.4108 |
| Top 5, prior 3 | 0.3997 |
| Top 3, prior 3 | 0.4107 |
| Top 5, prior 1 | 0.3780 |
| Top 1 | 0.4722 |

- With top 5 and prior 1 the model is at least as good as "points so far" in both halves of the test. The title odds barely move today (ANT stays above 99%; the "ANT out of four races, RUS wins four" what-if goes from 50% to 53%). The gain shows up in race forecasts and tighter title fights.
- **Grid is the largest unused signal:** the winner started in the top three in 10 of 11 races, and pole won 7 of 11.
- All of this was chosen on the same 11 races it was judged on. Step 6 repeats it with the protocol above.

## Layout added in this phase

```
data/       loadHistory.ts
scripts/    calibrate.ts  addGrid.ts
docs/       history-notes.md  (what happened when each season was fetched)
```

## Steps

### Step 1: Fetch the history (F1GStats, no code change expected)

**Goal:** four more seasons of data, kept out of git.

**Do:**
- In F1GStats, add `history/` to `.gitignore` and commit that.
- Run, for each season, in `cmd` (each takes a few minutes because of the paging):
  ```
  cd ..\F1GStats
  mkdir history
  py fetch_f1_data.py --season 2022 --output .\history\f1gstats-2022.sqlite
  py fetch_f1_data.py --season 2023 --output .\history\f1gstats-2023.sqlite
  py fetch_f1_data.py --season 2024 --output .\history\f1gstats-2024.sqlite
  py fetch_f1_data.py --season 2025 --output .\history\f1gstats-2025.sqlite
  ```
- For each file note the exit code, the `data_health` status, the round count and the row counts in `docs/history-notes.md`.

**Expect:** exit code 0 or 2. Seasons 2022 to 2024 had a fastest-lap point, so check V2 shows `warn`, not `fail`. If V4 fails because a cancelled round is still in the schedule (2022 Russia, 2023 Imola), do not weaken the check; write down what happened and ask the owner how to treat it.

**Check:** at least three of the four files pass validation. Round counts are about 22, 22, 24, 24.

**Commits:** F1GStats `chore: ignore the history folder`; to-the-flag `docs: history fetch notes`

### Step 2: Carry the grid on result rows

**Goal:** the engine knows where each driver started.

**Change:**
- `engine/types.ts`: `ResultRow.grid: number` (Ergast uses 0 for a pit-lane start; store it as the field size for that session so it is the last place on the grid).
- `data/loadSeason.ts` reads `race_results.grid`; `tests/dbHelpers.ts` and `tests/helpers.ts` (`makeState`) can set it.
- `scripts/addGrid.ts <db> <fixture>` adds `grid` to `tests/fixtures/season-2026-r16.json`, matching round, kind and driver, and refusing to write on any miss. Do **not** re-export the fixture; it must stay the Round 16 snapshot.

**Tests first:** the loader maps `grid`, including a pit-lane start; every fixture row has `grid`; all existing fixture counts are unchanged.

**Commit:** `feat(data): carry the starting grid on result rows`

### Step 3: Load many seasons

**Goal:** a list of `SeasonState` for the evaluation scripts.

**Change (`data/loadHistory.ts`):** `loadSeasons(dir, seasons)` loads each file with the existing loader and returns `{ loaded: SeasonState[], skipped: { season, reason }[] }`. One bad season is reported, never thrown for the others.

**Tests first (seeded databases via `buildDb`):** two seasons load; a missing file and a bad schema version are reported in `skipped`.

**Check:** the four real history files load (or the skipped reasons match `docs/history-notes.md`).

**Commit:** `feat(data): load several seasons`

### Step 4: Evaluation harness

**Goal:** one command that scores any model setting over many seasons with the D30 protocol.

**Change (`scripts/calibrate.ts`, `bun run calibrate`):**
- Walk-forward race forecasts per season (reuse `walkForward`, `scoreMethod`, `compareCells`); baselines: uniform and "points so far".
- Report per season, then pooled for the training seasons, the validation season and 2026, always with the per-race standard error. Add an early-season view (rounds 3 to 5; fits need at least 2 races).
- Take a list of settings and print the adoption verdict from D30 for each against the current defaults. Never use 2026 to choose a setting; print it last, labeled "confirmation".
- Runtime budget: a grid of about 50 settings over the four seasons should finish in a couple of minutes.

**Tests first (small synthetic seasons generated from known strengths with the seeded RNG):** the model with the true strengths beats uniform; there is no future leakage (changing a later race does not change an earlier forecast); the adoption verdict is `no` for identical settings.

**Commit:** `feat(scripts): multi-season calibration harness`

### Step 5: Top-heavy pace fit

**Goal:** the structural change that the experiment pointed at.

**Change:** add `paceStages: number` to `StrengthParams` and `OddsParams` (`0` means all places, the v1 behavior). When it is `K > 0`, the Plackett-Luce fit uses only the first `K` stages of each finishing order. Validate it in `checkParams` (a whole number, 0 or more). Keep existing seeds unchanged: `deriveSeed` must give the same value as before when `paceStages` is 0.

**Tests first:**
- With `paceStages: 0` the fitted strengths and a small odds snapshot are identical to today's.
- A value of at least the field size equals 0.
- On synthetic data with a heavy-tailed truth (a few strong drivers and a long tail), the top-K fit recovers the strengths of the top three drivers with lower error than the all-places fit, averaged over seeded repetitions.

**Commit:** `feat(engine): top-heavy pace fit`

### Step 6: Tune and decide (the protocol)

**Goal:** choose the v2 defaults from evidence.

**Do:** run `bun run calibrate` over a grid: `paceStages` in {0, 3, 5, 8}, `priorStrength` in {0.5, 1, 2, 3}, `recencyHalfLife` in {8, 16, none}. Choose on the training seasons only; check the validation season and the early-season view; look at 2026 last.
**Adopt** only what passes D30. If nothing passes, keep v1 and record the numbers.
If something passes: change `defaultOddsParams`, set `MODEL_VERSION` to `"v2"`, update the golden snapshot tests (state in the commit why they changed), and write the tables (training, validation, 2026, early season) into `docs/MODEL.md`, including what was rejected.

**Commit:** `feat(engine): model v2 defaults chosen by the protocol` and `docs: model card for v2`

### Step 7: Grid signal, evaluated

**Goal:** find out whether knowing the grid improves race forecasts.

**Change:** let a race forecast take an optional grid and add a term to the finishing key: `key = strength + gridWeight * (-ln(grid))`, with `gridWeight` 0 meaning "ignore the grid" (the v2 behavior). Estimate `gridWeight` on the training seasons (a coarse grid such as 0, 0.25, 0.5, 0.75, 1), judge it on the validation season and 2026 with the D30 rule. Use the **actual** grid of each past race.

**Tests first:** `gridWeight: 0` reproduces v2 exactly; a larger weight raises the front row's chance; a pit-lane start is treated as last.

**Check:** the verdict is in the calibrate output and in `docs/MODEL.md`. If it is not adopted, say so with the numbers and skip Step 8.

**Commit:** `feat(engine): grid term in race forecasts` and `docs: grid signal results`

### Step 8: Grid in the season simulation (only if Step 7 is adopted)

**Goal:** use the grid where it exists, and simulate it where it does not.

**Change:**
- The loader reads `starting_grid` for the next round into an optional `SeasonState.upcomingGrid` (with its `grid_source`). When present, the simulation uses it as the fixed grid for that race.
- For later rounds, simulate the qualifying order from the same strengths with a noise size estimated on the training seasons, and use it as the grid for that race. `qualifyingNoise` is a parameter; 0 reproduces "no grid".
- The "Likely?" panel shows a small tag "Grid known: Round N" when the real grid is used; `docs/FEED.md` and the feed payload say so.

**Tests first:** no `upcomingGrid` and `gridWeight: 0` reproduce v2 exactly; with a known grid the front row's chance for that race rises; win counts still sum to `nSims`; eliminated drivers still never win and clinched drivers always win.

**Commit:** `feat(engine): grid in the season simulation` and `feat(web): grid known tag`

### Step 9: Title-level checks, version, docs

**Change:**
- Title odds cannot be calibrated from four champions, so only sanity-check them: at rounds 8 and later in each history season, compare the model's champion probability with who actually won the title, pooled and described as such; add a sensitivity table (v1 against v2) for the "ANT out of four races, RUS wins four" what-if on the 2026 fixture.
- `MODEL_VERSION` appears in `OddsResult`, in `/api/feed/odds` as `model_version`, and in the "How this works" note ("Model v2").
- `docs/MODEL.md`: what changed, every table, limits. `SPEC.md` phase table and decisions, `AGENTS.md` status.

**Commit:** `chore: model version, title-level checks, docs`

## Phase 4 is done when

1. At least three history seasons are loaded and described in `docs/history-notes.md`.
2. `bun run calibrate` prints the protocol tables and the D30 verdicts.
3. v2 defaults are adopted only where the rule passes; otherwise v1 stays and `MODEL.md` shows why. The grid signal is adopted or explicitly rejected with numbers.
4. v1 stays reproducible; in a fresh clone **without** any history files `bun test` and `bun run typecheck` pass and `bun run build` works.
5. The invariants still hold (win counts sum to `nSims`, eliminated never win, clinched always win).
6. `docs/MODEL.md`, `SPEC.md` and `AGENTS.md` are updated.

Then open a pull request `phase-4-model` → `main` and merge.

## Rules for this phase

- Never tune on 2026 before the confirmation run. Never change the protocol after seeing the results.
- Every experiment is reproducible: seeds come from `hashSeed`, and the harness prints the standard error next to every difference.
- A model change that does not pass D30 is not adopted, even if it looks better.

## Known limits (deliberate)

- The regulations differ between 2022 to 2025 and 2026, so a setting that helps in the past may not help now. That is why a change must help in at least three of four seasons and must not hurt on 2026.
- Four champions cannot calibrate title odds; only race-level forecasts can be measured.
- Penalties, weather, tracks, upgrades and team effects are not modeled. A team or car effect (teammates sharing information) is a candidate for a later phase.
