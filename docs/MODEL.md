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

TODO (owner): paste the four tables printed by `bun run calibrate` here (training, validation, 2026, early season),
and list the rejected settings with their numbers. They are not in this card yet.

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

TODO (owner): run `bun run title-check` with the history files and paste the per-season and pooled tables here, with one
sentence on what they show. The rounds of one season are not independent, so a small gap between models means nothing.

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

## Limits

- **One season of data.** The model fits only the current season; history is used to choose the settings, not as a prior (Phase 7), so early-season odds are wide and are flagged `low
  confidence` below 5 completed rounds.
- **About 11 test races and 11 winners.** The backtest can tell a model from guessing and a good setting from a bad one
  when the difference is large; it cannot tell a good model from a very good one. The 2026 tables above were not used
  to choose the v2 defaults; the choice rests on 2022 to 2025 (Step 6).
- **Title odds cannot be calibrated.** A single season has exactly one champion. The backtest checks race forecasts, a
  proxy; the title odds themselves are only sanity-checked (clinched always 100% of simulations, eliminated never, a
  locked session moves the numbers the way the points do).
- **What-if odds depend on the pace gap, and the pace gap depends on how old results are weighed.** In v1 the scenario "ANT out of the next four races, RUS wins all four" gave RUS 42% with a half-life of 8 rounds and 50% with no decay. Under v2 it is 51% without the grid and 50% with it (Step 9). Treat the number as one reading of a close contest, not a measurement.
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

`MODEL_VERSION` is `"v2"` and is shown in the odds result, in the feed (`model_version`) and in the panel's "How this works" note.

Rerun `bun run backtest` after any change to the model; `bun run backtest -- path/to/f1gstats.sqlite` uses the live
data instead of the snapshot (the numbers then differ from the tables here).
