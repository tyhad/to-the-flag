# Model card: championship odds ("Likely?")

This document says what the odds model is, every number that goes into it, how well it did when tested against races
that had already happened, and what it cannot do. The odds are always shown as a **model estimate**, never as a fact.

Source: `engine/strength.ts` (pace and retirements), `engine/simulate.ts` (the simulated seasons), `engine/odds.ts`
(the table and the text), `scripts/backtest.ts` (the test below). Decisions D20 to D24 in `SPEC.md` are the rules this
follows.

## What the model is

A Monte Carlo simulation of the rest of the season, built only from this season's results.

1. **Pace.** Every race and sprint that has results is used to fit a strength for each driver, with a Plackett-Luce
   model (the chance a driver beats the others is `exp(strength)` over the sum for the drivers still in the running).
   Only classified finishers take part, in finishing order, so **a retirement never makes a driver look slow**. A
   dummy driver of strength 1 that every driver beats once and loses to once keeps the fit finite and pulls a driver
   with little data towards the average (`priorStrength`). Strengths are centred on 0. **Model v2 fits only the first
   5 finishing places of each race** (`paceStages`, a "top-heavy" fit): who beat whom further back says little about
   who can win, and using every place gave midfield drivers a floor of about 2% to win. `paceStages: 0` uses every
   place (v1).
2. **Retirements.** A driver's chance of retiring in a race is their own record in races, blended with the field's
   rate (the field counts as `dnfPriorSessions` virtual races). In a sprint the chance is the race chance times
   `sprintDnfFactor`.
3. **Simulated seasons.** Each simulated season draws a strength for every active driver (the fitted strength times
   `formWeight`, plus noise that is larger for a driver with little data). Then each remaining session is run:
   drivers retire or finish, finishers are ordered by their strength plus random noise, retirees go to the back and
   score nothing. A session you locked keeps the places you set; **drivers you did not set still race** (D20).
4. **Champion.** The driver (and the team) with the most points wins the simulated season. A tie goes through the
   same countback as the standings. Only drivers still racing can win the drivers' title.
5. **Odds.** The share of simulated seasons a driver won, shown as `<1%`, `3.4%`, `47%` or `>99%`. Never `0%` or
   `100%`: a simulation cannot prove either. Whether a title is *possible* is not decided by the model at all: the
   "Possible?" tab and the status of each driver come from exact arithmetic.

## Parameters

| Parameter | Default | Meaning |
|---|---|---|
| `nSims` | 10,000 | simulated seasons; sampling error of a probability is at most `0.5 / sqrt(nSims)` (0.5 points) |
| `seed` | derived | hash of season, round, scenario locks and the parameters; the same inputs always give the same odds |
| `formWeight` | 1 | strengths are multiplied by this; 0 makes every driver equal (the slider, D23) |
| `recencyHalfLife` | 8 | rounds after which a session counts half as much; "none" means every session counts the same (v1 default) |
| `sprintWeight` | 0.5 | weight of a sprint next to a race in the pace fit |
| `priorStrength` | 1 | weight of the dummy driver's comparisons; higher means more shrinkage towards equal (v1 default: 3) |
| `strengthSigma` | 0.25 | noise on a driver's strength; for a driver with `n` effective races it is `0.25 * sqrt(6 / (6 + n))` |
| `dnfPriorSessions` | 4 | how many virtual races the field's retirement rate counts for |
| `sprintDnfFactor` | 0.5 | sprint retirement chance = race chance times this |
| `includeDnf` | true | retirements on or off |
| `paceStages` | 5 | finishing stages used in the pace fit; 0 means all places (v1 behavior) |
| `gridWeight` | 1 | weight of the starting grid in a race: the finishing key gets `gridWeight * (-ln(grid place))` added; 0 ignores the grid (v2). Used by `forecastRace` when it is given a grid, and by the season simulation for races that have a grid (a real one, or a simulated one) |
| `qualifyingNoise` | 2 | Gumbel scale of the simulated qualifying for a race with no real grid: qualifying key = strength + `qualifyingNoise` * Gumbel, and the order of the keys is the grid. 0 simulates no grid, so later races ignore the grid. Only used when `gridWeight` is above 0 |
| `finishStages` | 0 | Phase 9: finishing stages of a separate pace fit for the finish part of the race forecast (`top10` and `meanPosition`). 0 means the same as `paceStages` (the v2 behavior, no second fit). Any other value that differs from `paceStages` makes `forecastRace` fit a second set of strengths and run a second pass (same `nSims`, grid and field, its own seed) for those two fields; `win`, `podium` and the seed stay those of the first pass. A value of at least the field size is the all-places fit, so for that use a large number such as 99 (0 is taken: it means "same as `paceStages`"); 99 is safe while a race has fewer than 99 drivers. Not used by the season simulation (the title odds), and not part of the default seed |
| `priorCarryover` | 0 | Phase 11 (D62): how much the previous season's sessions count in the strength fit, 0 to 1. 0 ignores the previous season (the v2 behavior). The previous season is attached to the state (`SeasonState.prior`) and must be exactly one season earlier |
| `priorSeasonGap` | 8 | Phase 11 (D62): a carried session is aged as if it happened this many rounds before round 1, and grows older as the new season runs. Fixed, not tuned |
| `priorSameTeamOnly` | false | Phase 11 (D62): carry the previous season only for drivers who stayed with the same constructor id. A driver with no race yet in the new season counts as unchanged (his current team is not known) |

v1 is reproducible by passing `{ recencyHalfLife: Infinity, priorStrength: 3, paceStages: 0 }`. `MODEL_VERSION` is `"v2"`.

Fixed in the code, not parameters: a retirement rate is kept between 0.1% and 99.9%; with no race results yet the
field rate is 5%; the odds are marked `low confidence` while fewer than 5 rounds are complete (`LOW_CONFIDENCE_ROUNDS`);
probability bars are green from 50%, yellow from 10% (`ODDS_BANDS` in `web/config.ts`).

## How it was tested

