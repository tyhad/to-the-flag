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
| **Model (v2 defaults)** | 0.129 | 0.0374 | 1.944 | 0.256 | 0.0842 |
| Uniform | 0.185 | 0.0434 | 3.091 | 0.398 | 0.1178 |
| Points so far | 0.134 | 0.0380 | 2.023 | 0.253 | 0.0824 |

- The model **beats the uniform baseline** on every score.
- Against "points so far" the model is level: win log loss is better (0.129 against 0.134), podium log loss slightly
  worse (0.256 against 0.253). Race by race (win and podium log loss added up) the difference is -0.001 per race,
  standard error 0.007: not clearly different. (With the v1 defaults the model was clearly worse, by 0.055 per race.)

These numbers are the 2026 season only and are the **confirmation** season of the Phase 4 protocol (see below); they
were not used to choose the v2 defaults.

### Settings tried on 2026 alone (Phase 3, Step 10, rerun with v2 code)

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
- **What-if odds depend on the pace gap, and the pace gap depends on how old results are weighed.** In v1 the scenario "ANT out of the next four races, RUS wins all four" gave RUS 42% with a half-life of 8 rounds and 50% with no decay. The v2 figure is measured in Step 9. Treat the number as one reading of a close contest, not a measurement.
- **What the model does not know:** upgrades, tracks, weather, grid positions, penalties, reliability beyond a driver's
  own record, who is injured or about to leave. It sees only where drivers finished and whether they retired.
- **Strength uncertainty is a heuristic**, not a full Bayesian posterior: one noise size, shrinking with the number of
  races, the same for every driver with the same amount of data.
- **Future qualifying is not simulated.** The last countback step uses past qualifying only.
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

Rerun `bun run backtest` after any change to the model; `bun run backtest -- path/to/f1gstats.sqlite` uses the live
data instead of the snapshot (the numbers then differ from the tables here).
