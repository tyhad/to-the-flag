# Phase 8: Race weekend (starting grid, race forecast, export)

Branches: `phase-8-race-weekend` in `to-the-flag`, and `phase-8-grid-info` in `F1GStats` (Step 8 only). One commit per step. Tests first wherever there is logic. Read `docs/MODEL.md` (the grid term), `docs/PHASE_4.md` (Step 7 and 8), `docs/PHASE_6.md` (the write guard and the PNG card), `docs/FEED.md`, `DESIGN.md`, and `AGENTS.md`.

**Goal:** use the tool on a race weekend: put in or correct the real starting grid when the data file only has the qualifying order, see what the model expects for that race, and export the grid.
**Not in Phase 8:** sprint grids, a forecast for races beyond the next one, changes to the title-odds model, multi-season prior (Phase 9).

## What is already there, and what is not

- **Used already:** `SeasonState.upcomingGrid` holds the grid of the next race. The season simulation uses it for that race, and the "Likely?" panel shows "Grid known: Round N". The grid term is part of model v2 (`gridWeight` 1).
- **Exists but not shown anywhere:** `forecastRace(state, params, field, grid)` gives, per driver, the chance to win and to finish on the podium. Only the backtest calls it. There is no panel and no endpoint for "what to expect in the next race".
- **The weak spot:** F1GStats takes the grid from OpenF1 and falls back to the qualifying order when OpenF1 has nothing. OpenF1's grid endpoint is beta and only has data once the official grid is published (a 404 means "not yet"), so the fallback is common. The qualifying order ignores grid penalties and pit-lane starts, and `readUpcomingGrid` accepts it silently.

## Decisions (all Proposed)

| # | Decision | Recommendation |
|---|---|---|
| D46 | Which grid wins | **Manual, then OpenF1 (actual), then qualifying fallback.** A manual grid stays until the owner clears it. If OpenF1 later publishes a different grid, the UI shows a notice with a "Use OpenF1 grid" button; it never switches by itself. The source is always visible: "Grid: manual", "Grid: OpenF1", or "Grid: qualifying (may differ from the real grid)". |
| D47 | Where a manual grid lives | In the app's own database (`to-the-flag.sqlite`, table `grid_overrides`), for the next scheduled race only; ignored once that round has results; never written to `f1gstats.sqlite`. Saving and clearing use the write token (Phase 6). |
| D48 | How the grid is entered | A list prefilled with the grid the app would use now, with quick corrections: move up or down, "drop N places", "back of the grid", "pit-lane start", plus "paste a list" of driver codes in start order. Every active driver must appear exactly once. Pit-lane starters go behind everyone, in the order given. |
| D49 | The race forecast | A "Race" tab beside "Possible?" and "Likely?": for each driver the chance to win, to finish on the podium and in the points, and the expected finish, from the existing model and the effective grid. Labeled "Model estimate", "as of Round N" and the grid source. The forecast returns more fields; the existing win and podium numbers do not change. |
| D50 | Export | A starting-grid PNG card (two columns, pole first; square 1080×1080 and wide 1920×1080), CSV and JSON copy or download, and a feed route for the overlay. No secrets in any of them. |

## Layout added in this phase

```
engine/    grid.ts                                       (flat, pure; exported from index.ts)
api/       routes/grid.ts                                (read, save, clear; feed routes)
web/       components/RacePanel.tsx  components/GridEditor.tsx  components/GridSourceTag.tsx
           viewModel/grid.ts  viewModel/raceForecast.ts  viewModel/gridCard.ts  viewModel/gridExport.ts
```

## Steps

### Step 1: Grid rules (engine, pure)

**Goal:** the operations the editor needs, tested before any screen exists.

**Change (`engine/grid.ts`):**
- `validateGrid(state, order, pit?)`: `order` lists driver codes in start order, `pit` lists pit-lane starters. Every active driver appears exactly once; unknown codes, repeats and missing drivers are named in a plain-words error (`InvalidGridError`).
- `gridFromOrder(order, pit?)` returns the `Record<code, place>` the model uses (pit-lane starters get the places after everyone else, in order).
- `dropPlaces(order, driver, n)`, `backOfGrid(order, driver)`, `moveTo(order, driver, place)`: pure helpers that return a new list.
- `parseGridText(text, state)`: accepts codes separated by spaces, commas or lines (case-insensitive, optional numbers like "1 ANT" or "1. ANT"), and a marker for the pit lane (for example `PIT:` before the pit-lane codes). Anything it cannot read is reported, never guessed.

**Tests first:** each helper on a 6-driver list; `validateGrid` for a missing driver, a repeat, an unknown code and a pit-lane list; `parseGridText` for each format and each failure; inputs are not modified; the result agrees with `readUpcomingGrid` conventions (places 1..N, pit lane last).

**Commit:** `feat(engine): starting grid rules`

### Step 2: Storage, merge and routes

**Goal:** the effective grid, with a manual override.