`bun run backtest` (about 3 seconds). A **walk-forward test**: for each completed race from round 6 on, the model is
fitted on the rounds before it only (not even that round's sprint), then asked for each driver's chance to win and to
finish on the podium, from 5,000 simulated races. Those forecasts are scored against what happened, next to two
naive forecasts: **uniform** (everyone equal) and **points so far** (in proportion to points). A test checks that the
future is never used.

Data: the Round 16 snapshot (`tests/fixtures/season-2026-r16.json`): **11 races** (rounds 6 to 16), 242 driver-race
pairs, **11 winners**. Scores are log loss and Brier score (lower is better). "Winner -ln p" is how surprised the
forecast was by the actual winner; for uniform it is the log of the field size.

| Forecast | win log loss | win Brier | winner -ln p | podium log loss | podium Brier |
|---|---|---|---|---|---|
| **Model (defaults: v2 + grid)** | 0.095 | 0.0280 | 1.335 | 0.207 | 0.0673 |
| Model (v2 without the grid, `--grid-weight 0`) | 0.129 | 0.0374 | 1.944 | 0.256 | 0.0842 |
| Uniform | 0.185 | 0.0434 | 3.091 | 0.398 | 0.1178 |
| Points so far | 0.134 | 0.0380 | 2.023 | 0.253 | 0.0824 |

- The model **beats the uniform baseline** on every score, with or without the grid.
- The "defaults" row gives each race its **actual** starting grid. The two baselines do not know the grid, so the fair
  comparison of the grid is the one in Step 7 (against v2 without the grid), not this table.
  Against "points so far" the defaults are clearly better: -0.084 per race (win and podium log loss added up),
  standard error 0.021.
- Without the grid the model is level with "points so far": win log loss better (0.129 against 0.134), podium log
  loss slightly worse (0.256 against 0.253); -0.001 per race, standard error 0.007, not clearly different. (With the
  v1 defaults the model was clearly worse, by 0.055 per race.)
- This test uses real grids. The title odds use a real grid only for the next race; later races get a simulated grid
  (Step 8), which this backtest does not test.

These numbers are the 2026 season only and are the **confirmation** season of the Phase 4 protocol (see below); they
were not used to choose the v2 defaults.

### Settings tried on 2026 alone (Phase 3, Step 10, rerun with v2 code, without the grid: `bun run backtest -- --grid-weight 0`)

Total = win log loss + podium log loss, over the same 11 races and the same random numbers, with `paceStages` 5.
`*` is the default.

| half-life \ prior | 0.5 | 1 | 2 | 3 |
|---|---|---|---|---|
| 4 rounds | 0.384 | 0.395 | 0.415 | 0.431 |
| 8 rounds | 0.377 | 0.386 `*` | 0.401 | 0.415 |
| 16 rounds | 0.374 | 0.381 | 0.395 | 0.407 |
| no decay | **0.372** | 0.378 | 0.389 | 0.400 |

On 2026 alone, less decay is still better (no decay beats the default by 0.014 per race, standard error 0.003). That
season's pace order barely moved. It is **not** a reason to change the default, because the rule forbids tuning on
2026: the half-life was chosen on the training seasons (below), and 2026 only had to not be worse than v1 by more than
one standard error.

- `strengthSigma` (0, 0.25, 0.5) makes no visible difference to single-race forecasts (total 0.386, 0.386, 0.386). It
  acts across a whole simulated season, so this test cannot say whether 0.25 is right for the title odds.

### Phase 4, Step 6: multi-season calibration (protocol D30)

Run `bun run calibrate` (needs the history files from `F1GStats/history`; not in git). Tune on 2022 to 2024, validate on
2025, confirm once on 2026, over `paceStages` {0, 3, 5, 8} x `recencyHalfLife` {8, 16, none} x `priorStrength`
{0.5, 1, 2, 3}, against the v1 defaults (`paceStages` 0, no decay, prior 3). A setting is adopted only if all four hold:
validation beats v1 by more than 2 SE and at least 0.005 per race; at least 3 of the 4 history seasons improve; 2026 is
not worse by more than 1 SE; rounds 3 to 5 of every season are not worse by more than 1 SE.

**Adopted (v2):** `paceStages` 5, `recencyHalfLife` 8, `priorStrength` 1. Reasons, as recorded when the defaults were
set: `paceStages` 5 is the largest structural change and improved all 4 history seasons (it removes the ~2% floor win
probability of midfield drivers); with it, `priorStrength` 1 no longer over-disperses the early rounds, so the
early-season check passes; `priorStrength` 0.5 also passed but differs from 1 by only 0.005 per race on training
(within 1 SE), so the more conservative value was kept; half-life 8 beat no decay on 2022 to 2024 and is the top
training setting that passes validation, history, 2026 and early season.

Result of `bun run calibrate` (2000 simulations per forecast; per race, setting minus v1, negative is better; v1 is
`paceStages` 0, no decay, prior 3, no grid, so it is not a row). The early-season check (rounds 3 to 5) is part of the
verdict but has no column:

| Setting | Train (22-24) | Valid (2025) | Seasons improved | Confirm (2026) | Verdict |
|---|---|---|---|---|---|
| all, half-life 8, prior=0.5 | -0.018 (±0.005) | -0.007 (±0.010) | 3/4 | +0.005 (±0.006) | reject |
| all, half-life 8, prior=1 | -0.016 (±0.004) | -0.004 (±0.008) | 4/4 | +0.005 (±0.005) | reject |
| all, half-life 8, prior=2 | -0.010 (±0.003) | +0.003 (±0.005) | 3/4 | +0.010 (±0.004) | reject |
| all, half-life 8, prior=3 | -0.001 (±0.003) | +0.010 (±0.004) | 1/4 | +0.015 (±0.004) | reject |
| all, half-life 16, prior=0.5 | -0.013 (±0.004) | -0.010 (±0.008) | 3/4 | -0.002 (±0.004) | reject |
| all, half-life 16, prior=1 | -0.012 (±0.003) | -0.007 (±0.006) | 3/4 | -0.001 (±0.003) | reject |
| all, half-life 16, prior=2 | -0.008 (±0.002) | -0.001 (±0.003) | 4/4 | +0.003 (±0.002) | reject |
| all, half-life 16, prior=3 | -0.002 (±0.002) | +0.006 (±0.002) | 1/4 | +0.009 (±0.002) | reject |
| all, no decay, prior=0.5 | -0.006 (±0.004) | -0.014 (±0.006) | 3/4 | -0.009 (±0.004) | **adopt** |
| all, no decay, prior=1 | -0.006 (±0.003) | -0.012 (±0.005) | 3/4 | -0.008 (±0.002) | **adopt** |
| all, no decay, prior=2 | -0.004 (±0.001) | -0.006 (±0.002) | 3/4 | -0.005 (±0.001) | **adopt** |
| top3, half-life 8, prior=0.5 | -0.035 (±0.013) | -0.070 (±0.020) | 3/4 | -0.067 (±0.019) | **adopt** |
| top3, half-life 8, prior=1 | -0.028 (±0.011) | -0.061 (±0.018) | 3/4 | -0.054 (±0.019) | **adopt** |
| top3, half-life 8, prior=2 | -0.013 (±0.009) | -0.043 (±0.015) | 3/4 | -0.034 (±0.017) | reject |
| top3, half-life 8, prior=3 | +0.001 (±0.008) | -0.027 (±0.013) | 2/4 | -0.016 (±0.016) | reject |
| top3, half-life 16, prior=0.5 | -0.035 (±0.013) | -0.069 (±0.020) | 3/4 | -0.069 (±0.019) | **adopt** |
| top3, half-life 16, prior=1 | -0.029 (±0.011) | -0.063 (±0.018) | 3/4 | -0.057 (±0.019) | **adopt** |
| top3, half-life 16, prior=2 | -0.018 (±0.010) | -0.048 (±0.015) | 3/4 | -0.039 (±0.018) | reject |
| top3, half-life 16, prior=3 | -0.007 (±0.008) | -0.035 (±0.014) | 2/4 | -0.023 (±0.017) | reject |
| top3, no decay, prior=0.5 | -0.032 (±0.013) | -0.068 (±0.020) | 3/4 | -0.070 (±0.019) | **adopt** |
| top3, no decay, prior=1 | -0.029 (±0.012) | -0.063 (±0.018) | 3/4 | -0.060 (±0.019) | **adopt** |
| top3, no decay, prior=2 | -0.020 (±0.010) | -0.052 (±0.016) | 3/4 | -0.044 (±0.018) | reject |
| top3, no decay, prior=3 | -0.012 (±0.009) | -0.041 (±0.015) | 2/4 | -0.030 (±0.018) | reject |
| top5, half-life 8, prior=0.5 | -0.052 (±0.011) | -0.065 (±0.019) | 4/4 | -0.064 (±0.015) | **adopt** |
| top5, half-life 8, prior=1 | -0.047 (±0.009) | -0.061 (±0.016) | 4/4 | -0.054 (±0.014) | **adopt** |
| top5, half-life 8, prior=2 | -0.034 (±0.008) | -0.050 (±0.012) | 4/4 | -0.040 (±0.013) | **adopt** |
| top5, half-life 8, prior=3 | -0.021 (±0.007) | -0.037 (±0.010) | 4/4 | -0.025 (±0.012) | reject |
| top5, half-life 16, prior=0.5 | -0.051 (±0.010) | -0.063 (±0.019) | 4/4 | -0.067 (±0.015) | **adopt** |
| top5, half-life 16, prior=1 | -0.047 (±0.009) | -0.060 (±0.016) | 4/4 | -0.059 (±0.015) | **adopt** |
| top5, half-life 16, prior=2 | -0.038 (±0.008) | -0.051 (±0.013) | 4/4 | -0.046 (±0.014) | **adopt** |
| top5, half-life 16, prior=3 | -0.027 (±0.007) | -0.042 (±0.011) | 4/4 | -0.034 (±0.013) | reject |
| top5, no decay, prior=0.5 | -0.047 (±0.011) | -0.060 (±0.019) | 4/4 | -0.069 (±0.016) | **adopt** |
| top5, no decay, prior=1 | -0.045 (±0.009) | -0.058 (±0.017) | 4/4 | -0.062 (±0.015) | **adopt** |
| top5, no decay, prior=2 | -0.038 (±0.008) | -0.052 (±0.014) | 4/4 | -0.052 (±0.014) | **adopt** |
| top5, no decay, prior=3 | -0.031 (±0.007) | -0.045 (±0.013) | 4/4 | -0.042 (±0.014) | reject |
| top8, half-life 8, prior=0.5 | -0.042 (±0.010) | -0.046 (±0.012) | 4/4 | -0.051 (±0.011) | **adopt** |
| top8, half-life 8, prior=1 | -0.040 (±0.008) | -0.041 (±0.010) | 4/4 | -0.046 (±0.010) | **adopt** |
| top8, half-life 8, prior=2 | -0.032 (±0.006) | -0.031 (±0.009) | 4/4 | -0.036 (±0.009) | **adopt** |
| top8, half-life 8, prior=3 | -0.021 (±0.006) | -0.020 (±0.008) | 4/4 | -0.026 (±0.009) | reject |
| top8, half-life 16, prior=0.5 | -0.039 (±0.010) | -0.046 (±0.012) | 4/4 | -0.054 (±0.011) | **adopt** |
| top8, half-life 16, prior=1 | -0.038 (±0.008) | -0.043 (±0.011) | 4/4 | -0.050 (±0.010) | **adopt** |
| top8, half-life 16, prior=2 | -0.032 (±0.006) | -0.034 (±0.009) | 4/4 | -0.041 (±0.009) | **adopt** |
| top8, half-life 16, prior=3 | -0.025 (±0.005) | -0.025 (±0.009) | 4/4 | -0.033 (±0.009) | reject |
| top8, no decay, prior=0.5 | -0.034 (±0.010) | -0.047 (±0.012) | 4/4 | -0.057 (±0.011) | **adopt** |
| top8, no decay, prior=1 | -0.034 (±0.008) | -0.044 (±0.012) | 4/4 | -0.054 (±0.010) | **adopt** |
| top8, no decay, prior=2 | -0.031 (±0.006) | -0.037 (±0.011) | 4/4 | -0.047 (±0.010) | **adopt** |
| top8, no decay, prior=3 | -0.026 (±0.005) | -0.030 (±0.010) | 4/4 | -0.039 (±0.009) | reject |

27 of 47 settings pass D30, and the adopted v2 setting (top5, half-life 8, prior 1) is one of them. It is not the single
best number on training (top5 with prior 0.5 is better by 0.005, inside 1 SE); the reasons are above. The 20 rejections
fall into three groups:
- 8 settings use all places with a half-life: validation is not better than v1 by 2 SE and 0.005 per race, and 2026 is
  worse or level in most of them.
- 3 settings (`top3`, prior 3) improve only 2 of the 4 history seasons.
- 9 settings (`top3` with prior 2, and `top5` and `top8` with prior 3) pass every visible column, so they fail the one
  criterion with no column: rounds 3 to 5 of some season are worse than v1 by more than 1 SE. The CLI prints only the
  passed list, not the reason per setting.

### Phase 4, Step 7: grid signal

`forecastRace` can take the starting grid: with `gridWeight` above 0, each driver's strength for that race gets
`gridWeight * (-ln(grid place))` added (pole adds 0, each place further back subtracts more; a pit-lane start counts as
last). The backtest and `bun run calibrate` pass the **actual** grid of every past race. `gridWeight` 0 reproduces v2
exactly (same numbers, same seed). The weights tried are 0, 0.25, 0.5, 0.75 and 1 against v2 with `gridWeight` 0; the
weight is chosen on 2022 to 2024 only, then judged with the D30 rule on 2025 and 2026.

Run `bun run calibrate -- --grid-signal` (needs the history files; not in git).

Result of `bun run calibrate -- --grid-signal` (2000 simulations per forecast; differences are per race, candidate minus
`gridWeight` 0, negative is better; the number in brackets is the standard error):

| gridWeight | 2022 | 2023 | 2024 | Train (22-24) | Valid (2025) | Seasons improved |
|---|---|---|---|---|---|---|
| 0.25 | -0.022 (±0.005) | -0.028 (±0.004) | -0.028 (±0.007) | -0.026 (±0.003) | -0.029 (±0.006) | 4/4 |
| 0.5 | -0.037 (±0.009) | -0.049 (±0.008) | -0.047 (±0.014) | -0.045 (±0.006) | -0.050 (±0.011) | 4/4 |
| 0.75 | -0.045 (±0.013) | -0.065 (±0.012) | -0.060 (±0.020) | -0.057 (±0.009) | -0.065 (±0.017) | 4/4 |
| 1 | -0.049 (±0.017) | -0.075 (±0.016) | -0.065 (±0.026) | -0.063 (±0.012) | -0.073 (±0.023) | 4/4 |

Chosen on the training seasons: `gridWeight` 1. Confirmation (printed last):

| Season | Race diff | Early (rounds 3-5) diff |
|---|---|---|
| 2022 | -0.049 (±0.017) | -0.108 (±0.013) |
| 2023 | -0.075 (±0.016) | -0.079 (±0.055) |
| 2024 | -0.065 (±0.026) | -0.073 (±0.033) |
| 2025 (validation) | -0.073 (±0.023) | -0.139 (±0.010) |
| 2026 (confirmation) | -0.084 (±0.022) | -0.038 (±0.040) |

**Verdict: `gridWeight` 1 is adopted (passes D30).** Validation beats v2 by 3.2 standard errors and 0.073 per race, all four
history seasons improve, 2026 is better by 3.8 standard errors, and rounds 3 to 5 are not worse in any season.
Limit: 1 is the largest weight in the coarse grid and the score was still improving from 0.75 to 1, so the best weight
may be above 1. The protocol does not allow widening the grid after seeing the result; a larger weight needs a new,
declared evaluation (a later phase).

### Phase 4, Step 8: the grid in the season simulation

The simulation uses a grid for every race (not sprints) when `gridWeight` is above 0:
- **The real grid** of the next race (`SeasonState.upcomingGrid`, read from the data file's `starting_grid`) is used as is.
  The odds then say so (`gridKnownRound`, the "Grid known: Round N" tag in the panel, `grid_known_round` in the feed).
- **A simulated grid** for every later race: each simulated season's strengths plus `qualifyingNoise` times Gumbel noise
  give a qualifying order, which is the grid for that race. This keeps the model consistent: the grid weight was measured
  on real grids, so the simulation has to give later races grids that look like real ones.
- `gridWeight` 0 reproduces v2 exactly. `qualifyingNoise` 0 simulates no grid (the real next-race grid is still used).

`qualifyingNoise` is estimated by `bun run calibrate -- --qualifying-noise`: the noise that makes the real grids of
2022 to 2024 most likely given the strengths fitted before each race (a Plackett-Luce likelihood), 7 values from 0.25 to 3.

Result of `bun run calibrate -- --qualifying-noise` (mean log likelihood of one real grid, higher is better; rounds 3
onward; the number in brackets is the standard error across grids):

| noise | Train (22-24) | Valid (2025) | Confirm (2026) |
|---|---|---|---|
| 0.25 | -101.105 (±6.910) | -75.883 (±6.481) | -76.063 (±13.188) |
| 0.5 | -58.399 (±3.075) | -46.672 (±2.842) | -50.864 (±5.563) |
| 0.75 | -46.507 (±1.782) | -39.944 (±1.621) | -44.780 (±3.028) |
| 1 | -42.052 (±1.169) | -38.049 (±1.063) | -43.034 (±1.856) |
| 1.5 | -39.508 (±0.637) | -37.669 (±0.599) | -42.853 (±0.908) |
| 2 | **-39.195 (±0.422)** | -38.148 (±0.419) | -43.515 (±0.566) |
| 3 | -39.585 (±0.248) | -39.085 (±0.279) | -44.704 (±0.316) |

**Chosen on training: `qualifyingNoise` 2.** It is inside the range tried. The curve is flat from 1.5 to 2: 1.5 is a
little better on 2025 and 2026, but by less than one standard error, and the rule is to choose on training only. A noise
of 2 is large next to the race's own noise of 1: the fitted strengths explain a grid only loosely (they come from
top-5 finishes), so this value also absorbs what the strengths miss.

Defaults are now `gridWeight` 1 and `qualifyingNoise` 2, set together so v2 seeds and the golden snapshot changed once.
v2 without the grid is still reproducible with `gridWeight: 0` (the old golden numbers are pinned in `tests/odds.test.ts`),
and v1 with `{ recencyHalfLife: Infinity, priorStrength: 3, paceStages: 0, gridWeight: 0, qualifyingNoise: 0 }`.

The real grid comes from `starting_grid` (`DATA_CONTRACT.md`): the rows of the next scheduled round, whatever their
`round_relation`. A grid with fewer than two drivers or a repeated driver is ignored. `bun run check` prints
`Upcoming grid: Round N (source: ..., N drivers)` or `none`, so you can see what the data holds.

Not tested: the simulated grid for later races. The grid weight was measured on real grids, and the noise was fitted
to real grids, but the title odds that come out of the two together are only sanity-checked (Step 9).

### Phase 4, Step 9: title-level checks

Title odds cannot be calibrated: a season has one champion, and there are four history seasons. So nothing here adopts
or rejects anything. `bun run title-check` prints two descriptions.

**What-if sensitivity** (2026 snapshot, 20,000 simulations; sampling error at most 0.4 points). RUS's chance of the title
if ANT is out of the next four races and RUS wins all four (with nothing locked RUS is under 1% in every row):

| Model | RUS title chance in the what-if |
|---|---|
| v1 (all places, no decay, prior 3) | 51% |
| v1 with half-life 8 | 42% |
| v2 without the grid | 51% |
| v2 (defaults, with the simulated grid) | 50% |

v2 does not move this number much (v1 51%, v2 50% to 51%). It moves with how old results are weighed (half-life 8 gives
42% under v1), as the limit below says. The grid shifts it by about a point.

**History:** at every round from 8 to the round before the last, in each of 2022 to 2025, the chance the model gave the
driver who then won the title, for v1, v2 without the grid and v2 (defaults). This is the only place the simulated
grid is exercised at title level (the race backtest uses real grids).

Result of `bun run title-check` (5000 simulations per forecast). The chance each model gave the eventual champion:

| Season | Champion | Model | R8 | R12 | R16 | R20 | Mean P | Mean -ln p |
|---|---|---|---|---|---|---|---|---|
| 2022 | VER | v1 | 23.5% | 88.4% | 100.0% | 100.0% | 82.3% | 0.275 |
| 2022 | VER | v2 without grid | 84.9% | 99.5% | 100.0% | 100.0% | 96.5% | 0.039 |
| 2022 | VER | v2 (defaults) | 85.6% | 99.4% | 100.0% | 100.0% | 96.5% | 0.038 |
| 2023 | VER | v1 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 0.000 |
| 2023 | VER | v2 without grid | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 0.000 |
| 2023 | VER | v2 (defaults) | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 0.000 |
| 2024 | VER | v1 | 85.5% | 100.0% | 99.9% | 99.8% | 98.9% | 0.012 |
| 2024 | VER | v2 without grid | 76.5% | 99.9% | 97.4% | 97.3% | 97.5% | 0.027 |
| 2024 | VER | v2 (defaults) | 76.2% | 100.0% | 97.5% | 97.0% | 97.4% | 0.028 |
| 2025 | NOR | v1 | 66.8% | 4.2% | 0.1% | 11.3% | 21.9% | 3.371 |
| 2025 | NOR | v2 without grid | 52.3% | 36.6% | 4.8% | 55.0% | 37.1% | 1.393 |
| 2025 | NOR | v2 (defaults) | 53.4% | 36.1% | 4.2% | 55.7% | 37.0% | 1.412 |

Pooled over the 60 forecasts of each model:

| Model | Mean P(champion) | Mean -ln p | Champion was the favourite |
|---|---|---|---|
| v1 | 74.8% | 0.966 | 80.0% |
| v2 without grid | 81.7% | 0.388 | 81.7% |
| v2 (defaults) | 81.7% | 0.393 | 81.7% |

What it shows, with four champions and rounds that are not independent:
- v2 gave the eventual champion more probability than v1 (81.7% against 74.8%, -ln p 0.39 against 0.97). The gap comes
  from two seasons: 2022 (v1 gave VER 23.5% after round 8, v2 85%) and 2025 (NOR averaged 22% under v1, 37% under v2).
  In 2023 and 2024 the models agree.
- The simulated grid made no visible difference at title level: v2 with and without it are level (81.7% both, -ln p 0.393
  against 0.388). So the grid helps single races (Step 7) and neither helps nor hurts these title odds. This is the
  check that the grid simulated for later races does no harm.
- 2025 is hard for every model: after round 16 NOR had 4% under v2 (0.1% under v1) and then won. The model knows
  results and grids, not momentum, so a late swing in a close title race is a miss, not a bug.

### Calibration

When the model says a given chance, how often did it happen (v2 defaults, 2026, all driver-race pairs)?

| Forecast chance | win: pairs | forecast | happened | podium: pairs | forecast | happened |
|---|---|---|---|---|---|---|
| 0-5% | 169 | 0.9% | 0.0% | 150 | 2.4% | 0.0% |
| 5-10% | 28 | 7.8% | 10.7% | 10 | 6.4% | 20.0% |
| 10-20% | 35 | 13.4% | 14.3% | 11 | 15.0% | 18.2% |
| 20-40% | 10 | 26.6% | 30.0% | 44 | 29.8% | 36.4% |
| 40-70% | 0 | - | - | 25 | 49.8% | 48.0% |
| 70-100% | 0 | - | - | 2 | 73.0% | 50.0% |

Read with care: there are only 11 winners, so the win columns rest on a handful of events. With the v1 defaults the
model was too flat (about 2% to drivers who never won, the favourites doing better than forecast). The top-5 fit
removes most of that: the back of the field is now at 0.9% for a win, and the middle rows are close to what happened.

### The race forecast in the app (Phase 8)

The "Race" tab and `GET /api/feed/race-forecast` show what the model expects of the **next** race, from the grid in use
(a saved manual grid, else OpenF1's, else the qualifying order; `docs/FEED.md`). Per driver, from 10,000 simulated races:
the chance to **win**, to finish on the **podium** (top three), to finish in the **points** (top ten), and the
**expected finish** (the average place, a retirement counting as last). It is `forecastRace` with the same settings as
the "Likely?" tab (including the form slider), so the two agree, and the same grid is in the title odds. It is labeled
"Model estimate" with the round it fitted on and the grid source. What it does not know is in the limits below: weather,
tyres, strategy, penalties after the grid, and a retirement is a chance, not a prediction. The win and podium numbers and
their seeds are unchanged by the new fields (golden tests in `tests/forecast.test.ts`).

### The race forecast's points chance and expected finish (Phase 8, Step 5)

`forecastRace` also returns `top10` (the chance of a points finish) and `meanPosition` (the average finishing place, a
retirement counting as last). The win and podium numbers and their seeds do not change. **The backtest above does not
score these two fields**: it was built for the question this project started with, who wins and who takes the podium.
A manual walk-forward check on the 2026 season (rounds 6 to 20, live data at Round 20, the actual grid of every race,
8,000 simulated races per forecast; 15 races, 330 driver-race pairs) says where they stand.

| Check | Result |
|---|---|
| Points chance 10-20% | forecast 15.7%, happened 5.1% (79 pairs) |
| Points chance 20-30% | forecast 24.1%, happened 23.7% (76 pairs) |
| Points chance 80-90% | forecast 84.5%, happened 85.9% (64 pairs) |
| Expected finish over all pairs | mean predicted place 0.14 higher than the place that happened; mean absolute error 3.9 |
| Starting 16th to 20th | points 22.3% forecast against 10.7%; expected finish 15.1 against 16.8 |
| Starting 21st or 22nd | points 20.9% forecast against 20.0%; expected finish 15.7 against 17.0 |

The order carries information (points Brier 0.144 against 0.248 for "10/22 for everyone"), but the level near the back
is too high, and the 10-20% band is where it shows most. The cause is the pace fit, not the forecast code:
`paceStages` 5 sees only who finishes in the top five, so a driver who never gets there is almost indistinguishable
from the rest of the midfield. At Round 20, HUL and PER have `theta` -1.16 and -1.05 (0.11 apart), while their average
classified finish is 11.0 against 16.2 and their top-ten finishes are 5 of 20 against 0 of 20. With every finishing
place (same half-life and prior) the strengths are 0.05 and -1.64, 1.7 apart. So at the back the forecast is driven
almost only by the grid and by retirements: with the Round 21 test grid, PER (21st) gets 13% for the points and an
expected finish of 15.9, HUL (15th) 18% and 14.8. This season's retirement rate makes that large: 81 of 440 race
starts (18.4%) were not classified, and 11 of the 20 races had at least four retirements.

This is a **limit of v2, recorded on purpose** and input for the next model version (v3), not a reason to change a
default: 2026 is the confirmation season of the D30 protocol, so its numbers cannot choose a setting. A points-specific
pace fit is a candidate for the next declared evaluation. On the same races, `paceStages` 8 (everything else at its
default) gives a points Brier of 0.1357 against 0.1434 now, and separates HUL and PER (0.93 instead of 0.11); every
finishing place gives 0.1411, and no grid at the current default gives 0.1594.

### Model v3: points chance and expected finish (Phase 9, protocol D53)

**Result: rejected. v2 stays, and the "indicative" note stays.** No candidate passed D53. This section records what was
tried and the numbers; the full output of the run is at the end.

**Question.** Phase 8 found that the points chance and the expected finish read too well for the middle and the back of
the grid, and put the blame on the pace fit (`paceStages` 5 sees only the top five places). A 2026-only look
(`paceStages` 8: points Brier 0.1357 against 0.1434) suggested a fix, but 2026 is the confirmation season and cannot
choose a setting. Phase 9 asked it properly, on 2022 to 2025, against the current defaults.

**What was run.** `bun run calibrate -- --points --sims 2000 --live ../F1GStats/f1gstats.sqlite`: 20 candidates, scored
race by race on the points Brier ("classified in the top ten", per driver-race pair) and, for information, on the
finish MAE (a retirement counts as last place), with the actual grid of every race and walk-forward forecasts from
round 6 (rounds 3 to 5 for the early-season check). The 2026 numbers are the live data of the run.

- **A, a larger global `paceStages`:** 5, 8, 10, all places (99), with `priorStrength` 0.5, 1, 3 (11 candidates, the
  default itself left out). It changes win and podium too, so it must also pass rule 5.
- **B, a separate finish fit (`finishStages`):** 8, 10, all places (99), with the same priors (9 candidates). At the
  default prior win and podium are exactly today's numbers. At another prior they are not (the prior is shared by both
  passes), so rule 5 applies there too.

**D53**, all of these, on the points Brier per race (difference from the default, candidate minus default):

1. 2025 beats the default by more than 2 SE and by at least 0.004.
2. Better on at least 3 of the 4 seasons 2022 to 2025.
3. 2026 not worse by more than 1 SE.
4. Rounds 3 to 5 not worse by more than 1 SE in any season.
5. For a candidate that can move them, win and podium log loss not worse by more than 1 SE in any season.
6. In the pooled 2022 to 2025 reliability table, no band off by more than 5 points. A band is judged only with at
   least 30 pairs (`MIN_BAND_PAIRS`; the rule as first written did not say, and a band of 6 pairs says nothing).

Each family's candidate was chosen on 2022 to 2024 alone; validation, history, early season and 2026 only judged it.
The finish MAE is shown but is not one of the rules.

**What came out.**

| | Choice on 2022-2024 | 2025 (rule 1) | Early season (rule 4) | Win and podium (rule 5) | Reliability bands over 5 points (rule 6) |
|---|---|---|---|---|---|
| A | `paceStages` 8, prior 3 | -0.0013 (±0.0027): fails | worse in 2023 and 2025 | worse in 2022 and 2026 | 5 of 9 judged bands |
| B | `finishStages` 10, prior 3 | -0.0022 (±0.0027): fails | worse in 2023 and 2025 | worse in 2022 and 2026 | 5 of 10 judged bands |

- **No candidate passes rule 1.** The best of all 20 on 2025 is B with all places and prior 3: -0.0059 (±0.0030), just
  short of two standard errors (0.0060), and it fails the early-season rule as well.
- **Rule 4 fails for every one of the 20 candidates.** On rounds 3 to 5 every candidate is worse than the default in at
  least one season.
- **The training result is not distinguishable from nothing.** The best pooled 2022-2024 difference is -0.0033 (±0.0019)
  against a default points Brier of 0.1491 (±0.0076); the finish MAE changes by -0.04 to +0.05 places (±0.01 to ±0.04).
- **The closest to a result is B at the default prior,** the one that leaves win and podium as they are:
  `finishStages` 8 and 10 bring the worst pooled reliability band down from 9.1 points (the default) to 5.0 and 4.7.
  But on 2025 they are +0.0019 (±0.0028) and +0.0018 (±0.0035), worse than the default, and they fail the early season.
- **The 2026 hint does not replicate.** On 2026 alone (printed last, not used to choose) B at `finishStages` 8 and 10
  gives -0.0079 (±0.0052) and -0.0059 (±0.0050) on the points Brier and -0.14 and -0.13 places on the finish MAE, in line
  with the Phase 8 look at 2026. On 2022 to 2025 the same settings do not show it: that is the reason for the protocol.

**The current defaults fail rule 6 themselves.** Five of the nine judged bands are off by more than 5 points: 10-20%
(forecast 15.8%, happened 9.6%), 30-40% (+5.1), 40-50% (+6.2), 50-60% (+9.1) and 60-70% (+5.2). So the rule cannot
separate a candidate from the default, and with 49 to 291 pairs a band's own sampling error is about 1 to 7 points (a band of
49 pairs near 55% has about 7), which is as large as the tolerance. It did not decide this verdict: rules 1 and 4 fail
for every candidate before it matters. It is recorded here as a weakness of the rule for the next time.

