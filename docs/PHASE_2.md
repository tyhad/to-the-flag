# Phase 2: API, what-if UI, overlay feed

Branch: `phase-2-ui`. One commit per step. Tests first wherever there is logic (API routes, view-models, codecs). Read `SPEC.md` (sections 3, 7, 8, 9), `DESIGN.md` (all of it), and `docs/PHASE_1.md` before starting.

**Scope:** Elysia API, scenario storage, overlay feed, and the what-if web UI with the Path Solver ("Possible?").
**Not in Phase 2:** Monte Carlo odds ("Likely?" shows a disabled empty state), WCC Path Solver, LAN mode, accounts, drag-and-drop (nice-to-have), model code of any kind.

## Decisions (D9 approved; D12 provided as `web/theme/teams.ts`)

| # | Decision | Recommendation |
|---|---|---|
| D9 | Web framework | React 19 + TypeScript, bundled by Bun. No extra state library (React state + context). **Approved.** |
| D10 | Where the engine runs in the UI | In the browser. The server sends one `SeasonState` snapshot; every lock change is computed locally (no round trip). |
| D11 | Scenario persistence | Server-side `to-the-flag.sqlite` (own file, env `TTF_DB`, default `./to-the-flag.sqlite`, gitignored) plus a share link. |
| D12 | Team colors | `web/theme/teams.ts` (keyed by Ergast `constructorId`), with `brand` colors from the owner and contrast-safe `display` colors. Use only `teamColor(id)`. This file is the only place besides the theme CSS allowed to hold raw hex. **Provided;** `tests/teams.test.ts` checks the ids against the real fixture. |

## What exists from Phase 1 (verified: `main` @ `92d3c45`, 256 tests pass, typecheck clean)

- `engine/index.ts` is the public entry (covered by `tests/engineIndex.test.ts`): standings (`computeDriverStandings`, `computeConstructorStandings`), `driverStatus`, `solveWdc`, `validateScenario`, `witnessScenario`, `remainingSessions`, `activeDrivers`, `sessionKey` / `parseSessionKey`, `paceLimit`, points tables and the types (`SeasonState`, `Scenario`, `SessionLock`, `PathResult`). Names are as in `docs/PHASE_1.md`; check the file for exact signatures.
- `data/loadSeason.ts` (read-only, checks `schema_version >= 2`, returns `health`), `config.ts` (`F1GSTATS_DB`, `PORT` 3100, `HOST` 127.0.0.1).
- `scripts/check.ts` (`buildCheckReport` returns a plain-JSON report; `--json` prints it), `scripts/statusReport.ts`, `scripts/verifyStandings.ts`, `tests/enginePurity.test.ts` (enforces the purity rule), fixtures and `tests/helpers.ts`.

Sanity numbers at the Round 16 fixture (they change as the season goes on): 8 remaining sessions (7 races + 1 sprint), 22 active drivers (TSU inactive), 11 constructors. ANT leads with 320 points (RUS 236, HAM 214, LEC 191, NOR 188, VER 188). Six drivers are alive and nobody has clinched. ANT needs 100 more points to clinch (conservative); NOR and VER need 133 of 183 (73%); RUS needs 85 of 183 (46%).

## Layout added in this phase

```
api/               server.ts, routes/ (health, season, scenarios, feed), db.ts (to-the-flag.sqlite)
shared/            pure helpers used by server and browser (shareCodec.ts)
web/               index.html, main.tsx, components/, viewModel/, styles/theme.css, theme/teams.ts, fonts via npm
dist/              build output (gitignored)
docs/FEED.md       overlay feed reference
```

Rules that still apply: `engine/` stays pure; the browser never touches SQLite; the web UI makes **no external network requests** (fonts and assets are bundled).

## Steps

### Step 1: API skeleton

**Goal:** a server that exposes the data and its health.

**Change:**
- `bun add elysia @elysiajs/static`. `api/server.ts` listens on `config.HOST`/`config.PORT`. Export an `app` object so tests can call `app.handle(new Request(...))` without a network.
- `GET /api/health` → `{ ok, season, asOfRound, dataStatus: "ok"|"warn"|"fail", checkedAt, schemaVersion }`.
- `GET /api/season` → the `SeasonState` JSON from `loadSeason`. Cache the loaded state and reload when the file's mtime or size changes. Support `ETag` / `If-None-Match` (304).
- If the data file is missing or `schema_version < 2`: HTTP 503 with `{ error, message }` in plain words (what failed, what to do). Never leak file paths.
- `dev` script becomes `bun --watch api/server.ts` (keep the other script names).

