# Release rehearsal

Step 7 of `docs/PHASE_10.md`, run by the assistant on 2026-11-18 for the owner to check before the
tag (`docs/PHASE_10.md` asks the owner to run it). Every server ran on a spare port against a
**copy** of the data; the owner's `../F1GStats/f1gstats.sqlite` and `to-the-flag.sqlite` were opened
read-only and never written.

Candidate: branch `phase-10-release`, commit `47743d4`.
Data: the 2026 season. Most items used the Round 16 snapshot (`tests/fixtures/season-2026-r16.json`)
built into a temporary database, because the real data file is at Round 20 with the title already
decided, which leaves the odds and grid panels with nothing to show. Item 1 used a copy of the real
Round 20 file, item 7 a copy of a completed season built by `tests/dbHelpers.ts`.

| # | Item | Result | Note |
|---|---|---|---|
| 1 | `bun run refresh` after a session, then the new-data notice | **Pass** | A real fetch into a copy of the Round 20 file (`fastf1` 3.8.3 from the F1GStats virtual environment) exited 0 in 14.9 s and rewrote `data_health`. With the page open, the 60 s `/api/health` poll showed **New data from Round 20 is ready.** and *Reload* cleared it. No session was added, so the round number did not change; a new round was not available to test |
| 2 | The grid: automatic, manual, clear | **Pass** | 4/4: `qualifying` from the data file, a manual order wins and shows `manual`, an invalid list is refused with 422 and the reasons, `DELETE` brings the data grid back |
| 3 | Race tab: forecast, indicative note, exports | **Pass** | The forecast table has Win, Podium, Points and Exp. finish with **Model estimate · as of Round 16**; "Indicative; the model is fitted for the front of the field." is there; the grid PNG (85 KB), CSV (header `position,driver,name,team,pit,source`) and JSON (3.2 KB) all download |
| 4 | Standings card in both sizes; overlay feeds | **Pass, one gap** | Square 1080×1080 and wide 1920×1080 both draw. All nine feeds answered 200: `standings`, `status`, `path/ANT`, `team-status`, `team-path/mercedes`, `odds`, `grid`, `race-forecast`, `active-scenario`. **LiveOverlay Studio was not running**, so the feeds were checked as JSON, not inside Studio |
| 5 | LAN: by IP with the token, without it, through a name not allowed | **Pass** | 8/8 with explicit `Host` headers: read by IP and by a foreign name 200; write by IP with the token 201; without it 401 `token_required`; through a foreign name 403 `forbidden_host`; through a listed name 201; loopback 201; a wrong token 401. **Simulated over HTTP, not from a real phone** |
| 6 | Scenario export, wipe, import | **Pass** | Export is `format: to-the-flag-scenarios` with no token, path, address or timestamp; wiping leaves the list empty; importing restores both names, their contenders and the lock `{"17:race":{"fixed":{"ANT":1,"RUS":2}}}` |
| 7 | The season-complete state | **Pass** | Header **Season 2026 · Season complete**; Possible? shows the final line instead of a table; Likely? shows **Final**, 100 % and "The season is complete, so this is the final result, not an estimate."; Race tab says **No race left**; `/api/feed/grid` and `/api/feed/race-forecast` say `available: false, reason: no_next_race`; `/api/feed/odds` has `model: final`, `label: Final`, 100 % for the champion in both titles; the card reads **Final** where the round goes and has no simulation line |
| 8 | A whole weekend without a restart | **Partial** | Four minutes of mixed traffic is not a weekend: 19 967 cycles, 187 689 requests, 0 failures, no scenario left behind, the database still 28 672 bytes, nothing in the log. Memory went from 20.6 MB to 42.8 MB under that hammering; it is not known whether it levels off, because the run was too short |

## What this rehearsal did not cover

- **A real race weekend.** Nothing was fetched after a session; item 1 was a real fetch, but no new
  session appeared in it, so the "next round arrives while the app is open" path was not seen.
- **A real phone and a real second computer.** Item 5 used `Host` headers over loopback.
- **LiveOverlay Studio.** It was not running, so the feeds were checked as JSON only.
- **A whole weekend of uptime.** Item 8 ran for four minutes.
- **A fresh Linux clone.** There is no Linux or WSL on this machine; the quick start was run from a
  fresh clone on Windows `cmd` only, twice.

## Found while rehearsing

- `bun run refresh` quietly needs the Python that has FastF1. `F1GSTATS_PY` defaults to `py` on
  Windows, and the system Python has no FastF1, so the command failed with
  `ModuleNotFoundError: No module named 'fastf1'` until it pointed at the F1GStats virtual
  environment. Activating the venv in another terminal does not help, because the command starts its
  own process. Fixed in this step: a row for `F1GSTATS_PY` in the README configuration table and a
  commented line in `.env.example`. No code change.
- The OpenF1 404 for the grid is known information, not a blocker (`docs/PHASE_8.md`).