**Decision.** `MODEL_VERSION` stays `"v2"`, no default changes, and the note under the race forecast ("Indicative; the
model is fitted for the front of the field.") stays. The setting `finishStages` stays in the engine with default 0 (the
v2 behavior), and `bun run calibrate -- --points` stays as the way to re-run this when the data or the model changes.

**What this points to.** Varying the pace fit moves the points chance very little, so the gap is probably not the pace
fit alone. In the pooled 2022 to 2025 table the default over-forecasts the 10-20% band by 6 points and under-forecasts
the 30-70% bands by 5 to 9 points, and no candidate changes that much (the 10-20% gap is 5.8 and 6.9 points for the two
chosen ones). A separate retirement-rate check is the next candidate, as `docs/PHASE_9.md` says; it is not part of this
phase.

Full output of the run:

```
Loading calibration data (seasons 2022-2025 history + 2026 live)...
Running evaluation with 2000 simulations per forecast...

=== Points Chance and Expected Finish (Phase 9, protocol D53) ===
The outcome is "classified in the top ten" (points Brier, lower is better); a retirement counts as last place
for the finish. Candidates are compared with the current defaults on the same races; differences are per race,
candidate minus default (negative = better). Finish MAE is shown for information: D53 judges the points Brier.
Rule 6 judges a reliability band only with at least 30 pairs. Each family's candidate is chosen on 2022-2024 only.

--- Current defaults ---
  Season  Role   Races      Points Brier    Finish MAE
  2022    Train     17  0.1598 (±0.0115)  3.71 (±0.18)
  2023    Train     17  0.1510 (±0.0146)  3.48 (±0.20)
  2024    Train     19  0.1377 (±0.0133)  3.11 (±0.20)
  2025    Valid     19  0.1715 (±0.0116)  3.57 (±0.17)
  22-24   Train     53  0.1491 (±0.0076)  3.42 (±0.12)

--- Candidates: training and validation ---
  candidate                                      Train (22-24)       Valid (2025)  Hist Imp  Early  Win/podium  Band gap      MAE Train      MAE Valid
  A paceStages=5, prior=0.5                  +0.0011 (±0.0009)  +0.0056 (±0.0016)       0/4  worse       worse   10.8 pt  -0.01 (±0.01)  +0.04 (±0.02)
  A paceStages=5, prior=3                    +0.0014 (±0.0015)  -0.0036 (±0.0024)       2/4  worse       worse   13.5 pt  +0.05 (±0.02)  -0.01 (±0.02)
  A paceStages=8, prior=0.5                  +0.0009 (±0.0032)  +0.0053 (±0.0029)       2/4  worse       worse    7.6 pt  -0.03 (±0.04)  +0.01 (±0.05)
  A paceStages=8, prior=1                    -0.0016 (±0.0026)  +0.0026 (±0.0027)       3/4  worse       worse    6.2 pt  -0.04 (±0.03)  -0.01 (±0.04)
  A paceStages=8, prior=3                    -0.0033 (±0.0019)  -0.0013 (±0.0027)       4/4  worse       worse    9.2 pt  -0.02 (±0.02)  -0.02 (±0.04)
  A paceStages=10, prior=0.5                 -0.0012 (±0.0024)  +0.0043 (±0.0038)       2/4  worse       worse    5.9 pt  -0.04 (±0.03)  -0.01 (±0.06)
  A paceStages=10, prior=1                   -0.0023 (±0.0021)  +0.0023 (±0.0034)       3/4  worse       worse    6.4 pt  -0.04 (±0.03)  -0.02 (±0.05)
  A paceStages=10, prior=3                   -0.0033 (±0.0020)  -0.0014 (±0.0027)       4/4  worse       worse   11.2 pt  -0.02 (±0.02)  -0.03 (±0.04)
  A paceStages=all places (99), prior=0.5    -0.0025 (±0.0022)  -0.0028 (±0.0032)       3/4  worse       worse   11.2 pt  -0.02 (±0.02)  -0.05 (±0.06)
  A paceStages=all places (99), prior=1      -0.0026 (±0.0021)  -0.0036 (±0.0032)       3/4  worse       worse   10.0 pt  -0.02 (±0.02)  -0.05 (±0.05)
  A paceStages=all places (99), prior=3      -0.0023 (±0.0023)  -0.0053 (±0.0031)       3/4  worse       worse   15.5 pt  +0.00 (±0.02)  -0.05 (±0.05)
  B finishStages=8, prior=0.5                +0.0008 (±0.0032)  +0.0048 (±0.0030)       2/4  worse       worse    5.7 pt  -0.02 (±0.04)  +0.01 (±0.05)
  B finishStages=8, prior=1                  -0.0017 (±0.0026)  +0.0019 (±0.0028)       2/4  worse        same    5.0 pt  -0.03 (±0.03)  -0.01 (±0.04)
  B finishStages=8, prior=3                  -0.0031 (±0.0020)  -0.0023 (±0.0027)       4/4  worse       worse    7.9 pt  -0.01 (±0.02)  -0.02 (±0.03)
  B finishStages=10, prior=0.5               -0.0009 (±0.0023)  +0.0040 (±0.0040)       2/4  worse       worse    4.6 pt  -0.03 (±0.03)  -0.01 (±0.05)
  B finishStages=10, prior=1                 -0.0021 (±0.0021)  +0.0018 (±0.0035)       3/4  worse        same    4.7 pt  -0.03 (±0.03)  -0.02 (±0.05)
  B finishStages=10, prior=3                 -0.0032 (±0.0020)  -0.0022 (±0.0027)       4/4  worse       worse   10.1 pt  -0.01 (±0.02)  -0.03 (±0.04)
  B finishStages=all places (99), prior=0.5  -0.0023 (±0.0022)  -0.0033 (±0.0032)       3/4  worse       worse   13.9 pt  -0.02 (±0.02)  -0.05 (±0.05)
  B finishStages=all places (99), prior=1    -0.0024 (±0.0021)  -0.0041 (±0.0031)       3/4  worse        same   13.1 pt  -0.01 (±0.02)  -0.05 (±0.05)
  B finishStages=all places (99), prior=3    -0.0021 (±0.0023)  -0.0059 (±0.0030)       3/4  worse       worse   12.8 pt  +0.01 (±0.02)  -0.05 (±0.05)
  Win/podium: "same" = cannot move them (finishStages at the default prior); otherwise not worse than 1 SE in any season.

--- Chosen on training (2022-2024 only) ---
  A paceStages=8, prior=3
  B finishStages=10, prior=3

--- Reliability, pooled 2022-2025, finishing in the points ---
Current defaults
  forecast  pairs  forecast mean  happened   gap
  0-10%         6           9.4%      0.0%  -9.4  thin, not judged
  10-20%      291          15.8%      9.6%  -6.2
  20-30%      281          24.2%     27.0%  +2.8
  30-40%      179          34.6%     39.7%  +5.1
  40-50%       77          44.5%     50.6%  +6.2
  50-60%       49          54.2%     63.3%  +9.1
  60-70%       51          65.4%     70.6%  +5.2
  70-80%       74          75.6%     79.7%  +4.2
  80-90%      163          85.9%     84.7%  -1.2
  90-100%     268          94.6%     90.3%  -4.3

A paceStages=8, prior=3
  forecast  pairs  forecast mean  happened   gap
  0-10%        11           9.5%      0.0%  -9.5  thin, not judged
  10-20%      269          15.5%      8.6%  -6.9
  20-30%      264          24.4%     24.2%  -0.2
  30-40%      175          34.4%     37.1%  +2.7
  40-50%       96          44.4%     52.1%  +7.7
  50-60%       68          54.6%     60.3%  +5.7
  60-70%       72          64.4%     73.6%  +9.2
  70-80%       81          75.4%     84.0%  +8.6
  80-90%      172          85.8%     84.3%  -1.5
  90-100%     231          94.3%     91.3%  -3.0

B finishStages=10, prior=3
  forecast  pairs  forecast mean  happened    gap
  0-10%        34           8.7%      2.9%   -5.7
  10-20%      244          15.2%      9.4%   -5.8
  20-30%      264          24.7%     22.3%   -2.4
  30-40%      164          34.6%     39.0%   +4.4
  40-50%      106          44.6%     50.9%   +6.4
  50-60%       70          54.9%     57.1%   +2.3
  60-70%       76          64.9%     75.0%  +10.1
  70-80%       86          75.4%     84.9%   +9.5
  80-90%      165          85.6%     83.0%   -2.6
  90-100%     230          94.2%     92.2%   -2.1

=== Confirmation (2026, printed last) ===
Not used to choose. It only decides whether the choice may be adopted (rule 3), together with the other rules.
  candidate                                    2026 Brier diff  2026 MAE diff         Early 2026  Hist Imp  D53
  A paceStages=5, prior=0.5                  -0.0011 (±0.0009)  -0.01 (±0.01)  +0.0024 (±0.0022)       0/4   no
  A paceStages=5, prior=3                    +0.0035 (±0.0017)  +0.05 (±0.02)  +0.0001 (±0.0020)       2/4   no
  A paceStages=8, prior=0.5                  -0.0075 (±0.0060)  -0.17 (±0.06)  -0.0028 (±0.0295)       2/4   no
  A paceStages=8, prior=1                    -0.0081 (±0.0051)  -0.15 (±0.05)  -0.0049 (±0.0212)       3/4   no
  A paceStages=8, prior=3                    -0.0055 (±0.0038)  -0.08 (±0.04)  -0.0046 (±0.0114)       4/4   no
  A paceStages=10, prior=0.5                 -0.0058 (±0.0052)  -0.15 (±0.06)  -0.0112 (±0.0312)       2/4   no
  A paceStages=10, prior=1                   -0.0060 (±0.0049)  -0.14 (±0.06)  -0.0114 (±0.0250)       3/4   no
  A paceStages=10, prior=3                   -0.0045 (±0.0042)  -0.08 (±0.05)  -0.0092 (±0.0145)       4/4   no
  A paceStages=all places (99), prior=0.5    -0.0029 (±0.0049)  -0.15 (±0.06)  -0.0012 (±0.0307)       3/4   no
  A paceStages=all places (99), prior=1      -0.0029 (±0.0048)  -0.14 (±0.06)  -0.0044 (±0.0254)       3/4   no
  A paceStages=all places (99), prior=3      -0.0014 (±0.0047)  -0.09 (±0.06)  -0.0060 (±0.0170)       3/4   no
  B finishStages=8, prior=0.5                -0.0075 (±0.0061)  -0.16 (±0.06)  -0.0029 (±0.0320)       2/4   no
  B finishStages=8, prior=1                  -0.0079 (±0.0052)  -0.14 (±0.05)  -0.0046 (±0.0240)       2/4   no
  B finishStages=8, prior=3                  -0.0053 (±0.0039)  -0.07 (±0.04)  -0.0035 (±0.0137)       4/4   no
  B finishStages=10, prior=0.5               -0.0054 (±0.0054)  -0.14 (±0.06)  -0.0106 (±0.0333)       2/4   no
  B finishStages=10, prior=1                 -0.0059 (±0.0050)  -0.13 (±0.06)  -0.0109 (±0.0268)       3/4   no
  B finishStages=10, prior=3                 -0.0043 (±0.0044)  -0.07 (±0.05)  -0.0077 (±0.0167)       4/4   no
  B finishStages=all places (99), prior=0.5  -0.0023 (±0.0050)  -0.14 (±0.06)  -0.0006 (±0.0330)       3/4   no
  B finishStages=all places (99), prior=1    -0.0021 (±0.0048)  -0.13 (±0.06)  -0.0038 (±0.0277)       3/4   no
  B finishStages=all places (99), prior=3    -0.0006 (±0.0049)  -0.08 (±0.06)  -0.0041 (±0.0201)       3/4   no

Verdict A: paceStages=8, prior=3 does NOT pass D53. Reasons:
  - 2025 diff -0.0013 does not beat the default by > 2 SE (-0.0054)
  - 2025 diff -0.0013 is less than the threshold -0.004
  - Early season (rounds 3-5) of 2023 worse by > 1 SE (diff 0.0093 > SE 0.0019)
  - Early season (rounds 3-5) of 2025 worse by > 1 SE (diff 0.0063 > SE 0.0035)
  - Win and podium of 2022 worse by > 1 SE (diff 0.0242 > SE 0.0071)
  - Win and podium of 2026 worse by > 1 SE (diff 0.0108 > SE 0.0062)
  - Band 10-20% of the pooled reliability table is off by 6.9 points (limit 5)
  - Band 40-50% of the pooled reliability table is off by 7.7 points (limit 5)
  - Band 50-60% of the pooled reliability table is off by 5.7 points (limit 5)
  - Band 60-70% of the pooled reliability table is off by 9.2 points (limit 5)
  - Band 70-80% of the pooled reliability table is off by 8.6 points (limit 5)
Verdict B: finishStages=10, prior=3 does NOT pass D53. Reasons:
  - 2025 diff -0.0022 does not beat the default by > 2 SE (-0.0054)
  - 2025 diff -0.0022 is less than the threshold -0.004
  - Early season (rounds 3-5) of 2023 worse by > 1 SE (diff 0.0199 > SE 0.0123)
  - Early season (rounds 3-5) of 2025 worse by > 1 SE (diff 0.0108 > SE 0.0048)
  - Win and podium of 2022 worse by > 1 SE (diff 0.0138 > SE 0.0037)
  - Win and podium of 2026 worse by > 1 SE (diff 0.0093 > SE 0.0025)
  - Band 0-10% of the pooled reliability table is off by 5.7 points (limit 5)
  - Band 10-20% of the pooled reliability table is off by 5.8 points (limit 5)
  - Band 40-50% of the pooled reliability table is off by 6.4 points (limit 5)
  - Band 60-70% of the pooled reliability table is off by 10.1 points (limit 5)
  - Band 70-80% of the pooled reliability table is off by 9.5 points (limit 5)
Recommendation: change nothing; no chosen candidate passes D53 (D52: B is preferred when it passes, then A).
```

