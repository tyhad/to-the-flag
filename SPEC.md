# To the Flag — Product & Engine Spec
> Working name: **To the Flag** (owner proposal; check domain and repo availability). Tagline pending, see D3.

**Status:** DRAFT v0.10. Phase 0 (F1GStats data, `main` @ `ccd268b`), Phase 1 (engine), Phase 2 (API, web UI, overlay feed; see `docs/PHASE_2.md`) and Phase 3 (Monte Carlo odds, the "Likely?" tab, the odds feed, a backtest; see `docs/PHASE_3.md` and `docs/MODEL.md`) are done. Phase 4 (model v2: history data, calibration, grid signal; see `docs/PHASE_4.md` and `docs/MODEL.md`) is done. Phase 5 (WCC Path Solver; see `docs/PHASE_5.md`) is done. Phase 6 (access and ops; `docs/PHASE_6.md`, all its decisions approved) is in progress; Phase 7 is planned (section 10). D1 (TypeScript engine) and D2 (theme) are approved.
**Companion file:** `DESIGN.md` (visual rules). Read both before writing code.

---

## 1. Goal

A personal tool for the owner to discuss F1 title fights with an audience. The owner sets results for the remaining sessions and watches the final WDC table and title chances change. It also feeds the owner's streaming overlay (LiveOverlay Studio).

**Non-goals:** multi-user, accounts, hosting, live in-race odds, pick'em or prediction games, WCC path solver in v1.

## 2. Two separate features (do not merge)

| | **Possible?** (Path Solver) | **Likely?** (Odds) |
|---|---|---|
| Question | Can X still win, and what must happen? | How likely is X to win? |
| Needs a model | No (pure rules and points) | Yes (Monte Carlo, form from this season) |
| Output | verdict, minimum conditions, easiest path, only path, difficulty | % per contender, delta vs base, confidence |
| Label | none needed | always "Model estimate" |

Both use the same engine and the same scenario locks.

## 3. Architecture

```
F1GStats (Python, FastF1/Ergast/OpenF1)        ← ingestion only
    └─ writes f1gstats.sqlite (one transaction, only after validation passes)
            │  read-only
            ▼
To the Flag (TypeScript, Bun + Elysia + Tailwind v4)
    ├─ engine/   pure functions, no I/O, runs on server AND in the browser
    ├─ api/      Elysia routes (+ feed routes for the overlay)
    └─ web/      what-if UI
            │  JSON over HTTP (localhost)
            ▼
LiveOverlay Studio (Bun + Elysia, OBS Browser Source)
    uses its "External Data Source / generic API binding" (polls server-side, caches)
```

Rules:
- `f1gstats.sqlite` is **read-only** for To the Flag. To the Flag stores scenarios in its own `to-the-flag.sqlite` (use `bun:sqlite`).
- The engine has no dependency on Elysia, the DOM, or the filesystem. It takes plain data and returns plain data.
- To the Flag is a separate repo. LiveOverlay couples to it only through HTTP JSON.
- Data refresh cadence: **after each session ends** (manual or scheduled run of F1GStats). No live in-race updates.

**Networking.** LiveOverlay Studio runs on port 3000 and is reachable from other devices on the same network. This tool defaults to `PORT=3100` and `HOST=127.0.0.1` (this machine only), both read from environment variables. LAN access is deferred, but build for it now: never hardcode `localhost`; derive any absolute URL from the request host; keep engine and feed routes stateless. When LAN mode is added (`HOST=0.0.0.0`), read-only feed routes may be open on the LAN, while routes that write scenarios stay loopback-only unless a token is set. LiveOverlay polls from its own server, so CORS is not needed on that path; add it only if a browser calls the API directly. The Windows firewall must allow the port when LAN mode is on.

## 4. Domain rules (verified against FIA 2026 F1 Regulations, Section A, Issue 02, 27 Feb 2026, Articles A2.1 and A2.2)

**GP points** depend on the share of scheduled distance the leader completed. In all cases no points are awarded unless the leader completed at least two complete, consecutive laps without a Safety Car or VSC.

