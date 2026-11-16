# Phase 9: Model v3 (points chance and expected finish)

Branch: `phase-9-points-model` (to-the-flag only). One commit per step. Tests first wherever there is logic. Read `docs/MODEL.md` (especially "The race forecast's points chance and expected finish"), `docs/PHASE_4.md` (the D30 protocol) and `docs/PHASE_8.md` before anything else.

**Goal:** make the race forecast's points chance (`top10`) and expected finish (`meanPosition`) as trustworthy as its win and podium numbers, using the D30 protocol, and never adopt a change on 2026 numbers alone.
**Not in Phase 9:** the multi-season prior (moved to Phase 11, after V1.0), weather, tyres, track types, any change to the title odds.

## The finding this phase answers

Commit `abf658c` recorded a limit of model v2. `paceStages` 5 fits Plackett-Luce on the top five places only, so a driver who never finishes in the top five looks the same as the rest of the midfield. On 2026 (rounds 6 to 20, 330 driver-race pairs):

- the 10-20% points band forecast 15.7% and happened 5.1%;
- starting 16th to 20th: points 22.3% forecast against 10.7%, expected finish 15.1 against 16.8;
- `paceStages` 8 scored a points Brier of 0.1357 against 0.1434 (all places 0.1411, no grid 0.1594).

Those numbers are a **hint, not evidence**: 2026 is the confirmation season of D30, and the settings were looked at on the same races they were judged on. So the fix is a proper evaluation on 2022 to 2025, with a points metric the backtest does not have yet.

## Decisions (all Proposed; the owner decides)

| # | Decision | Recommendation |
|---|---|---|
| D51 | Order of work | Do this phase before the V1.0 release. The Race tab and the feed already show points chance and expected finish, so V1.0 should not ship them as known-biased. Release becomes Phase 10 and the multi-season prior Phase 11. Alternative: ship V1.0 with the limit documented and the "indicative" tag from Step 1. |
| D52 | Candidate fixes | Evaluate (A) a larger global `paceStages` (8, 10, 0) with the prior retuned, and (B) a separate fit for the finish part: new `finishStages`, a second simulation pass that produces only `top10` and `meanPosition`, while `win` and `podium` keep today's fit, seeds and numbers. Prefer B if it ties or wins, because D49 says the existing win and podium numbers do not change. |
| D53 | Adoption rule for the points part | Metric: points Brier per driver-race pair, plus mean absolute error of expected finish. Adopt only if (1) on 2025 it beats the current model by more than 2 standard errors and at least 0.004 per pair; (2) it improves at least 3 of the 4 history seasons; (3) 2026 is not worse than 1 standard error; (4) early season (rounds 3 to 5) is not worse than 1 standard error in any season; (5) for option A only: the win and podium score is not worse than 1 standard error in any season; (6) in the pooled 2022 to 2025 reliability table no 10-point band is off by more than 5 points. |

## Steps

### Step 1: Say it plainly in the product (no model change)

**Goal:** until Step 5 decides, nobody reads these two columns as validated.

**Change:** in the Race tab, a small note under the points and expected-finish columns: "Indicative; the model is fitted for the front of the field." In `docs/FEED.md`, mark `top10` and `meanPosition` as indicative. Add the same note to the PNG/CSV/JSON export header or filename-adjacent text only if an export of the forecast exists; do not touch the starting-grid export.

**Tests first:** the note renders in the Race tab; the feed payload is unchanged.

**Commit:** `docs(web): mark the points chance and expected finish as indicative`

### Step 2: Points scoring in the backtest

**Goal:** the harness can score what Phase 8 added.

**Change (`scripts/backtest.ts`):**
- `Scores` gets `pointsBrier`, `finishMae` (expected finish against the place that happened; a retirement counts as last place, as in `forecastRace`) and a reliability table (10-point bands: forecast mean, observed rate, pair count).
- Baselines: "10/22 for everyone" (points Brier 0.248 on 2026) and the current model.
- The outcome of a pair is "classified in the top ten", which needs the classified flag already on `ResultRow`.