### Multi-season prior (Phase 11, protocol D64)

**Result: rejected. v2 stays.** The candidate chosen on the tuning seasons improves the first five races on all three
seasons and is level on the whole season, but its pooled early-season gain is 1.8 standard errors, short of the two that
D64 asks for. Steps 4 and 5 of Phase 11 (the previous season at runtime and the UI label) are therefore not built.

**Question.** At the start of a season the model knows nothing about the new season, so the first rounds and the
"Season not started" state rest on the prior alone (every driver equal). Does letting last season's results count, with
a discount, forecast the first five races better?

**What was run.** `bun run calibrate -- --carryover`: six candidates (`priorCarryover` 0.25, 0.5 and 1, each with all
teams or same team only) against v2 (`priorCarryover` 0, which reproduces v2 exactly), on 2023, 2024 and 2025, each with
the season before it from the history folder, and 2026 with 2025 (informational: 2026 started after a regulation reset,
so a carryover should be switched off there, D63). Walk-forward forecasts from round 1, scored per race on the win plus
podium log loss; rounds 1-5 are the early window and the whole season is the second window. The candidate is chosen on
2023-2024 alone; 2025 judges it and 2026 is printed for information.

**D64**, all of these:

1. 2025, rounds 1-5: better than v2 by more than 1 SE and by at least 0.005 per race.
2. The pooled rounds 1-5 of 2023 to 2025: better by more than 2 SE.
3. At least 2 of the 3 seasons improve on rounds 1-5.
4. The whole season is not worse by more than 1 SE in any of the 3 seasons.
5. The candidate judged is the best on 2023-2024.

