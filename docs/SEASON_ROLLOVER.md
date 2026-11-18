# Season rollover

What to do between two seasons (D60). Do it once a year, after the last race and before the first race of the next season.

Commands are for Windows `cmd`; on macOS or Linux use `python3` for `py` and `/` for `\`.

## What the app shows in between

- After the last session has a result, the header says **Season complete**. The tables are final, the Possible? panel gives the final result, the Likely? panel says **Final** (100% for the champion), the Race tab says **No race left**, and the PNG card says **Final** in place of the round.
- Before the first race has a result, the header says **Season not started**, and the standings and the two title panels say so in one line instead of showing empty tables.
- Nothing in the app needs a code change for either state.

## 1. Close the old season

1. **Back up your scenarios.** In the scenario strip press *Export scenarios*. The file is `to-the-flag-scenarios-2026-r24.json` (season and last round in the name). Keep it somewhere safe.
2. **Keep the finished season's data.** From the `F1GStats` folder, fetch the season into the history folder:
   ```
   py fetch_f1_data.py --season 2026 --output .\history\f1gstats-2026.sqlite
   ```
   Check the exit code on its own line (`echo %ERRORLEVEL%`): `0` is fine. `2` means the data check failed and nothing was written; run it again later. The `history` folder is not in git.
3. **Check the file** before you rely on it: `bun run check --db ..\F1GStats\history\f1gstats-2026.sqlite` should say `Season complete` and `Data health: ok` (or `warn` with a reason you understand; `warn` is expected when the fastest-lap point of an old season is not in the table).

## 2. Start the new season

1. **Fetch it.** Pass the season explicitly, from the `to-the-flag` folder:
   ```
   bun run refresh --season 2027
   ```
   or from `F1GStats`: `py fetch_f1_data.py --season 2027 --output .\f1gstats.sqlite`. Do not rely on the default: `bun run refresh` without `--season` falls back to the current calendar year.
2. **Check the data.** Run `bun run check`, or open `http://127.0.0.1:3100/api/health`. You want `dataStatus` of `ok` (or an understood `warn`) and `schemaVersion` of `2` or newer. If the schema is older the app says "Re-run F1GStats".
3. **Reload the page.** Before the first race it says **Season not started**. It changes by itself once a race has a result and you refresh.

Not tested: how F1GStats behaves on a season that has a schedule but no result yet (it should write the schedule and exit `0` or `2`; if it exits `2`, the data checks refused it, and the old file stays). Look at the output the first time and tell the assistant what you see.

## 3. What to verify each year

These are the places where the app knows something about a particular season. Nothing else is hard-coded (the number of rounds, drivers and sprint weekends all come from the schedule).

| What | Where | Check |
|---|---|---|
| **Points tables and sprint rule** | `engine/points.ts` (`GP_POINTS`, `SPRINT_POINTS`) | Compare with the FIA Sporting Regulations for the new season: points for P1 to P10, the distance tiers for a shortened race, sprint points P1 to P8. If a number changes, change it here and fix the golden values in `tests/points.test.ts`; the title maths and the model follow. |
| **Constructor ids and colors** | `web/theme/teams.ts` (`TEAM_COLORS`) | Keys are the Jolpica `constructor_id` values in the data file. A new team, or a renamed one (a new id), has no entry and is drawn in the hairline gray, so the table still works but looks unfinished. Add an entry; `tests/teams.test.ts` checks contrast on both panel colors. The only place raw hex colors may live is this file and `web/styles/theme.css`. |
| **New teams and renamed teams** | the `constructor_id` column of `race_results` | Run `bun run check` after the first race and look at the WCC table: every team should have its own name and color. |
| **Driver codes** | `driver_abbr` in the data file | Three letters, one per driver (F1GStats check V5 fails when two drivers share one). A rookie the API gives no code gets one derived from the surname; look at the tower after the first race. |

## 4. The model and the history folder

- The odds model stays **v2** until a new calibration run under protocol D30 decides otherwise. Nothing changes in it between seasons.
- The history folder (`F1GStats\history\f1gstats-<season>.sqlite`) is read only by the research scripts (`bun run calibrate`, `bun run backtest`, `bun run title-check`); the running app never reads it. Copying the 2026 file in does nothing by itself.
- Those scripts are written for the seasons 2022 to 2025 as history and 2026 as the confirmation season (`HISTORY_SEASONS` in `scripts/calibrate.ts`). Adding more seasons to the model is the multi-season prior (Phase 11), not part of a rollover. Rerun `bun run calibrate` only when you mean to ask whether a change to the model is worth adopting.

## 5. Saved scenarios and grids of the old season

- **Scenarios** are kept in `to-the-flag.sqlite` (`TTF_DB`). A scenario belongs to the season it was saved in. In the new season the old ones stay in the strip, marked **Invalid**, with the note "This scenario is from season 2026...". They cannot be loaded, shown on the overlay (the overlay shows the real standings instead) or exported; you can rename or delete them. Delete them when you no longer want them, or keep them: they do no harm.
- **Importing** the file from step 1 into the new season skips every scenario with the reason "It is for season 2026, and this app is on season 2027." That is expected: a scenario of one season does not fit another.
- **Manual starting grids** are saved by season and round, so a 2026 grid never applies to a 2027 race. The old rows stay in the file and are not shown.
- To start completely clean, stop the server and delete `to-the-flag.sqlite`. This removes every scenario and manual grid, so export first.

## If something looks wrong

| You see | Likely reason | What to do |
|---|---|---|
| **Season complete** in the middle of a season | Every round in `schedule_full` is marked `completed`, or the schedule is shorter than you expect | Run `bun run check`; compare "round N of M" with the real calendar. Re-run the fetch. |
| **Season not started** after a race | The page still holds old data, or the fetch did not write | Press the refresh in the header or reload the page. Run `bun run refresh --season N` and read the exit code. |
| Refresh says "The last valid data stays" | F1GStats exit code `2`: its data check failed (the API often lags after a race) | Try again in a few minutes. `bun run check` shows which check failed. |
| "Re-run F1GStats" / schema message | The data file is from an old F1GStats | Update F1GStats and run the fetch again. |
| A team in gray, or a team name shown as an id | No entry for that `constructor_id` in `web/theme/teams.ts` | Add one (section 3). |
| Two drivers with the same code, or `NAN` | A driver the API gave no code; V5 should have failed the fetch | Run the fetch again; if it persists, see `_ABBR_OVERRIDES` in `fetch_f1_data.py`. |
| Points do not add up (title status looks wrong) | The points table no longer matches the regulations | Section 3, first row. |
| Saving a scenario says the address is not allowed (`forbidden_host`) | You opened the app by a host name | Open it by IP address, or add the name to `TTF_ALLOWED_HOSTS`. |
| Old scenarios marked Invalid after the new season started | Expected (section 5) | Rename, delete, or ignore them. |