**Tests first** (use a fixture-backed loader): health shape; season payload equals the fixture; 304 on a matching ETag; 503 on a missing file and on schema version 1.

**Check:** `bun run dev`, then open `http://127.0.0.1:3100/api/health` (or `curl http://127.0.0.1:3100/api/health`). Values match the real database.

**Commit:** `feat(api): health and season endpoints`

### Step 2: Scenario storage and share codec

**Goal:** save scenarios, mark one active, and share them as a link.

**Change:**
- `api/db.ts` opens `to-the-flag.sqlite` with `bun:sqlite`; migrations via `PRAGMA user_version`. Tables: `scenarios(id, name, season, as_of_round, locks_json, contenders_json, created_at, updated_at)` and `app_state(key, value)` for the active scenario id.
- Routes: `GET /api/scenarios`, `POST /api/scenarios`, `GET|PUT|DELETE /api/scenarios/:id`, `GET|PUT /api/active-scenario` (`{ id: string | null }`).
- Validate on write with `validateScenario` against the current `SeasonState`; invalid → 422 `{ errors: [...] }`.
- On read, re-validate: each scenario carries `valid` and `stale` (`stale` = saved at an older `as_of_round`). Never delete a scenario because it became invalid.
- `shared/shareCodec.ts`: `encodeScenario` / `decodeScenario` using `CompressionStream("deflate-raw")` + base64url, with a version prefix (`v1.`).

**Tests first:** CRUD round trip on a temp database file; 422 cases; stale and invalid flags after the state advances a round; codec round trip, rejects garbage and unknown versions; an 8-session scenario encodes to a short string (assert under about 600 characters).

**Commit:** `feat(api): scenario storage and share codec`

### Step 3: Overlay feed

**Goal:** flat JSON that LiveOverlay's API binding can read.

**Change:** `GET` routes under `/api/feed/`:
- `standings`: base WDC rows.
- `status`: driver statuses.
- `path/:driver`: `PathResult` summary for an active driver (404 otherwise).
- `odds`: `{ "available": false }` until Phase 3.
- `active-scenario`: projected WDC and WCC under the active scenario, with `scenario: { id, name } | null`. With no active scenario it returns the base tables.

Every payload includes `updated_at`, `as_of_round`, `data_status`, `season`. Rows are arrays of objects with only primitive fields. Also add flattened convenience fields for easy field picking (`top1_driver`, `top1_points`, … up to `top10_*`). Send `ETag` and `Cache-Control: no-cache`.
If you reuse `buildCheckReport`, move its pure part to `engine/report.ts` (the purity test covers it) and import it from both the CLI and the API. `api/` must not import from `scripts/`.
Write `docs/FEED.md`: every route, one example response each, and the manual steps to bind a field in LiveOverlay (that wiring happens in the LiveOverlay repo and is out of scope here).

**Tests first:** each route's shape; flattened fields agree with the arrays; 404 for an unknown or inactive driver; `active-scenario` changes after `PUT /api/active-scenario`.

**Commit:** `feat(api): overlay feed and FEED.md`

### Step 4: Web scaffold, tokens, build

**Goal:** an empty but correct app shell.

**Change:**
- `bun add react react-dom` (+ `@types/react`, `@types/react-dom`), Tailwind v4 (`tailwindcss` and its CLI or Bun plugin, whichever works with the installed Bun), `@fontsource/barlow`, `@fontsource/barlow-condensed`.
- `web/styles/theme.css`: the `@theme` block from `DESIGN.md` section 10 (do not redefine `--spacing-N`). Bundle fonts locally; no CDN.
- `web/index.html`, `web/main.tsx`: shell with the three-region layout from `DESIGN.md` section 5 (header, sessions rail 320px, standings center, panels rail 360px, scenario strip). Empty states use the copy rules in `DESIGN.md` section 8.
- Server serves `dist/` with `@elysiajs/static`. Scripts: `build` (CSS + JS into `dist/`), `dev` serves and rebuilds on change.
- `tests/design-tokens.test.ts`: fail if any file under `web/` has a raw hex color (except `theme.css` and `web/theme/teams.ts`) or a `box-shadow` other than the clinched glow token.