**What came out.**

| Candidate | 2023 r1-5 | 2024 r1-5 | 2025 r1-5 | Train 23-24 | Pooled 23-25 | Whole season 23 / 24 / 25 |
|---|---|---|---|---|---|---|
| 0.25, all teams | -0.000 (±0.021) | -0.036 (±0.031) | -0.024 (±0.021) | -0.018 (±0.019) | -0.020 (±0.014) | +0.001 / -0.010 / -0.008 |
| 0.25, same team (chosen) | -0.010 (±0.013) | -0.034 (±0.032) | -0.026 (±0.021) | **-0.022 (±0.017)** | **-0.023 (±0.013)** | -0.001 / -0.009 / -0.007 |
| 0.5, all teams | +0.012 (±0.027) | -0.038 (±0.034) | -0.025 (±0.025) | -0.013 (±0.022) | -0.017 (±0.017) | +0.007 / -0.010 / -0.010 |
| 0.5, same team | -0.005 (±0.015) | -0.036 (±0.035) | -0.027 (±0.025) | -0.020 (±0.018) | -0.022 (±0.014) | +0.003 / -0.009 / -0.009 |
| 1, all teams | +0.027 (±0.033) | -0.038 (±0.036) | -0.024 (±0.028) | -0.005 (±0.025) | -0.011 (±0.019) | +0.014 / -0.009 / -0.010 |
| 1, same team | +0.001 (±0.016) | -0.035 (±0.036) | -0.026 (±0.028) | -0.017 (±0.020) | -0.020 (±0.016) | +0.008 / -0.008 / -0.009 |