**Change:**
- `api/db.ts`: a migration adds `grid_overrides(season, round, order_json, pit_json, updated_at)`, one row per season and round.
- `api/routes/grid.ts` (the write routes use the Phase 6 guard):
  - `GET /api/grid`: `{ round, effective: { order, pit, source }, data: { source, order } | null, override: { updatedAt } | null, differs: boolean }`. `data` is what the data file has (OpenF1 or qualifying); `differs` is true when a manual grid exists and `data` is OpenF1's and not the same.
  - `PUT /api/grid` with `{ order, pit }` (validated with `validateGrid`; 422 with the plain-words errors) and `DELETE /api/grid`.
- The season loader merges the override into `SeasonState.upcomingGrid` (`source: "manual"`) when its round is the next scheduled one; otherwise the override is ignored and kept. `/api/season` (and its ETag) change whenever the override changes.

**Tests first (seeded databases, `app.handle`):** the priority order; an override for a round that already has results is ignored; 422 cases; the token is required to write and not to read; clearing falls back to the data grid; the ETag changes after a save and after a clear; `differs` for each combination.

**Commit:** `feat(api): manual starting grid`

### Step 3: Grid source tag and OpenF1 notice

**Goal:** nobody mistakes a qualifying order for the real grid.

**Change:**
- `web/components/GridSourceTag.tsx` and `web/viewModel/grid.ts`: the tag text "Grid: manual", "Grid: OpenF1" or "Grid: qualifying (may differ from the real grid)". Show it next to "Grid known: Round N" in the "Likely?" panel and in the "Race" tab. For a qualifying grid the tag uses the `yellow` timing color plus an icon (never color alone).
- When `differs` is true, a notice (`DESIGN.md` states) says "OpenF1 now has the official grid, and it differs from yours." with a "Use OpenF1 grid" button (clears the override) and a "Keep mine" button (dismisses until the data changes).

**Tests first (view-model):** the tag for each source; the notice appears only when `differs`; the buttons' effects.

**Commit:** `feat(web): grid source tag and notice`

### Step 4: Grid editor

**Goal:** correct the grid in a minute.

**Change:** `web/components/GridEditor.tsx` in the new "Race" tab (a third tab in the analysis rail; empty state "The grid is known after qualifying." when there is none):
- A list of every active driver in start order, prefilled with the effective grid: place number, team strip, code and name, and per row the buttons "Up", "Down" and a menu with "Drop N places", "Back of the grid", "Pit-lane start". All of it works from the keyboard with a visible focus ring; no drag and drop is needed.
- "Paste a list" opens a text box that uses `parseGridText`; errors are shown in plain words next to it.
- "Save grid" (disabled with the reason when the app is read-only) and "Use data grid" (clears the override). Saving shows the new source tag at once.

**Tests first (view-model):** actions to a new order (each quick correction), the pit-lane marking, the validation messages, and the disabled states.

**Check:** with a qualifying-based grid, move one driver down five places and save; "Likely?" shows the tag "Grid: manual", and the odds are recomputed with the new grid.

**Commit:** `feat(web): starting grid editor`

### Step 5: Race forecast

**Goal:** "what to expect in the next race", given the grid.

**Change:**
- `engine/simulate.ts`: `RaceForecast` also returns `top10` (the chance of a classified finish in the points) and `meanPosition` (the average finishing place, a retirement counting as last). The seed derivation, the existing `win` and `podium` values and every current snapshot stay exactly the same.
- `web/viewModel/raceForecast.ts` (pure): rows sorted by win chance with the grid place, win, podium and points chances (all through `formatProbability`) and the expected finish; the header "Model estimate · as of Round N · Grid: {source}".
- `web/components/RacePanel.tsx` shows the forecast under the grid editor. It runs in the existing worker with a new request kind (one race is about an eighth of a season, so it is quick) and uses the same debounce, stale-response and "Updating…" states as `useOdds`.
- A one-line note: "The forecast follows the grid above. Retirements and weather are not known."

**Tests first:** the new fields (the chances sum as they should: the win chances over the field add up to 1, `top10` is at least `podium`, `meanPosition` lies within the field size); the golden tests for the existing fields do not change; the view-model sorting and text; the worker request kind and stale-response handling.

**Check:** on the real data, the front-row drivers have the highest win chances; moving a driver down in the editor lowers that driver's chance; nothing shows "0%" or "100%".

**Commit:** `feat: race forecast`

### Step 6: Feed

**Goal:** the overlay can show the grid and the forecast.

**Change:** `GET /api/feed/grid` (rows: `position, driver, name, team, pit, source`, the usual `updated_at`, `as_of_round`, `data_status`, `season`, and flattened `p1_*` to `p22_*`) and `GET /api/feed/race-forecast` (rows with `win_display`, `podium_display`, `points_display`, `mean_position`, the grid place and the source, plus flattened `top1_*` to `top10_*`; the labels "Model estimate" and `source`). Both read the effective grid. When no grid exists the routes return `{ available: false }`. Same 503 behavior as the other routes. Update `docs/FEED.md`.

**Tests first:** shapes; flattened fields agree with the arrays; the output changes after a manual grid is saved; `available: false`; 503.

**Commit:** `feat(api): grid and race forecast feed`