| Position | ≥ 2 laps (< 25%) | ≥ 25% | ≥ 50% | ≥ 75% (full) |
|---|---|---|---|---|
| P1 | 6 | 13 | 19 | 25 |
| P2 | 4 | 10 | 14 | 18 |
| P3 | 3 | 8 | 12 | 15 |
| P4 | 2 | 6 | 10 | 12 |
| P5 | 1 | 5 | 8 | 10 |
| P6 | – | 4 | 6 | 8 |
| P7 | – | 3 | 4 | 6 |
| P8 | – | 2 | 3 | 4 |
| P9 | – | 1 | 2 | 2 |
| P10 | – | – | 1 | 1 |
| **Total** | 16 | 52 | 79 | 101 |

- No fastest-lap point.
- **Sprint points:** only two outcomes, no partial scale. If the leader completed ≥ 50% of the scheduled sprint distance (and ≥ 2 laps without SC/VSC): 8-7-6-5-4-3-2-1 for P1–P8 (total 36). Otherwise: 0.
- Points follow the **final classification**, so post-race penalties and disqualifications apply. Re-fetch the latest rounds to catch corrections.
- **Dead heat:** points for tied positions are added and shared equally (half points are possible).
- **Only Competitions that actually took place count.** The regulations allow 8–24 Competitions and at most 24 cars (two per team). Never hardcode round count, driver count, or sprint weekends; derive them from the schedule (sources already disagree on the 2026 round count).
- **Countback (A2.1.4.c)**, for drivers and teams alike: most first places in a **race**, then second places, then thirds, and so on; if still tied, apply the same criteria to the season's **qualifying results**. "In a race" means Grand Prix races, so sprint results do not count. Implement as config `countback.includeSprint = false` with tests. Level iv needs `qualifying_results` (optional, rarely reached).
- **Constructors:** points from both F1 Cars count.
- **Remaining points:** for each uncompleted session in the schedule: race 25 (team 43), sprint 8 (team 15).
- **Entry list:** standings can include drivers who no longer race (2026 as of Round 16: 23 in standings, 22 per round). Only drivers present in the latest completed round can score in remaining sessions.

## 5. Data contract (what F1GStats must provide)

The canonical version, including exact DDL, lives in the F1GStats repo at `docs/DATA_CONTRACT.md` (the producer owns the schema). This section is a summary; if they differ, the F1GStats file wins.

Existing tables stay unchanged: `meta`, `sessions`, `driver_standings`, `constructor_standings`, `starting_grid`. To the Flag reads `starting_grid` (Phase 4, Step 8): only the rows of the next scheduled round count, whatever their `round_relation`; the table is optional (no table or no rows for that round means no real grid is used).

New tables, all keyed by `season`:
- `schedule_full(season, round, race_name, has_sprint, race_start_utc, sprint_start_utc, status)`: `status` is `completed` or `scheduled` (time-based).
- `race_results(season, round, session, driver_abbr, driver_name, team_name, constructor_id, grid, position, position_text, points, status, is_classified)`: `session` is `Race` or `Sprint`.
- `data_health(id, season, checked_at, status, details_json)`: one row per run.
- `qualifying_results(season, round, driver_abbr, position)`: optional, only for countback level iv.

F1GStats changes: keep the full schedule (not only previous/now/next) in `schedule_full`; store per-round results instead of aggregating; add sprint results; replace the season's `schedule_full` and `race_results` rows inside the write transaction (one API call returns the whole season, so this also picks up post-race corrections); write all tables in one SQLite transaction after validation; set `meta.schema_version = 2`.

## 6. Data validation (F1GStats phase, gate before writing)

Same checks as the contract (V1 to V6):

| ID | Check | On failure |
|---|---|---|
| V1 | Sum of driver points = sum of constructor points | warn |
| V2 | Each completed GP total ∈ {101, 79, 52, 16, 0}; each sprint total ∈ {36, 0} | warn |
| V3 | For every driver: sum of `race_results.points` (Race + Sprint) = `driver_standings.points` | fail |
| V4 | Rounds that have Race results = rounds in `schedule_full` with `status = completed` | fail |
| V5 | `driver_abbr` matches `^[A-Z]{3}$`; `team_name` non-empty; `position` not null | fail |
| V6 | Rows per Race round = number of drivers in standings (±2) | warn |