- **Rules 1, 3 and 4 pass** for the chosen candidate: 2025 rounds 1-5 -0.026 (±0.021), all three seasons better on
  rounds 1-5, and the whole season -0.001 (±0.004), -0.009 (±0.007), -0.007 (±0.006).
- **Rule 2 fails, narrowly.** The pooled rounds 1-5 difference is -0.0232 (±0.0127): 1.8 standard errors, where D64
  asks for more than 2 (-0.0255). It is short by 0.0023 per race.
- **A larger carryover does not help.** At 0.5 and 1 the early window is about the same in 2024 and 2025, and 2023 gets
  worse (+0.027 for 1 with all teams): the season before 2023 (2022) says less about it than 2023 says about 2024.
- **The whole season never suffers.** Rule 4 passes for every candidate, so a carryover would not damage the later part
  of a season; the gain (and the loss) sits in the first five races, as intended.
- **2026 does not punish it.** For the chosen candidate the early window is -0.001 (±0.024) and the whole season
  -0.001 (±0.007); even a carryover of 1 costs only +0.021 (±0.030) on rounds 1-5. The regulation reset of 2026 is
  recorded here as a small cost, not the large one D63 warns about, so no extra warning goes into the rollover guide
  beyond "set it to 0 for a reset".

**Decision.** `MODEL_VERSION` stays `"v2"` and `priorCarryover` stays 0 in the defaults. The engine keeps the three
parameters (`priorCarryover` 0 reproduces v2 exactly, seeds included) and `bun run calibrate -- --carryover` stays as
the way to re-run this when a season is added. Steps 4 and 5 of Phase 11 are skipped.

