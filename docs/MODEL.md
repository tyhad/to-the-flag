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
   with little data towards the average (`priorStrength`). Strengths are centred on 0.
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
| `recencyHalfLife` | none | rounds after which a session counts half as much; "none" means every session counts the same |
| `sprintWeight` | 0.5 | weight of a sprint next to a race in the pace fit |
| `priorStrength` | 3 | weight of the dummy driver's comparisons; higher means more shrinkage towards equal |
| `strengthSigma` | 0.25 | noise on a driver's strength; for a driver with `n` effective races it is `0.25 * sqrt(6 / (6 + n))` |
| `dnfPriorSessions` | 4 | how many virtual races the field's retirement rate counts for |
| `sprintDnfFactor` | 0.5 | sprint retirement chance = race chance times this |
| `includeDnf` | true | retirements on or off |

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
| **Model (defaults)** | 0.143 | 0.0394 | 2.220 | 0.298 | 0.0948 |
| Uniform | 0.185 | 0.0434 | 3.091 | 0.398 | 0.1178 |
| Points so far | 0.134 | 0.0380 | 2.023 | 0.253 | 0.0824 |

- The model **beats the uniform baseline** on every score.
- The model **loses to "points so far"** on every score. Race by race (win and podium log loss added up) the model is
  worse by 0.055 per race, standard error 0.010: clearly worse. It is better than guessing, but in 2026 a plain share
  of the points predicted single races better.

### Settings tried

Total = win log loss + podium log loss, over the same 11 races and the same random numbers. `*` is the default.

| half-life \ prior | 0.5 | 1 | 2 | 3 |
|---|---|---|---|---|
| 4 rounds | 0.454 | 0.456 | 0.460 | 0.467 |
| 8 rounds | 0.444 | 0.446 | 0.450 | 0.456 |
| 16 rounds | 0.438 | 0.439 | 0.444 | 0.449 |
| no decay | **0.431** | 0.432 | 0.436 | 0.441 `*` |

Less decay and a weaker prior were better in every row and column. "Clearly better" is defined in the script as more
than two standard errors across races **and** at least 0.005 per race (a very consistent but tiny gain is not worth a change).

- **Changed: `recencyHalfLife` from 8 rounds to no decay.** It is clearly better than 8 (0.015 per race, standard error
  0.004) and than 16 (0.008, standard error 0.002), and it is better in both halves of the test (rounds 6 to 11 and 12 to 16).
  The 2026 pace order barely moved, so a long memory won. A season with big mid-season shifts may want a half-life of 8 to
  16 rounds; this should be checked again when another season is available.
- **Not changed: `priorStrength` stays 3.** A weaker prior (0.5) also tested clearly better, by 0.010 per race (standard
  error 0.003). But the test starts at round 6, so it cannot judge rounds 1 to 5, where little data makes the fit
  over-confident: on synthetic data one race with a weak prior spread the strengths wider than a full season's. The
  prior costs about 0.01 per race here and protects the early season. This is a judgment, not a measurement; it is the
  first thing to revisit with more data.
- `strengthSigma` (0, 0.25, 0.5) makes no visible difference to single-race forecasts (total 0.441, 0.441, 0.442). It
  acts across a whole simulated season, so this test cannot say whether 0.25 is right for the title odds.

### Calibration

When the model says a given chance, how often did it happen (defaults, all driver-race pairs)?

| Forecast chance | win: pairs | forecast | happened | podium: pairs | forecast | happened |
|---|---|---|---|---|---|---|
| 0-5% | 172 | 1.9% | 0.0% | 67 | 2.2% | 0.0% |
| 5-10% | 32 | 7.7% | 9.4% | 72 | 7.4% | 1.4% |
| 10-20% | 36 | 13.1% | 19.4% | 39 | 13.3% | 17.9% |
| 20-40% | 2 | 27.9% | 50.0% | 54 | 29.9% | 42.6% |
| 40-70% | 0 | - | - | 10 | 48.1% | 20.0% |

Read with care: there are only 11 winners, so the win columns above 10% rest on a handful of events (the 20-40% row is
2 pairs). The clearest signals: at the back of the field the model gives about 2% to drivers who never won (about 3 wins
expected, none seen), and in the middle (10-40%) the drivers it favoured did somewhat better than forecast. Together
that looks **too flat**: not enough weight on the favourites and too much on the back. One likely cause is that the
shrinkage and the noise keep every driver's chance from getting small; that is a guess, not something tested.

## Limits

- **One season of data.** There is no prior from earlier seasons, so early-season odds are wide and are flagged `low
  confidence` below 5 completed rounds.
- **About 11 test races and 11 winners.** The backtest can tell a model from guessing and a good setting from a bad one
  when the difference is large; it cannot tell a good model from a very good one. The grid was chosen on the same 11
  races it is judged on, so the gains above are somewhat optimistic.
- **Title odds cannot be calibrated.** A single season has exactly one champion. The backtest checks race forecasts, a
  proxy; the title odds themselves are only sanity-checked (clinched always 100% of simulations, eliminated never, a
  locked session moves the numbers the way the points do).
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

| Parameter | Planned | Now | Why |
|---|---|---|---|
| `priorStrength` | 1 | 3 | With 1, one race of a 20-car field gave strengths more spread out than a full season's (Step 4); 3 shrinks small samples and still lets 16 rounds speak |
| `recencyHalfLife` | 8 rounds | none | Clearly better in the backtest (Step 10), see above |

Rerun `bun run backtest` after any change to the model; `bun run backtest -- path/to/f1gstats.sqlite` uses the live
data instead of the snapshot (the numbers then differ from the tables here).
