# Phase 11: Multi-season prior

Branch: `phase-11-prior` (to-the-flag; F1GStats is not touched, see D65). One commit per step, tests first wherever there is logic, `git push -u origin <branch>` on the first push, pull request and `gh pr merge --merge --delete-branch`. Read `AGENTS.md`, `SPEC.md` (D61 to D65), `docs/MODEL.md` (the D30 protocol and the Phase 9 section, which shows how a rejected candidate is recorded) and `docs/SEASON_ROLLOVER.md` before anything else.

**This is the last phase on the roadmap.** After it the project is in maintenance: the yearly rollover (`docs/SEASON_ROLLOVER.md`) and, only if the owner asks for them, the optional items (D45, a `gridWeight` above 1).

**Goal:** at the start of a season the model knows nothing about the new season, so the early rounds and the "Season not started" state rest on the prior alone (every driver equal). Test whether letting last season's results count, with a discount, improves the early-season forecasts, using the same kind of protocol as D30 and Phase 9.
**Not in Phase 11:** a team lineage table across renames (AlphaTauri, RB; Alfa Romeo, Sauber, Audi), detecting a regulation change automatically, track types, weather, anything about the points chance (Phase 9, rejected), a change to `F1GStats`.

## Decisions (all approved by the owner)

The thresholds in D64 may still be changed before Step 2 is written.

| # | Decision | Recommendation |
|---|---|---|
| D61 | Scope and outcome | An evaluation, like Phase 9: Steps 1 to 3 always happen; Steps 4 and 5 happen only if a candidate is adopted. Rejecting every candidate is a valid result and closes the phase after Step 3 and Step 6. The alternative is to skip Phase 11 and go straight to maintenance; the gain is limited to the first rounds of a season that is not a regulation reset (2027 is not expected to be one, 2026 was). |
| D62 | What is carried, and the candidates | The previous season's race sessions enter the strength fit for the same driver (matched by driver code), multiplied by `priorCarryover` and aged by the existing recency decay as if they happened `priorSeasonGap` rounds before round 1 (default 8, one half-life, fixed, not tuned). Candidates: `priorCarryover` 0.25, 0.5, 1 crossed with a team rule: *all* (a driver keeps last season's results after changing team) or *same team only* (the carried results count only when the driver stayed with the same constructor id). Six candidates against v2 (`priorCarryover` 0, which must reproduce v2 exactly). A driver with no previous results (a rookie) is unaffected. |
| D63 | Regulation-reset seasons | The model never decides this by itself. `priorCarryover` is a parameter and a setting (`TTF_PRIOR_CARRYOVER`, 0 to 1); the owner sets it to 0 for a season that starts with new regulations, and `docs/SEASON_ROLLOVER.md` says so. 2026 (a reset after 2025) is evaluated and recorded as the example of what happens when it is not switched off. |
| D64 | Adoption rule | Tune on the 2023 and 2024 seasons (each with the season before it as the previous one), validate on 2025, report 2026 as informational. Score: the per-race score `calibrate` already uses for D30, on rounds 1 to 5 and on the whole season. Adopt only if (1) on 2025, rounds 1 to 5 are better than v2 by more than 1 standard error and at least 0.005 per race; (2) the pooled 2023 to 2025 rounds 1 to 5 are better by more than 2 standard errors; (3) at least 2 of the 3 seasons improve on rounds 1 to 5; (4) the whole season is not worse than 1 standard error in any of the 3 seasons; (5) the chosen candidate is the best on the tuning seasons, not picked on 2025 or 2026. The thresholds are looser than D30 on 2025 (1 standard error, not 2) because there are only three usable seasons; the owner may change the numbers before Step 2 is written. 2026 never decides, but a large loss there is recorded and the rollover guide warns about it. |
| D65 | Where the previous season comes from | The app reads the previous season's SQLite file from the history folder (`F1GStats/history/f1gstats-<season - 1>.sqlite`, the files Phase 4 already uses), through the existing history loader, read-only; the folder is `TTF_HISTORY_DIR` (default `../F1GStats/history`). A missing file turns the carryover off and shows one plain line; it is never an error. This needs no change in F1GStats. The alternative is a table of last season's results inside every season file (schema version 3, both repos); it is cleaner for the app but costs a second repository change for the same result. |

## Steps

### Step 1 (engine): Carryover in the strength fit

**Goal:** the engine can use the previous season, and with `priorCarryover` 0 nothing changes.

**Change:** `OddsParams` gets `priorCarryover` (0 to 1, default 0), `priorSeasonGap` (rounds, default 8) and `priorSameTeamOnly` (boolean, default false). The strength fit takes the previous season's race sessions as an optional argument (the engine reads no files; the caller passes them). Previous sessions are weighted by `priorCarryover` times the recency decay at an age of `priorSeasonGap` plus the rounds since; sprint sessions follow the existing sprint weighting; the `paceStages` and prior rules are unchanged. `checkParams` validates the new values. `MODEL_VERSION` stays `"v2"` until Step 3 says otherwise.

**Tests first:**
- with `priorCarryover` 0, or with no previous season, every output (standings, strengths, odds, the race forecast) equals today's, including the seeds;
- a synthetic previous season in which one driver dominated gives that driver the best win odds at round 0 (the "Season not started" state), and the effect fades as the new season's results come in;
- a driver with no previous results is unaffected; with `priorSameTeamOnly` a driver who changed constructor gets no carried results;
- the previous season must be exactly one season earlier, otherwise it is refused (no leakage of a later season);
- the same seed gives the same result; `tests/enginePurity.test.ts` still passes (flat files, no `Date`, no `Math.random`, no I/O).