**What this points to.** The early-season gain is real in 2024 and 2025 but small and noisy over three seasons, and it
is the only place it shows. With 2026 in the history folder, the next run (2027 carrying 2026) has four seasons and 20
pooled races instead of 15; that is the time to look again, not a reason to loosen D64 now.

Full output of the run:

```
Loading calibration data (seasons 2022-2025 history + 2026 live)...
Running evaluation with 2000 simulations per forecast...

=== Multi-season prior (Phase 11, protocol D64) ===
Baseline: v2, with the previous season attached and priorCarryover 0 (the fit is exactly today's).
Differences are per race (win + podium log loss), candidate minus v2, negative = better. The early window is
rounds 1-5. 2026 is informational only: it started after a regulation reset, so the carryover should be 0 there (D63).

--- Rounds 1-5 (the early season) ---
  carryover      teams               2023               2024               2025               2026        Train 23-24       Pooled 23-25
  0.25             all  -0.0003 (±0.0207)  -0.0357 (±0.0314)  -0.0241 (±0.0213)  -0.0028 (±0.0231)  -0.0180 (±0.0187)  -0.0201 (±0.0139)
  0.25       same team  -0.0097 (±0.0129)  -0.0339 (±0.0317)  -0.0260 (±0.0214)  -0.0014 (±0.0235)  -0.0218 (±0.0166)  -0.0232 (±0.0127)
  0.5              all  +0.0123 (±0.0269)  -0.0382 (±0.0339)  -0.0254 (±0.0250)  +0.0092 (±0.0274)  -0.0129 (±0.0221)  -0.0171 (±0.0165)
  0.5        same team  -0.0046 (±0.0149)  -0.0356 (±0.0345)  -0.0266 (±0.0249)  +0.0102 (±0.0276)  -0.0201 (±0.0184)  -0.0223 (±0.0143)
  1                all  +0.0272 (±0.0329)  -0.0377 (±0.0359)  -0.0235 (±0.0283)  +0.0210 (±0.0298)  -0.0052 (±0.0254)  -0.0113 (±0.0189)
  1          same team  +0.0011 (±0.0160)  -0.0351 (±0.0364)  -0.0261 (±0.0276)  +0.0227 (±0.0302)  -0.0170 (±0.0197)  -0.0200 (±0.0155)

--- Whole season (rule 4: not worse than 1 SE in any of 2023-2025) ---
  carryover      teams               2023               2024               2025               2026
  0.25             all  +0.0011 (±0.0049)  -0.0097 (±0.0070)  -0.0082 (±0.0055)  -0.0005 (±0.0074)
  0.25       same team  -0.0006 (±0.0036)  -0.0092 (±0.0070)  -0.0074 (±0.0056)  -0.0005 (±0.0074)
  0.5              all  +0.0066 (±0.0070)  -0.0101 (±0.0080)  -0.0096 (±0.0073)  +0.0050 (±0.0096)
  0.5        same team  +0.0027 (±0.0047)  -0.0094 (±0.0081)  -0.0087 (±0.0071)  +0.0047 (±0.0092)
  1                all  +0.0144 (±0.0093)  -0.0092 (±0.0095)  -0.0103 (±0.0094)  +0.0139 (±0.0117)
  1          same team  +0.0079 (±0.0062)  -0.0084 (±0.0096)  -0.0093 (±0.0089)  +0.0131 (±0.0112)

--- Chosen on the tuning seasons (2023-2024 only) ---
  priorCarryover 0.25, same team only

Verdict: NOT adopted. Reasons:
  - Pooled 2023-2025 rounds 1-5 diff -0.0232 does not beat v2 by > 2 SE (-0.0255)

v2 stays; the carryover is recorded as rejected in docs/MODEL.md, and Steps 4 and 5 are skipped.
```

