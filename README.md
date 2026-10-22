# To the Flag
Alternative title-fight what-if tool for F1. Read SPEC.md and DESIGN.md first.

Set results for the remaining sessions and watch the table, the title status and the path to the title update at once. It runs on your own machine, works offline, and makes no external requests.

## Quick start
1. Install [Bun](https://bun.sh).
2. `bun install`
3. Make sure the F1GStats database exists. By default the app looks for `../F1GStats/f1gstats.sqlite`; set `F1GSTATS_DB` in `.env` to use another path.
4. `bun run dev`, then open <http://127.0.0.1:3100>.

`bun run dev` builds the web UI, serves it with the API, and rebuilds when you change files under `web/`. Reload the page to see the change.

## What you can do
- **Lock sessions.** Open a session card, lock it, and pick finishing positions. Drivers you do not pick score 0 in that session. Presets: *Contender wins*, *Rival out*, *Clear*.
- **Follow contenders.** Five by default, up to eight. In *Contenders* mode only they can take a position; *All drivers* mode offers everyone still racing.
- **Read the table.** Projected WDC and WCC with the change in places and points, and a status tag for each driver and each team (clinched, alive, long shot, eliminated). A team with no active car has no tag.
- **Ask what it takes.** *Possible?* shows what a contender needs to win the title, with a difficulty meter (a share of the remaining points, never a probability) and the easiest path, which you can load into the sandbox. Switch to *Constructors* for the same question about a team: the points it needs, the fewest one-twos (both cars P1 and P2) it needs if every rival scores nothing, and what each rival may still score if the team finishes 1-2 everywhere.
- **See the gap.** The finish lane shows each contender's projected points, the most they can reach, and the total at which the leader clinches.
- **Keep scenarios.** Save, rename, delete and compare scenarios, copy a share link, and show one on the overlay.
- **Ask what is likely.** *Likely?* shows model odds for the drivers' and the teams' title, from 10,000 simulated seasons. With locked sessions it also shows the change against the odds with nothing locked. The slider sets how much this season's form counts (0% makes all drivers equal). The numbers are always labelled *Model estimate*; clinched and eliminated drivers are stated in words, and a simulation never shows `0%` or `100%`. How the model works, how it was tested and what it cannot do: [`docs/MODEL.md`](docs/MODEL.md).

*Possible?* is exact arithmetic and *Likely?* is a model; the two are never mixed into one figure.

## Commands
| Command | What it does |
|---|---|
| `bun install` | Install dependencies |
| `bun run dev` | Build the web UI, serve it with the API, rebuild on changes under `web/` |
| `bun run build` | Bundle the web UI into `dist/` (minified) |
| `bun test` | Run all tests |
| `bun run typecheck` | Type-check the whole project (`tsc --noEmit`) |
| `bun run check` | Print season status and paths, for drivers and for constructors, from the real data file. `-- --driver CODE` or `-- --team ID` limits the path blocks to one; `-- --json` prints everything as JSON |
| `bun scripts/verifyStandings.ts [db]` | Check the engine's base table equals F1GStats `driver_standings` (order and points) |
| `bun scripts/statusReport.ts [db]` | Print the title status table (clinched / alive / eliminated) from the real data |
| `bun scripts/exportFixture.ts <db> <out.json>` | Snapshot the loaded season as a JSON test fixture |
| `bun scripts/addClassified.ts <db> <fixture.json>` | Add each result's `classified` flag (DNF or not) to an older fixture |
| `bun run backtest` | Walk-forward test of the odds model against past races, with the settings grid and baselines (about 3 s). See `docs/MODEL.md` |
| `bun run calibrate` | The multi-season protocol (D30), the grid signal and the qualifying noise; needs the history files in `../F1GStats/history`. `-- --grid-signal` or `-- --qualifying-noise` runs one part. See `docs/MODEL.md` |
| `bun run title-check` | What-if sensitivity table and, with the history files, the title odds against the real champions. See `docs/MODEL.md` |

Tests run from the fixtures in `tests/fixtures/` and databases they build themselves; none needs the real F1GStats file. One optional smoke test uses it when `../F1GStats/f1gstats.sqlite` exists and is skipped otherwise.

## Configuration
Copy `.env.example` to `.env` and adjust. All values are optional.

| Variable | Default | Meaning |
|---|---|---|
| `F1GSTATS_DB` | `../F1GStats/f1gstats.sqlite` | Path to the read-only F1GStats database |
| `TTF_DB` | `./to-the-flag.sqlite` | Where saved scenarios and the active overlay scenario are kept |
| `PORT` | `3100` | Server port (LiveOverlay Studio uses 3000) |
| `HOST` | `127.0.0.1` | Server host. Keep it local: there is no login |
| `TTF_WRITE_TOKEN` | *(empty)* | Secret write token. Required when `HOST` is not loopback (min 16 characters) |

## LAN mode
To access the app from a phone or a second computer on your home network:
1. In `.env`, set `HOST=0.0.0.0` and `TTF_WRITE_TOKEN` to a long random string (at least 16 characters).
2. Start the server (`bun run dev`). Allow the port in the Windows firewall if prompted.
3. Open `http://<this PC's address>:3100` on the other device (the startup banner lists your LAN addresses).

Reading the UI, season data, health, and overlay feeds is open without a token. Writing (saving, updating, deleting scenarios, or setting the active overlay scenario) requires entering the token in the web interface.

> [!NOTE]
> This is designed for a trusted home network, not the public internet. Do not forward the port on your router.

## Overlay feed
The server publishes flat JSON feeds under `/api/feed/` for LiveOverlay Studio or any streaming tool, for example `http://127.0.0.1:3100/api/feed/active-scenario`. Routes, fields and binding steps are in [`docs/FEED.md`](docs/FEED.md). `/api/feed/odds` serves the model odds for the active scenario (or the base season), cached until the data or the scenario changes. `/api/feed/team-status` and `/api/feed/team-path/:team` serve the constructors' title status and path for the active scenario.

## Share links
*Copy link* puts the scenario in the address after a `#`, for example `http://127.0.0.1:3100/#s=v1.…&r=16`. Opening it imports the scenario and checks it against the current data. If it was made at an earlier round, you get a warning that results may differ. Nothing is sent to a server.

## If something does not load
| You see | What to do |
|---|---|
| "Could not load the season data. Check that the server is running" | Start it with `bun run dev`, then reload. Opening `dist/index.html` as a file does not work: the page needs the server. |
| "F1GStats database file was not found" | Set `F1GSTATS_DB` in `.env` to the real path, then reload. |
| "Data check failed. Showing last valid data from Round N." | The latest F1GStats import did not pass its checks. Run the F1GStats data check to see why, then reload. The numbers shown are the last valid ones. |
| "Data check warning" | The latest import flagged something to review. The standings are shown as loaded. |
| "The display stopped working" | Reload. If it repeats, run the F1GStats data check and make sure the app and the data are up to date. |
