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
- **Read the table.** Projected WDC and WCC with the change in places and points, and, once someone can no longer win the title, a status tag and a *Best* place for each driver and each team (clinched, alive, long shot, or `✕ No title`; a driver who is not racing is tagged *not racing*). A team with no active car has no tag. *Best* is the highest place the driver or team can still reach **on points alone**: it counts the rivals whose points are already above what this entry could still reach. It is a floor, not a promise: it does not check that every rival can be held back at once, and a tie on points is not counted as being above. `P1` means the title is still possible. The *Title info* control above the table has three settings: **Auto** (the default; the tags and *Best* appear once someone in that table is out of the title fight), **On** and **Off** (a plain standings table). The choice is remembered in the browser and the exported picture follows it.
- **Ask what it takes.** *Possible?* shows what a contender needs to win the title, with a difficulty meter (a share of the remaining points, never a probability) and the easiest path, which you can load into the sandbox. Switch to *Constructors* for the same question about a team: the points it needs, the fewest one-twos (both cars P1 and P2) it needs if every rival scores nothing, and what each rival may still score if the team finishes 1-2 everywhere.
- **See the gap.** The finish lane shows each contender's projected points, the most they can reach, and the total at which the leader clinches.
- **Keep scenarios.** Save, rename, delete and compare scenarios, copy a share link, export and import them as a file, and show one on the overlay.
- **Ask what is likely.** *Likely?* shows model odds for the drivers' and the teams' title, from 10,000 simulated seasons. With locked sessions it also shows the change against the odds with nothing locked. The slider sets how much this season's form counts (0% makes all drivers equal). The numbers are always labelled *Model estimate*; clinched and eliminated drivers are stated in words, and a simulation never shows `0%` or `100%`. How the model works, how it was tested and what it cannot do: [`docs/MODEL.md`](docs/MODEL.md).

- **Set the starting grid.** The *Race* tab shows the grid of the next race and where it comes from. Correct it (move a driver, drop places, back of the grid, pit-lane start, or paste a whole list) and *Save grid*; *Likely?* and the race forecast then use your grid.
- **See the race forecast.** Under the grid, for each driver: the chance to win, to finish on the podium and in the points, and the expected finish. It is a model estimate for the next race only.

*Possible?* is exact arithmetic and *Likely?* is a model; the two are never mixed into one figure.