### Step 7: Export

**Goal:** the starting grid as a picture, a table and data.

**Change:**
- `web/viewModel/gridCard.ts` (pure): the starting-grid card as drawing commands for 1080×1080 and 1920×1080: the title, "Round N · {race name}", the grid source, two columns with pole first (row 1 left, row 2 right, and so on), place, team strip, code and name; pit-lane starters in their own small block; long names are shortened and nothing leaves the card. It reuses the canvas renderer and the theme colors of Phase 6 (`web/exportCard.ts`) and `teamColor`.
- `web/viewModel/gridExport.ts` (pure): CSV (`position,driver,name,team,pit,source`, quoted where needed) and JSON of the same rows.
- Buttons "Export picture" (with the size), "Copy as CSV", "Copy as JSON" and "Download" in the Race tab. A qualifying-based grid carries "(qualifying)" in the picture, so the export never claims more than the data says.
- No tokens, paths or notes in any export.

**Owner's choices (14 Nov 2026), which replace the matching words above:** the picture is drawn like a real grid, not as two plain columns. Pole is at the front (the top); odd places are on the left and even places on the right, with each right-hand car half a row behind its neighbour, so P2 is on the front row but a little back. Each place is a box marked on the track (the line across the front and the two sides, open at the back). A box has the place, the team color and **the driver code only, no name** (the CSV and JSON keep the name). As for the standings card, the picture can show **All, Top 10, Top 12 or a custom range (P from, P to)**; a part of the grid keeps each place in its own column. The CSV and JSON always have every place. The picture is of the saved grid. The details are in `docs/EXPORT.md` ("The starting-grid card"); the layout is in `web/viewModel/gridCard.ts`.

**Tests first (layout and text only):** 20 and 22 cars; the pit-lane block; long names; both sizes; CSV quoting and order; JSON round trip; the source label appears for qualifying and manual grids.

**Check:** export both sizes from the real data and look at them: readable at phone size, pole is where a viewer expects it, nothing overlaps.

**Commit:** `feat(web): export the starting grid`

### Step 8: F1GStats message (repo `F1GStats`, branch `phase-8-grid-info`)

**Goal:** a normal fallback no longer looks like a problem.

**Change:** when OpenF1 answers 404 or an empty list for the grid (the official grid is not published yet), print an `[INFO]` line ("OpenF1 has no grid for round N yet; using the qualifying order, which ignores grid penalties") and not `[WARN]`. Real failures (a timeout, a server error, an unreadable answer) stay `[WARN]`. Behavior and the data written do not change. Add tests for both cases, and update `CHANGELOG.md` and the README note.

**Commit (F1GStats):** `fix: a missing OpenF1 grid is information, not a warning`

### Step 9: Polish and docs

**Change:** keyboard walkthrough of the Race tab (list, menus, paste box, buttons); layout at 1920×1080 and 1280 wide; the `DESIGN.md` checklist (section 11); `README.md` (how to correct the grid, the source order, the exports); `docs/MODEL.md` (what the forecast shows and its limits); `docs/FEED.md`; `SPEC.md` (phase table and decisions D46 to D50); `AGENTS.md` status; `docs/PHASE_8.md` marked as built.

**Commit:** `chore: race weekend polish and docs`

## Phase 8 is done when

1. In a fresh clone without extra files, `bun test` and `bun run typecheck` pass and `bun run build` works; F1GStats `pytest` passes.
2. A manual grid can be entered, saved (with the token), cleared, and exported; it overrides the data grid for the next race only, and it is ignored after that race.
3. The source of the grid is always visible; a qualifying grid is labeled as possibly different; the OpenF1 notice appears only when OpenF1 differs from the manual grid and never switches by itself.
4. The "Race" tab shows win, podium, points and expected finish from the effective grid, labeled "Model estimate"; the title odds use the same grid.
5. The existing win and podium numbers and seeds are unchanged (golden tests).
6. The PNG card, CSV and JSON work offline and contain no secrets; the feed routes return the documented shapes.
7. The `DESIGN.md` checklist passes; `SPEC.md` and `AGENTS.md` are updated.

Then open pull requests `phase-8-race-weekend` → `main` in `to-the-flag` and `phase-8-grid-info` → `main` in F1GStats, and merge (F1GStats first).

## Known limits (deliberate)

- Only the race grid of the next scheduled round. Sprint grids and earlier or later rounds are not handled.
- The forecast uses the grid and this season's form, not weather, tyres or strategy. A retirement is a chance, not a prediction.
- The forecast's points chance and expected finish are new and outside the backtest: the pace fit is built for the
  front (top-5 stages), so the middle and the back of the grid read too well (2026 check in `docs/MODEL.md`, "The race
  forecast's points chance and expected finish"). Recorded as input for the next model version; no default is changed
  on 2026 numbers.
- A manual grid is only as good as what the owner types; the app checks that every active driver appears once, not that the grid matches the stewards' decision.
- The grid term was fitted on qualifying orders and real grids from 2022 to 2025 (`docs/MODEL.md`); it is a statistical average, not a rule.