V2 can legitimately be lower than 101 when fewer than 10 drivers are classified. V3 and V4 fail right after a race while the API has not published results yet; that is expected and the old data stays.

Behavior: on **fail**, do not touch the data tables (the last valid data stays), record `data_health.status = fail`, and exit with code 2. To the Flag shows "Data check failed. Showing last valid data from Round N." On **warn**, write the data and show a small warning.

## 7. Scenarios and inputs

- Every remaining session is **Open** (simulated by the model, or unconstrained in Path Solver) or **Locked** (fixed by the user).
- Input is limited to the points zone: Race P1–P10, Sprint P1–P8.
- **Contender mode (default):** the user sets positions only for the contenders (default: top 5 of the standings; user-selectable). Other drivers fill the remaining slots. A driver can be marked **out** (no points).
- **Full mode (optional):** assign every points position manually.
- Presets: "Contender wins all remaining", "Rival out in next race", "Clear".

```ts
type SessionKey = `${number}:${"race" | "sprint"}`;   // `${round}:${session}`

interface SessionLock {
  // driver abbreviation -> finishing position inside the points zone, or "out"
  fixed: Record<string, number | "out">;
}

interface Scenario {
  id: string;
  name: string;
  season: number;
  asOfRound: number;
  locks: Record<SessionKey, SessionLock>;
  contenders: string[];            // driver abbreviations
  createdAt: string;               // ISO UTC
}
```

Semantics for Path Solver: drivers outside the contender set are neutral fillers that can occupy any slot not taken by a contender. This is exact when at least 10 non-contender drivers exist. Scenarios are stored separately from official data and are shareable as a compact URL parameter.

## 8. Features

**F1. Standings engine (deterministic).** Current points + locked sessions → projected final table (points, position, delta vs base), status per driver: `clinched | alive | eliminated` (with countback), max remaining points, gap to leader, points needed to clinch.

**F2. Path Solver (WDC only in v1).**
- Verdict: can contender X still win the title.
- Minimum conditions: for example "X must win at least 3 of 5 remaining sessions, and the leader must not finish above P4".
- Easiest path (lightest conditions) and only path (extreme case).
- Difficulty meter: share of remaining points X must score (no probability wording).
- Method: closed form from a dominance argument (the target driver winning every remaining session is never worse for the target), verified through the standings engine. Outputs: verdict, points needed, minimum wins, per-rival point budgets and pace limits, and an easiest-path witness scenario. Rival budgets are independent (joint feasibility is not checked). Exact only when at least 9 non-contender drivers exist (`exact` flag). DP is deferred.