## Commands
| Command | What it does |
|---|---|
| `bun install` | Install dependencies |
| `bun run dev` | Build the web UI, serve it with the API, rebuild on changes under `web/` |
| `bun run build` | Bundle the web UI into `dist/` (minified) |
| `bun run start` | Serve the built production UI (`dist/`) with the API |
| `bun run refresh` | Run F1GStats fetch to update local database (`f1gstats.sqlite`) |
| `bun test` | Run all tests |
| `bun run typecheck` | Type-check the whole project (`tsc --noEmit`) |
| `bun run check` | Print season status (with each entry's best place) and paths, for drivers and for constructors, from the real data file. `-- --driver CODE` or `-- --team ID` limits the path blocks to one; `-- --json` prints everything as JSON |
| `bun scripts/verifyStandings.ts [db]` | Check the engine's base table equals F1GStats `driver_standings` (order and points) |
| `bun scripts/statusReport.ts [db]` | Print the title status table (clinched / alive / eliminated) from the real data |
| `bun scripts/exportFixture.ts <db> <out.json>` | Snapshot the loaded season as a JSON test fixture |
| `bun scripts/addClassified.ts <db> <fixture.json>` | Add each result's `classified` flag (DNF or not) to an older fixture |
| `bun run seed-grid` | Dev only. Copies the F1GStats database to `./test-grid.sqlite` and adds an invented starting grid for the next race, so the Race tab, grid tags and the notice can be tried before qualifying. The original is never changed. Start the app on the copy with `F1GSTATS_DB=./test-grid.sqlite bun run dev` (PowerShell: `$env:F1GSTATS_DB="./test-grid.sqlite"; bun run dev`). Options: `-- --from <db>`, `-- --out <file>`, `-- --source openf1\|qualifying` |
| `bun run backtest` | Walk-forward test of the odds model against past races, with the settings grid and baselines (about 3 s). See `docs/MODEL.md` |
| `bun run calibrate` | The multi-season protocol (D30), the grid signal and the qualifying noise; needs the history files in `../F1GStats/history`. `-- --grid-signal`, `-- --qualifying-noise` or `-- --points` (the points chance and expected finish, D53) runs one part. See `docs/MODEL.md` |
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
| `TTF_ALLOWED_HOSTS` | *(empty)* | Host names that may write, comma-separated, no scheme, port or path (for example `mypc.local`). `localhost` and IP addresses always may. An invalid entry stops the server at start |

## LAN mode
To access the app from a phone or a second computer on your home network:
1. In `.env`, set `HOST=0.0.0.0` and `TTF_WRITE_TOKEN` to a long random string (at least 16 characters).
2. Start the server (`bun run dev`). Allow the port in the Windows firewall if prompted.
3. Open `http://<this PC's address>:3100` on the other device (the startup banner lists your LAN addresses).

If you open the app by a name (such as `http://mypc.local:3100`) instead of an IP address, add that name to `TTF_ALLOWED_HOSTS`; otherwise writes are refused with `forbidden_host`. This stops a web page that points its own name at your PC (DNS rebinding) from writing. Opening the app by IP address needs no setup.

Reading the UI, season data, health, and overlay feeds is open without a token. Writing (saving, updating, deleting scenarios, or setting the active overlay scenario) requires entering the token in the web interface.

> [!NOTE]
> This is designed for a trusted home network, not the public internet. Do not forward the port on your router.

## Overlay feed
The server publishes flat JSON feeds under `/api/feed/` for LiveOverlay Studio or any streaming tool, for example `http://127.0.0.1:3100/api/feed/active-scenario`. Routes, fields and binding steps are in [`docs/FEED.md`](docs/FEED.md). `/api/feed/odds` serves the model odds for the active scenario (or the base season), cached until the data or the scenario changes. `/api/feed/team-status` and `/api/feed/team-path/:team` serve the constructors' title status and path for the active scenario. `/api/feed/status` and `/api/feed/team-status` also carry `best_position` (and `top1_best` to `top10_best`).

## Share links
*Copy link* puts the scenario in the address after a `#`, for example `http://127.0.0.1:3100/#s=v1.…&r=16`. Opening it imports the scenario and checks it against the current data. If it was made at an earlier round, you get a warning that results may differ. Nothing is sent to a server.

## Backup and move scenarios
*Export scenarios* saves all your scenarios of the season in one file (`to-the-flag-scenarios-2026-r16.json`); *Import scenarios* reads such a file, on this or another computer. Only scenarios of the current season that still fit the data are kept, each one that is skipped comes with its reason, and a name that already exists gets a number ("Name (2)"): an import never overwrites anything. The file holds names, locks and contenders only, no ids, times, token or addresses. It is limited to 1 MB and 200 scenarios. Importing needs the write token in LAN mode. Details: [`docs/EXPORT.md`](docs/EXPORT.md).

## Race weekend: the starting grid

The *Race* tab is for the race you are about to watch.

**Which grid is used.** There are three sources, and the tab always says which one is in use ("Grid: manual", "Grid: OpenF1" or "Grid: qualifying"):
1. **Manual**: a grid you typed and saved. It is used until you clear it.
2. **OpenF1**: the actual grid with grid penalties, published a few hours before the race.
3. **Qualifying**: the qualifying order, used when OpenF1 has no grid yet. It ignores grid penalties and pit-lane starts, so it is marked in yellow as "may differ from the real grid".

**Correct the grid.**
- Each driver has *Up* and *Down* arrows and a *More* menu: *Drop 1, 2, 3, 5 or 10 places*, *Back of the grid* and *Pit-lane start* (pit-lane starters go behind everyone, in the order you marked them; *Start from the grid* puts one back).
- *Paste a list* takes driver codes separated by spaces, commas or lines, with an optional place number in front (`1 ANT`), and `PIT:` before the pit-lane starters. If anything cannot be read, or a driver is missing, repeated or not racing, it says so in plain words and changes nothing.
- *Save grid* saves it. Every driver who is racing must appear exactly once. Saving follows the same rule as saving a scenario (see LAN mode): on the computer that runs the server no token is needed; from another device the write token is. Arranging the list needs no token.
- *Use data grid* removes your grid, and the OpenF1 or qualifying grid is used again.
- A manual grid is for the **next race only**. Once that race has results it is ignored (it stays in `to-the-flag.sqlite`; it is never written to the F1GStats data file).

**When OpenF1 catches up.** If you saved a grid and OpenF1 later publishes a different one, a notice says so. It never switches by itself: *Use OpenF1 grid* removes yours, *Keep mine* hides the notice until OpenF1's grid changes.

**The race forecast** (under the grid) shows, for the grid in use: the chance to win, to finish on the podium and in the points (the top ten), and the expected finish. It says "Model estimate", the round it is based on and the grid source. It uses this season's form and the grid, not weather, tyres or strategy, and a retirement is a chance, not a prediction. The points chance and the expected finish are marked "Indicative": the model is fitted for the front of the field, and the fixes tried in Phase 9 did not pass the adoption rule, so the chances at the back of the grid remain the least reliable part (see `docs/MODEL.md`, "Model v3"). *Likely?* and the title odds use the same grid.

**Try it before qualifying.** The data file has no grid until qualifying has run. `bun run seed-grid` makes a copy of it with an invented grid so you can try the tab (see Commands).

**Keyboard.** Everything works with the keyboard: Tab to a button and press Enter or Space, Escape closes a menu and puts the focus back on its *More* button, and after a move the focus stays on the driver you moved. The list has three stops per driver, so for a big change use *Paste a list*.

## Export picture (PNG)
The scenario strip provides an *Export picture* button to render and download a standalone standings card as a PNG:
- **Sizes:** Square (`1080×1080`, ideal for social media posts) and Wide (`1920×1080`, ideal for streaming screens).
- **Table:** the WDC or the WCC table, whichever tab is open. Rows: Top 10, Top 12, All, or a custom range (for example P3 to P15).
- **Contents:** Title, current season, as-of round, scenario name, the rows (rank, code/name, team, current → projected points, delta), and the Best place and status tag when the *Title info* choice shows them. When the scenario has locked sessions, the card says it is a simulation up to that round.
- **Odds:** When the *Likely?* tab has model odds, they are shown alongside with the required `"Model estimate"` label.
- **Privacy:** Tokens, server addresses, and file paths are never drawn in the image. The rendering happens offline in the browser canvas.
- **Adding to the card:** how it is built and the steps to add new content are in [`docs/EXPORT.md`](docs/EXPORT.md).

### The starting grid
The *Race* tab has an *Export* section for the starting grid of the next race:
- **Picture:** *Export picture* draws the grid like a real one, with pole at the front, the second car on the front row a little further back, and the rows behind it. Only the driver code is written in each box, and pit-lane starters have their own block. Choose the size (square or wide) and the places: All, Top 10, Top 12, or a custom range (for example P6 to P15). A grid that comes from the qualifying order says so on the picture.
- **Data:** *Copy as CSV*, *Copy as JSON*, *Download CSV* and *Download JSON* always give every place (`position,driver,name,team,pit,source`).
- It exports the saved grid. No write token is needed. How the cards are built and how to add to them: [`docs/EXPORT.md`](docs/EXPORT.md).

## If something does not load
| You see | What to do |
|---|---|
| "Could not load the season data. Check that the server is running" | Start it with `bun run dev`, then reload. Opening `dist/index.html` as a file does not work: the page needs the server. |
| "F1GStats database file was not found" | Set `F1GSTATS_DB` in `.env` to the real path, then reload. |
| "Data check failed. Showing last valid data from Round N." | The latest F1GStats import did not pass its checks. Run the F1GStats data check to see why, then reload. The numbers shown are the last valid ones. |
| "Data check warning" | The latest import flagged something to review. The standings are shown as loaded. |
| "The display stopped working" | Reload. If it repeats, run the F1GStats data check and make sure the app and the data are up to date. |