**Check:** `bun run build` passes; `bun run dev` shows the shell at `http://127.0.0.1:3100`; DevTools Network shows only `127.0.0.1` requests; the focus ring is visible when tabbing.

**Commit:** `feat(web): app shell, theme tokens, offline fonts`

### Step 5: Standings view

**Goal:** the timing-tower table, live from the engine.

**Change:**
- Fetch `/api/season` once; run `computeDriverStandings` / `computeConstructorStandings` in the browser.
- `web/viewModel/tower.ts` (pure): `buildTowerRows(state, scenario, tab)`, `formatDelta` (`▲ 12`, `▼ 8`, `●`), `statusTag`.
- Components per `DESIGN.md` section 6: tower row (3px team strip via `teamColor(id)`, position, code, `current → projected`, delta chip, status tag), WDC / WCC tabs, eliminated row (`text-3` + line-through), inactive driver dimmed with the text "not racing".
- Motion per section 7: rows re-sort with a FLIP-style swap (about 250 ms) and numbers tween (about 300 ms); `prefers-reduced-motion` swaps instantly. CSS FLIP preferred; GSAP is acceptable.

**Tests first (view-model only):** ordering, delta formatting, status tags, inactive and eliminated flags, and WCC rows after a locked scenario.

**Check:** with no locks, the table matches `driver_standings` order and points. Screenshot at 1920×1080 and at 1280 wide; text is readable and nothing scrolls sideways.

**Commit:** `feat(web): standings tower`

### Step 6: Sessions rail and locks

**Goal:** the owner sets results and the table reacts instantly.

**Change:**
- Session cards for every remaining session ("Round 17 · Singapore · Sprint"), each with Open / Locked state (`DESIGN.md` section 6).
- Position picker: slots P1–P10 (race) or P1–P8 (sprint). **Contender mode** by default: contenders = top 5 active non-eliminated drivers, user-selectable up to 8; only contenders are assignable; any driver can be marked **out**. Full mode lets the owner assign any active driver to any slot.
- Presets: "Contender wins", "Rival out", "Clear". Show the hint "Drivers outside your selection score 0 in locked sessions."
- Validate with `validateScenario` in the browser and show the error inline in plain words.
- "Reset scenario" button.

**Tests first:** a view-model that turns UI actions into a `Scenario` (lock, unlock, preset, out, duplicate position rejected). A performance test: with all 8 sessions locked on the real fixture, standings plus status for all drivers finish in under 100 ms (loose bound for CI variance).

**Check:** lock the next race for the leader at P1; the table, deltas and statuses update at once; unlocking restores the base table.

**Commit:** `feat(web): session locks and position picker`

### Step 7: "Possible?" panel

**Goal:** the Path Solver, in plain words.

**Change:**
- Contender select (default: the driver in second place). Call `solveWdc` in the browser with the current scenario.
- Copy, from the `PathResult`:
  - eliminated: "{Name} cannot win the title any more."
  - alive: "{Name} can still win the title."
  - clinched: "{Name} has clinched the title."
  - the table leader while still alive: "{Name} leads. {n} more points clinch the title, if every rival scores the maximum." (uses `pointsToClinch`; never show "needs 0")
  - no wins needed: "No wins needed: P2 in every session is enough if every rival scores nothing."
  - needs: "Needs at least {n} wins ({races} races, {sprints} sprint) if every rival scores nothing."
  - rival budget: "If {Name} wins every remaining session, {Rival} can score at most {budget} more points, and never better than P{p} in every session." (`paceLimit` 11 reads "outside the points in every session"; negative budget reads "cannot be beaten this way").
  - `exact = false`: "Estimate: too few other drivers are left to fill the points positions."
- Difficulty meter with bands in `web/config.ts` (default: up to 0.40 green, up to 0.75 yellow, above 0.75 orange). It shows a share of points, never a probability.
- Button "Load easiest path into sandbox": copies `easiest` into the current scenario.
- The "Likely?" tab exists but is disabled with the empty state "Model odds arrive in a later release." No percentages anywhere in this phase.