**Tests first (synthetic seasons from known strengths with the seeded RNG):** the true-strength model beats the flat baseline on points Brier; a retirement counts as last; bands with no pairs are skipped, never divided by zero; no future leakage (changing a later race does not change an earlier forecast).

**Check:** on the 2026 fixture and on the live data at Round 20 the new numbers reproduce the table in `docs/MODEL.md` (points Brier 0.144 against 0.248) within simulation noise.

**Commit:** `feat(scripts): score the points chance and expected finish`

### Step 3: Candidate setting `finishStages`

**Goal:** option B exists as a setting, defaulting to no change.

**Change:** `finishStages: number` in `OddsParams` (`0` means "same as `paceStages`", the v2 behavior; for the all-places fit use a large number such as 99, because 0 is already taken to mean "same as `paceStages`"). `forecastRace` fits a second set of strengths with `finishStages` only when it differs from `paceStages`, runs a second pass with its own seed derived from the first, and takes `top10` and `meanPosition` from that pass; `win` and `podium` always come from the first pass. `checkParams` validates it (a whole number, 0 or more). Not used by `simulateSeason`.

**Tests first:** with `finishStages: 0` every output equals today's; with any value, `win` and `podium` are identical to the run without it; `top10` and `meanPosition` change; two runs with the same seed agree; `nSims` of the second pass equals the first.

**Commit:** `feat(engine): separate pace fit for the finish part of the race forecast`

### Step 4: Calibration section for points

**Goal:** one command applies D53.

**Change (`scripts/calibrate.ts`):** `--points` prints, for a list of candidates (A: `paceStages` 5, 8, 10, 99 (all places) with prior 0.5, 1, 3; B: `finishStages` 8, 10, 99 (all places) with the same priors; the harness names the number once, `ALL_PLACES`, and `paceStages` 0 and 99 fit the same thing), the per-season and pooled points Brier and finish MAE with standard errors, the reliability table, and the D53 verdict for each against the current defaults. Tune on 2022 to 2024, validate on 2025, print 2026 last, labeled "confirmation" (`--live` for the live data). Never use 2026 to choose.

**Tests first:** the verdict is `no` when the candidate equals the default, when it wins only on training, and when it fails the early-season or the win and podium check.

**Commit:** `feat(scripts): points calibration section`

### Step 5: Run it and decide (owner's machine; the four history files must exist)

**Do:**
```
bun run calibrate -- --points
```
Paste the full output into `docs/MODEL.md` under a new section "Model v3: points chance and expected finish", whatever the verdict.

**If a candidate passes D53:** adopt it as the default, bump `MODEL_VERSION` to `"v3"`, keep v2 reproducible with parameters (as v1 is), update the odds feed documentation, and remove the "indicative" note of Step 1 only if the reliability table on 2026 is within 5 points in every band.
**If none passes:** keep v2, keep the note, and record "rejected, with numbers" in `docs/MODEL.md`. That is a valid result.

**Commit:** `feat(engine): model v3 for the finish part` (adopted) or `docs: record the points-fit evaluation` (rejected)

### Step 6: Docs and close

Update `SPEC.md` (status line, roadmap: Phase 9 model v3, Phase 10 release V1.0, Phase 11 multi-season prior; D51 to D53 to Done or Rejected), `docs/PHASE_8.md` "What this does not do" (point to the result), and the README model section. Verify on a fresh clone: `bun install`, `bun test`, `bun run typecheck`, `bun run build`, `bun run calibrate -- --points`.

**Commit:** `docs: close Phase 9 and renumber the roadmap`

Then open the pull request `phase-9-points-model` into `main` and merge with `gh pr merge --merge --delete-branch`.

## What this does not do

- It does not change the win or podium numbers (option B guarantees it; option A must prove it, D53 rule 5).
- It does not model grid penalties, weather, strategy or reliability beyond a driver's own record. The 18.4% retirement rate of 2026 (81 of 440 starts) is an input to the points chance; if the reliability table still shows a gap after the pace fix, a separate retirement-rate check is the next candidate, not part of this phase.