**Commit:** `feat(engine): carry last season's results into the strength fit`

### Step 2 (scripts): Evaluation

**Goal:** one command applies D64.

**Change:** `scripts/backtest.ts` can forecast a season with its previous season attached and score rounds 1 to 5 as a separate window. `scripts/calibrate.ts` gets `--carryover`: the six candidates against v2, per season (2023, 2024, 2025, then 2026 labeled "informational, regulation reset"), with standard errors, the pooled early-season row, and the D64 verdict with the reason for every failed rule. History comes from the existing loader (`HISTORY_SEASONS`); 2026 comes from the live file as before.

**Tests first (synthetic seasons):** the verdict is `no` when a candidate equals v2, when it wins only on 2025, when it fails the whole-season check, and when it is the best on 2025 but not on the tuning seasons; a season whose previous season is missing is skipped with a reason, never a crash.

**Commit:** `feat(scripts): carryover evaluation`

### Step 3 (owner's machine): Run it and decide

**Do:**
```
bun run calibrate -- --carryover
```
The four history files 2022 to 2025 must exist. If the 2026 season is complete by then, F1GStats can also write it into the history folder (`--season 2026 --output ..\F1GStats\history\f1gstats-2026.sqlite`), which the rollover guide will need anyway; it is not required for this step.

Paste the full output into `docs/MODEL.md` under "Multi-season prior (Phase 11)", whatever the verdict.

**If a candidate passes D64:** it becomes the default in the engine, `MODEL_VERSION` becomes `"v3"` (v2 stays reproducible with `priorCarryover` 0), and Steps 4 and 5 follow.
**If none passes:** keep v2, record "rejected, with numbers", skip Steps 4 and 5, and go to Step 6.

**Commit:** `feat(engine): model v3 with a season carryover` (adopted) or `docs: record the carryover evaluation` (rejected)

### Step 4 (only if adopted; data and API): Previous season at runtime

**Change:** `data/loadPrior.ts` reads `<TTF_HISTORY_DIR>/f1gstats-<season - 1>.sqlite` read-only through the history loader and hands the sessions to the engine. `config.ts` reads `TTF_HISTORY_DIR` and `TTF_PRIOR_CARRYOVER` (checked at start; an invalid value stops the server with a clear message; unset means the adopted default). The odds, race forecast and feeds use it. A missing or unreadable file means carryover 0 and a note, never a failure. `/api/season` (or the existing model-info route) says which previous season is used, the carryover, and the source (`history file` or `none`). `/api/feed/odds` gets the same two fields (additive; `docs/FEED.md`).

**Tests first:** a present file is used and a missing one is not an error (carryover 0, the note appears); a file of the wrong season is refused with a reason; `TTF_PRIOR_CARRYOVER=0` reproduces v2; an invalid value stops the start; no write to the history file (opened read-only); the existing offline and purity tests still pass.

**Commit:** `feat(api): use the previous season as a prior`

### Step 5 (only if adopted; UI): Say it plainly

**Change:** in "Season not started" the "Likely?" tab shows a pre-season estimate with the line "Pre-season estimate from 2026 results (carryover 0.5)"; while the carryover is above 0 the "Model estimate" note names it ("prior: 2026 results, carryover 0.5"); the PNG card carries the same short note while the season is in its first five rounds. "Possible?" is exact math and is unchanged. With the carryover 0 or no file, nothing new is shown.

**Tests first:** each text appears only in those states; the feed fields match the UI; no layout change at 1080 x 1080 and 1920 x 1080.

**Commit:** `feat(web): label the pre-season estimate and the carryover`

### Step 6: Docs and close

Update `docs/MODEL.md` (the parameter table: `priorCarryover`, `priorSeasonGap`, `priorSameTeamOnly`, and the Phase 11 section), `docs/SEASON_ROLLOVER.md` (set `TTF_PRIOR_CARRYOVER=0` for a regulation-reset season and why; write the finished season into the history folder; and a warning not to upgrade FastF1 with `pip install -U`: `requirements.txt` pins `fastf1==3.8.3`, and from 3.9.0 most FastF1 features need an F1TV Access subscription, see `docs/DATA_TERMS.md`), `docs/FEED.md` (if adopted), the README, `SPEC.md` (status; D61 to D65 Done or Rejected; the roadmap row) and `AGENTS.md`. Verify on a fresh clone: `bun install`, `bun test`, `bun run typecheck`, `bun run build`, `bun run calibrate -- --carryover`, and `bun run start` with curl on `/api/season` and `/api/feed/odds`.

**Commit:** `docs: close Phase 11`

## What this does not do

- It does not change any number in a season where the carryover is 0, and with the default of v2 nothing changes until Step 3 adopts a candidate.
- It does not know that a season is a regulation reset; the owner tells it (D63). A season that starts with new cars and the carryover left on will start with the wrong favorites; the evaluation records how large that loss was in 2026.
- It does not follow a team through a rename; the "same team only" rule matches constructor ids, so a renamed team counts as a change of team.
- It does not touch the title odds beyond the fit: `strengthSigma` and the simulation are unchanged.