## Limits

- **One season of data.** The model fits only the current season; history is used to choose the settings, not as a prior. Phase 11 tested last season's results as a prior and rejected it (the best tuning candidate failed D64 by 0.0023 per race on the pooled first five races; `docs/MODEL.md`), so early-season odds are wide and are flagged `low confidence` below 5 completed rounds.
- **About 11 test races and 11 winners.** The backtest can tell a model from guessing and a good setting from a bad one
  when the difference is large; it cannot tell a good model from a very good one. The 2026 tables above were not used
  to choose the v2 defaults; the choice rests on 2022 to 2025 (Step 6).
- **Title odds cannot be calibrated.** A single season has exactly one champion. The backtest checks race forecasts, a
  proxy; the title odds themselves are only sanity-checked (clinched always 100% of simulations, eliminated never, a
  locked session moves the numbers the way the points do).
- **What-if odds depend on the pace gap, and the pace gap depends on how old results are weighed.** In v1 the scenario "ANT out of the next four races, RUS wins all four" gave RUS 42% with a half-life of 8 rounds and 50% with no decay. Under v2 it is 51% without the grid and 50% with it (Step 9). Treat the number as one reading of a close contest, not a measurement.
- **The race forecast's points chance and expected finish are indicative, not validated.** The backtest scores win and
  podium only, so the middle and the back of the field are held to a fit made for the front: `paceStages` 5 cannot
  separate drivers who never finish in the top five. On 2026 the 10-20% points band was overpredicted (15.7% forecast
  against 5.1% happened), and the slowest cars were given a points chance they did not have (PER, BOT and STR 13% to
  16% a race against none in the 15 races checked). The sections above have the numbers. Phase 9 tested a
  points-specific pace fit on 2022 to 2025 and rejected it (20 candidates, none passed D53); the next candidate is the
  retirement rate.
- **What the model does not know:** upgrades, tracks, weather, penalties, grid positions beyond the next race (those are only simulated), reliability beyond a driver's
  own record, who is injured or about to leave. It sees only where drivers finished and whether they retired.
- **Strength uncertainty is a heuristic**, not a full Bayesian posterior: one noise size, shrinking with the number of
  races, the same for every driver with the same amount of data.
- **Future qualifying is simulated only as a grid.** Later races get a simulated qualifying order from the strengths and `qualifyingNoise`; it feeds the grid term and nothing else. The last countback step still uses past qualifying only.
- **Drivers are modelled one by one.** Teammates share no car effect beyond their own results.
- **Retired drivers.** A driver who has left never wins. The teams' table lists only teams that won at least one
  simulated season; the model has no "still alive" status for teams.
- **Numbers are for the current data and settings.** A change to the data, the locks, the slider or the parameters
  changes the odds. The same inputs always give the same odds.

## Changes to the defaults

| Parameter | v1 | v2 | Why |
|---|---|---|---|
| `paceStages` | 0 (all places) | 5 | Top-5 pace fit, largest gain, improved 4 of 4 history seasons (Phase 4, Steps 5 and 6) |
| `priorStrength` | 3 | 1 | With top-5 stages a weak prior no longer over-disperses the early rounds (D30 early-season check passes) |
| `recencyHalfLife` | none | 8 rounds | Best on 2022 to 2024 with top-5 stages; passes validation, history, 2026 and early season |
| `gridWeight` | 0 (no grid) | 1 | Beat v2 without the grid on 4 of 4 history seasons, validation (-0.073 per race, 3.2 SE) and 2026 (-0.084, 3.8 SE) (Phase 4, Step 7). The top of the grid tried |
| `qualifyingNoise` | 0 (no grid) | 2 | Maximizes the likelihood of the real grids of 2022 to 2024 (Phase 4, Step 8); used only for races with no real grid |

Phase 9 (the points chance and the expected finish) changed no default: 20 candidates were evaluated and none passed
D53 (see "Model v3" above). It added the setting `finishStages` with default 0, which is the v2 behavior.

`MODEL_VERSION` is `"v2"` and is shown in the odds result, in the feed (`model_version`) and in the panel's "How this works" note.

Rerun `bun run backtest` after any change to the model; `bun run backtest -- path/to/f1gstats.sqlite` uses the live
data instead of the snapshot (the numbers then differ from the tables here).
