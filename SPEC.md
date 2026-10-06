# To the Flag — Product & Engine Spec
> Working name: **To the Flag** (owner proposal; check domain and repo availability). Tagline pending, see D3.

**Status:** DRAFT v0.2. D1 (TypeScript engine) and D2 (theme) are approved. Planning only; start Phase 0 once the open decisions in section 12 are closed or explicitly deferred.
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

## 5. Data contract (what F1GStats must provide)

The canonical version, including exact DDL, lives in the F1GStats repo at `docs/DATA_CONTRACT.md` (the producer owns the schema). This section is a summary; if they differ, the F1GStats file wins.

Existing tables stay unchanged: `meta`, `sessions`, `driver_standings`, `constructor_standings`, `starting_grid`.

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
- Method: dynamic programming over points swing versus the key rivals; do not enumerate full finishing orders.

**F3. Odds (Monte Carlo).** Phase 3, separate from F2.
- Season-only data in v1; `prior_carryover` parameter reserved for later seasons (default 0).
- Finishing order via Plackett–Luce with driver strength estimated from this season's results, weighted toward recent rounds, shrunk toward the mean; DNF as Bernoulli from this season's rate; strength uncertainty sampled per simulation.
- WCC is aggregated from the same simulated driver results.
- 10k–20k simulations, seeded PRNG (seed derived from `asOfRound` + scenario hash) so numbers do not jitter between runs.
- Expose `low_confidence = true` when fewer than 5 rounds are complete.

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
| 0. F1GStats data | `schedule_full`, `race_results` (+ sprint), season-scoped replace, single-transaction write, `data_health` checks | A run on the current season produces all tables and passes the checks; a forced validation failure leaves the data tables unchanged (exit code 2) |
| 1. Engine core | F1, F2 (WDC) in TypeScript with fixtures and unit tests (points tables, shortened races, countback, remaining points) | Tests pass on fixtures including a countback tie, each shortened-race column, and the sprint 50% threshold |
| 2. UI + feed | F4 and F5, Finish Lane | The owner can lock sessions and see the table, status and path update in under ~100 ms on the client |
| 3. Odds | F3 and its UI tab | Seeded runs are reproducible; probabilities sum to 100% across contenders; low-confidence tag works |

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
| D3 | Name and tagline | Name: "To the Flag" (owner proposal). Tagline pending; recommendation: "Set the results. Find the path." | Open |
| D4 | Port and network | Default `PORT=3100`, `HOST=127.0.0.1`; LiveOverlay uses 3000; LAN mode deferred (see section 3) | Decided, LAN deferred |
| D5 | Sprint partial points | None. Full table at ≥ 50% distance, otherwise 0 (FIA A2.2.2) | Resolved |
| D6 | Countback | Races only, no sprints; level iv uses qualifying results (FIA A2.1.4.c) | Resolved |