**Tests first (view-model):** copy for each verdict, the budget phrasing, band selection, and that loading `easiest` yields a scenario that passes `validateScenario`.

**Check:** pick the driver in second place; the numbers agree with a hand calculation (points needed = leader points − driver points + 1). On the Round 16 fixture, RUS shows 85 of 183 (46%). For the leader the panel shows the clinch copy, not "needs 0".

**Commit:** `feat(web): possible panel`

### Step 8: Scenario strip

**Goal:** save, compare, share, and send to the overlay.

**Change:**
- Scenario chips: new, save, rename, delete, load, via the API. Show `stale` and `invalid` states without deleting anything.
- Compare mode: two scenarios (or Base vs a scenario) side by side, with rank changes and differing points marked by text and icon, never color alone.
- "Copy link" builds `#s=<encoded>`; opening a link imports the scenario, validates it against the current data, and warns when its `as_of_round` is older.
- "Show on overlay" toggles the active scenario through `PUT /api/active-scenario`; the chip shows a small live marker.
- Stretch (only if everything else is done): export the standings card as PNG, built from a pure SVG renderer drawn to a canvas.

**Tests first:** the scenario-list view-model (stale, invalid, active), and compare diffs.

**Check:** save two scenarios, compare them, copy a link and open it in a private window, then switch the active scenario and watch `/api/feed/active-scenario` change.

**Commit:** `feat(web): scenario strip, compare, share, overlay toggle`

### Step 9: Finish Lane

**Goal:** the signature visual.

**Change:** `web/viewModel/lane.ts` (pure) `laneModel(state, scenario)` returns `{ axisMin, axisMax, finishAt, lanes: [{ driver, base, projected, ceiling }] }`.
- One lane per contender (default top 5). A dot marks the projected points; a thin extension to `ceiling` marks the points maximum.
- The chequered finish line sits at the total where the leader clinches: `max over rivals of (points + remaining max) + 1`.
- The part of the lane gained from locked sessions (base → projected) is filled in `accent`.
- SVG only; tokens only; keyboard-focusable lanes with an accessible text summary for each.

**Tests first:** the lane model on hand-made seasons (finish line position, base/projected/ceiling, no locks and with locks).

**Commit:** `feat(web): finish lane`

### Step 10: Polish and hardening

**Change:**
- Data health states per `DESIGN.md` section 6: `warn` shows a small notice; `fail` or a missing file shows "Data check failed. Showing last valid data from Round N." with the yellow icon; API unreachable shows a clear error.
- Offline check: disconnect the network, reload, everything works.
- Keyboard-only walkthrough of the full flow; visible focus everywhere; reduced motion respected.
- Layout check at 1920×1080 and 1280 wide.
- `README.md`: install, run, build, env vars, how to point at `f1gstats.sqlite`, the feed overview (link to `docs/FEED.md`).
- Walk the `DESIGN.md` checklist (section 11) and fix every miss.

**Commit:** `chore(web): states, offline check, docs`

## Phase 2 is done when

1. `bun test`, `bun run typecheck`, and `bun run build` pass.
2. `bun run dev` serves the UI at `http://127.0.0.1:3100`, works offline, and makes no external requests.
3. The owner can lock sessions and see standings, status and the Path Solver update instantly (compute under 100 ms in the test).
4. All feed routes return valid JSON; the active scenario appears in `/api/feed/active-scenario`; one field has been bound in LiveOverlay by hand (or checked in the browser if the overlay is not ready).
5. The `DESIGN.md` checklist passes.
6. `SPEC.md` phase table and decisions are updated, and `AGENTS.md` status reflects Phase 3.

Then open a pull request `phase-2-ui` → `main` and merge.

## Known limits (deliberate)

- Contender mode treats drivers outside the selection as scoring 0 in locked sessions (decision b of Phase 1), and says so in the UI.
- Rival budgets are independent; joint feasibility is not shown.
- No odds: "Likely?" is a disabled placeholder until Phase 3.
- Single user, local only. LAN mode and a write token are deferred.