**F2b. Path Solver for constructors (Phase 5).** The same questions for the constructors' title: status per team (`clinched | alive | eliminated`), points needed, `minOneTwos` (the fewest one-twos, with P2 and P3 in the rest), per-rival budgets with pair pace limits, and an easiest-path witness scenario. Method: the team's active cars finishing P1 and P2 in every open session is never worse for the team, verified through the standings engine (ties by countback, both cars' finishes summed). Rival budgets are independent. Exact only when at least 8 active drivers on eliminated teams exist (`exact` flag). See D34 to D36.

**F3. Odds (Monte Carlo).** Phase 3, separate from F2.
- Season-only data in v1; `prior_carryover` parameter reserved for later seasons (default 0).
- Finishing order via Plackett–Luce with driver strength estimated from this season's results, shrunk toward the mean (and optionally weighted toward recent rounds; the default is no decay, see D25); DNF as Bernoulli from this season's rate; strength uncertainty sampled per simulation.
- WCC is aggregated from the same simulated driver results.
- 10,000 simulations by default, seeded PRNG (seed derived from the season, `asOfRound`, the scenario's locks and the model parameters) so numbers do not jitter between runs.
- Expose `low_confidence = true` when fewer than 5 rounds are complete.
- A DNF is a result row with `classified = false` (`ResultRow.classified`). Non-classified finishers are left out of the pace fit; sprint DNF probability is the race rate times 0.5.
- In a locked session, drivers the owner did not set still race in the model (unlike "Possible?", where they score 0).
- Only drivers still racing can win the drivers' title in the simulation, as `driverStatus` already says.
- The model runs in a Web Worker in the browser and on the server for the overlay feed, from the same engine code. How it was fitted, tested and where it fails is in `docs/MODEL.md`.

**F4. What-if UI.** Per `DESIGN.md`: sessions rail, projected standings, Possible? / Likely? tabs, scenario strip (save, compare, export as image).

**F5. Overlay feed.** Flat JSON endpoints (easy for field picking in the overlay's API binding), cheap and cached, each with `updated_at`:
`GET /api/feed/standings`, `/api/feed/status`, `/api/feed/path/:driver`, `/api/feed/odds`, `/api/feed/active-scenario`.

## 9. Display rules

- Never show `0%` or `100%` from simulation; use `<1%` / `>99%`.
- Every simulated number is labeled "Model estimate" and shows "as of Round N".
- Possible? and Likely? are separate UI areas; never combine them into one figure.
- Deterministic states are stated in words (Clinched, Eliminated).

## 10. Phases and acceptance criteria

| Phase | Scope | Done when |
|---|---|---|
| 0. F1GStats data (done) | `schedule_full`, `race_results` (+ sprint), season-scoped replace, single-transaction write, `data_health` checks | A run on the current season produces all tables and passes the checks; a forced validation failure leaves the data tables unchanged (exit code 2) |
| 1. Engine core (done; see `docs/PHASE_1.md`) | F1, F2 (WDC) in TypeScript with fixtures and unit tests (points tables, shortened races, countback, remaining points) | Tests pass on fixtures including a countback tie, each shortened-race column, and the sprint 50% threshold |
| 2. UI + feed (done; see `docs/PHASE_2.md`) | F4 and F5, Finish Lane | The owner can lock sessions and see the table, status and path update in under ~100 ms on the client |
| 3. Odds (done; see `docs/PHASE_3.md`, `docs/MODEL.md`) | F3, its UI tab, the odds feed, a backtest and a model card | Seeded runs are reproducible; win counts sum to the number of simulations; eliminated drivers never win; the low-confidence tag works; the backtest beats the uniform baseline (it does not beat "points so far"; see the model card) |
| 4. Model v2 (done; see `docs/PHASE_4.md`, `docs/MODEL.md`) | History data (2022 to 2025), a multi-season calibration harness, a top-heavy pace fit, the grid signal, model versioning | v2 defaults are adopted only if they pass the protocol in `docs/PHASE_4.md` (D30); the grid signal is adopted or rejected with numbers; v1 stays reproducible |
| 5. WCC Path Solver (done; see `docs/PHASE_5.md`) | Team status, team path (`minOneTwos`, rival budgets), CLI report, feed routes, status tags in the WCC table, a Constructors view in "Possible?" | Fresh-clone tests pass; invariants hold (someone can always be champion, clinched means all others out, `easiest` ranks its team first); the CLI, feed and UI agree with a hand calculation for one team |
| 6. Access and ops (see `docs/PHASE_6.md`) | LAN mode with a write token, `bun run start` and `bun run refresh`, a "New data" notice, PNG export, F1GStats `--verbose` | The server refuses to start on a non-local host without a token; writes need the token from other devices; refresh reports ok / check failed / error with matching exit codes; the open page shows new data without reloading itself; PNG export works offline; fresh-clone tests pass |
| 7. Multi-season prior (planned) | `prior_carryover` using the history data | To be defined when the phase starts |

Implement one phase at a time. Each phase must run and be verified before the next starts.

## 11. Agent rules

- Read `DESIGN.md` first. Use only its tokens.
- Write the rule tests (points, shortened races, countback) **before** the engine code.
- Never hardcode round count, driver count, sprint weekends, or team colors.
- Never write to `f1gstats.sqlite` from To the Flag.
- Keep the engine pure; no imports from Elysia, DOM, or `fs` inside `engine/`.
- Do not add features outside the current phase. Ask the owner when a rule above is ambiguous.

## 12. Decisions

| # | Decision | Outcome | Status |
|---|---|---|---|
| D1 | Engine language | TypeScript (same stack as LiveOverlay, one engine for server and browser, `bun:sqlite` built in). Python stays only for fetching. | Approved |
| D2 | Visual theme | "Timing tower" per `DESIGN.md` | Approved |
| D3 | Name and tagline | Name: "To the Flag" (repo and package `to-the-flag`), final. No tagline is shown in the UI; the earlier recommendation ("Set the results. Find the path.") stays optional | Decided (name); tagline open |
| D4 | Port and network | Default `PORT=3100`, `HOST=127.0.0.1`; LiveOverlay uses 3000; LAN mode deferred (see section 3) | Decided, LAN deferred |
| D5 | Sprint partial points | None. Full table at ≥ 50% distance, otherwise 0 (FIA A2.2.2) | Resolved |
| D6 | Countback | Races only, no sprints; level iv uses qualifying results (FIA A2.1.4.c) | Resolved |
| D7 | Path Solver method | Closed form + engine-verified witness instead of DP (see section 8, F2) | Decided |
| D8 | Active driver rule | A driver is active if present in the latest completed round's Race or Sprint results | Decided |
| D9 | Web framework | React 19 + TypeScript bundled by Bun; no extra state library | Approved |
| D10 | Where the engine runs in the UI | In the browser, from one `SeasonState` snapshot | Decided |
| D11 | Scenario persistence | Server-side `to-the-flag.sqlite` (env `TTF_DB`) plus share link | Decided |
| D12 | Team colors | `web/theme/teams.ts` keyed by Ergast `constructorId`: 11 teams, owner `brand` colors plus contrast-safe `display` colors | Verified: all 11 constructor ids in the 2026 data have an entry |
| D13 | "Long shot" tag | An alive driver whose gap to the leader is at least two thirds of the points still on offer in unlocked sessions (`LONG_SHOT_GAP_SHARE` in `web/viewModel/tower.ts`). Arithmetic, not a model | Decided |
| D14 | Difficulty meter | The share of the remaining points a driver needs to take the lead (to clinch, for the leader). Bands: up to 0.40 green, up to 0.75 yellow, above orange (`web/config.ts`). Never shown as a probability | Decided |
| D15 | Finish Lane line | The leader's clinch total: the best rival's ceiling plus one, equal to the leader's points plus `pointsToClinch`. Axis in whole tens with a margin; lanes are the contenders | Decided |
| D16 | Presets and `out` | *Contender wins* puts the focus contender on P1; *Rival out* marks the best-placed other driver out; `out` scores nothing, the same as not being selected | Decided |
| D17 | Share link | `#s=<code>&r=<round>`; `shared/shareCodec` is unchanged; a link from another round imports with a warning | Decided |
| D18 | Stale scenarios | `PUT /api/scenarios/:id` keeps `as_of_round`, so a stale scenario stays stale after saving. Decided: saving changed locks or contenders refreshes `as_of_round` to the current round (renaming does not). Done in Phase 3, Step 1 | Done |
| D19 | Type role `note` | 14px for sentences the audience must read. `caption` (13px) is for hints only | Decided |
| D20 | Unspecified drivers in a locked session | "Likely?": they still race and finish where the model expects. "Possible?": they score 0 (Phase 1 decision b). The UI says so | Done (Phase 3) |
| D21 | How a DNF is handled | A result with `classified = false` is a DNF. It has weight 0 in the pace fit (it does not make the driver look slow). In the simulation a driver's retirement chance is their own record blended with the grid average (the average counts as 4 virtual races); sprint chance = race chance × 0.5 | Done (Phase 3) |
| D22 | Where the simulation runs | Browser Web Worker for the UI; the same engine code on the server for the feed | Done (Phase 3) |
| D23 | Form-weight slider | Included; 0% = all drivers equal, 100% = full season form | Done (Phase 3) |
| D24 | Model defaults | `OddsParams` defaults in `docs/PHASE_3.md`, tuned only coarsely by the backtest and recorded in `docs/MODEL.md` | Done (Phase 3) |
| D25 | Model defaults set by the backtest | `recencyHalfLife`: no decay (planned 8 rounds), clearly better on the 2026 races. `priorStrength`: 3 (planned 1): shrinks small samples; a weaker prior also tested better from round 6 on, but the test cannot judge the early rounds. Evidence and the trade-off are in `docs/MODEL.md` | Decided |
| D26 | An active scenario that no longer fits the season | `GET /api/feed/odds` ignores it and returns the base odds with `scenario: null`, so a live overlay keeps working. The UI says in plain words that the locks do not fit | Decided |
| D27 | What "Likely?" lists | Drivers who are alive get a bar (`<1%` for a long shot); a clinched driver and the count of drivers who are out are stated in words. The teams' table lists teams that won at least one simulated season | Decided |
| D28 | Change against the odds without locks | Whole percentage points ("▲ 12 pp"). It reads "●" when the shown values are equal, when it rounds to 0, or when it is smaller than two standard errors of the difference (two runs of the model never agree exactly). Bar colors follow the number shown, not the raw estimate | Decided |
| D29 | History data | Seasons 2022 to 2025 fetched with F1GStats into `../F1GStats/history/f1gstats-<season>.sqlite`, not committed, used only by scripts to evaluate and tune | Approved |
| D30 | Evaluation protocol | Tune on 2022 to 2024, validate on 2025, confirm once on 2026. Adopt a change only if it beats the current model by more than 2 standard errors and at least 0.005 per race on the validation season, improves at least 3 of 4 history seasons, and is not worse than 1 standard error on 2026 or on rounds 3 to 5 | Approved |
| D31 | Model versioning | `MODEL_VERSION` (`v1`, `v2`) in `OddsResult` and the feed; v1 stays reproducible with parameters | Approved |
| D32 | Roadmap after Phase 4 | Phase 5 WCC Path Solver, Phase 6 LAN mode + write token + small ops tools, Phase 7 multi-season prior; the owner may reorder | Approved |
| D33 | Grid in the odds model | The starting grid enters a race as `gridWeight * (-ln(grid place))` added to a driver's strength. Adopted at `gridWeight` 1 by the D30 protocol (`docs/MODEL.md`, Step 7). The season simulation uses the real grid of the next race when the data has one (`SeasonState.upcomingGrid`) and a simulated qualifying order (`qualifyingNoise` 2, fitted on 2022 to 2024) for later races. `gridWeight` 0 gives v2 without the grid; v1 stays reproducible with both at 0 | Approved |
| D34 | What a team "wins" and the baseline | A one-two (both active cars P1 and P2); the baseline when it does not win is P2 and P3. Measure: `minOneTwos`. A rival team's pace limit is the best pair of places it may take in every session (P3-P4, P5-P6, P7-P8, P9-P10, or outside the points) | Approved |
| D35 | WCC solver in the UI | A "Drivers / Constructors" switch inside "Possible?" (default Drivers); the WCC table gets the same status tags as the WDC table | Approved |
| D36 | WCC feed | New routes `/api/feed/team-status` and `/api/feed/team-path/:team`; existing routes do not change | Approved |
| D37 | Access policy | Reading is open (UI, season, health, the feed); writing needs `TTF_WRITE_TOKEN` whenever the server can be reached beyond this computer, and is local-only without a token; the server refuses to start on a non-loopback host without a token; no CORS headers | Approved |
| D38 | Token in the browser | Kept for the browser session by default, with an optional "Remember on this device"; never in a URL, a share link or an exported image | Approved |
| D39 | Refreshing data | A script the owner runs (`bun run refresh`); the open page shows a "New data" notice and never reloads by itself | Approved |
| D40 | PNG export | Canvas drawn from a pure layout, square 1080×1080 and wide 1920×1080, with "Model estimate" and "as of Round N" whenever odds are shown | Approved |
| D41 | F1GStats debug output | Hidden by default, `--verbose` brings it back | Approved |
