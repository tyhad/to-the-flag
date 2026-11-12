# Phase 7: Standings and positions

**Status: built (Steps 1 to 7).** Step 8 (position probabilities) is optional and was not built. See "As built" at the end for what differs from the plan and what still needs a look in a real browser.

Branches: `phase-7-positions` in `to-the-flag`, and `phase-7-validation` in `F1GStats` (Step 1 only). One commit per step. Tests first wherever there is logic. Read `DESIGN.md` (sections 2, 6, 9), `docs/PHASE_2.md` (the table and feed), `docs/PHASE_5.md` (team status), `docs/FEED.md`, and `AGENTS.md`.

**Goal:** make the table usable as a normal standings table, and show for every driver and team the highest place they can still reach on points.
**Not in Phase 7:** a worst-possible-place figure (a points-only bound is far too loose, see below), a solver for "what does X need to finish P3", position probabilities (optional Step 8), multi-season prior (Phase 9).

## Decisions

| # | Decision | Recommendation |
|---|---|---|
| D42 | The "no title" marker | No strike-through anywhere. A driver or team that can no longer win the title keeps the normal row text color and gets a small tag **`✕ No title`** (icon plus text, never color alone). "Not racing" stays as it is. `DESIGN.md` is updated. **Approved.** |
| D43 | "Best" position rule | `best = 1 + the number of other entries whose points are strictly greater than this entry's ceiling`. The ceiling is the entry's projected points plus what it can still score in the open sessions (for a driver who is not racing, the ceiling is simply their points). Same rule for teams. Shown as "P2". It is a floor: the entry **cannot** finish above that place; reaching it is possible on points alone, but the rule does not check that every rival can be held back at once. **Approved.** |
| D44 | When title info shows | A "Title info" control above the table with three states: **Auto** (default), On, Off. Auto shows the status tags and the Best column only once at least one entry in the table being viewed (WDC or WCC) can no longer win the title; before that every entry would say "alive" and "P1", which adds nothing. On always shows them, Off never. No round number is used, so it works for any season length. Off (or Auto while nobody is out) leaves rank, driver, points and delta: a plain standings table. The choice is remembered in the browser and the PNG card follows it. |
| D45 | Position probabilities | Optional (Step 8): chances of finishing in each place, from the existing Monte Carlo run. Only if the owner asks for it. |

## Why only "Best" (and not a worst place)

For the title, "win every remaining session" is never worse for the driver, which makes the answer exact. For other places it is not, because each session has only one P1, one P2, and so on, so rivals compete for the same slots. A points-only bound for the **worst** place says things like "ANT could fall to P6", which cannot happen because five rivals cannot all pass in eight sessions. The Best bound is different: the drivers whose points already exceed this driver's ceiling are above in every scenario, so the floor is certain. That is why only Best is shown, and why its label says "on points alone".

## What exists (verified on `main` after the Phase 6 merge)

- The tower row marks eliminated drivers with `line-through` (`web/components/TowerRow.tsx`, line 17). Drivers who are not racing (not in the latest round) get the "not racing" tag and no strike, so OCO, TSU and HIR looked different from other out-of-title drivers.
- `driverStatus` and `teamStatus` already return `maxPossible` (the ceiling) and `status` for every row, scenario-aware.
- The status tags are built in `web/viewModel/tower.ts` and drawn by `web/components/StatusTag.tsx`; the PNG card (`web/viewModel/card.ts`) has its own case for `eliminated`; `DESIGN.md` says "Eliminated ... line-through" in sections 2, 6 and 8.
- The feed rows of `/api/feed/status` and `/api/feed/team-status`, and the tables of `bun run check`, carry `status`, `max_possible`, `gap_to_leader` and `points_to_clinch`, but no best place.
- F1GStats: the fix for drivers with an empty code in the API (`ed90a82`) is on `main`. V5 only checks the format of the abbreviation, and V6 compares the rows per round with the number of drivers in the standings (25 against 22 now raises a warning although nothing is wrong).

Real data check (the Round 16 fixture, 8 sessions left). By the D43 rule: ANT, RUS, HAM, LEC, NOR and VER are P1; PIA, HAD and LAW P2; GAS and LIN P3; COL, BEA and BOR P4; HUL, OCO, ALO, SAI and ALB P5; STR, BOT and PER P7; TSU (not racing, ceiling 1) P20. Teams: Mercedes, Ferrari, McLaren and Red Bull P1; RB P2; Alpine, Haas, Audi, Williams, Aston Martin and Cadillac P3. On this data "best 2 or worse" is exactly the set the engine calls eliminated.

## Layout added in this phase

```
engine/    positions.ts                         (flat, pure; exported from index.ts)
web/       useTitleInfo.ts  components/TitleInfoSwitch.tsx  components/icons.tsx (a cross icon)
```

## Steps

### Step 1: F1GStats validation (repo `F1GStats`, branch `phase-7-validation`)

**Goal:** the checks stop crying wolf and catch the next real problem.

**Change (`validation.py`):**
- **V5** also fails when two different drivers (different `driver_name`) share one abbreviation. The message lists the abbreviation and both names.
- **V6** compares the rows of each Race and Sprint round with `2 × the number of constructors` (22 for 11 teams): fewer than `2 × teams − 2` or more than `2 × teams` is a warning. It no longer uses the number of drivers in the standings.
- Update `docs/DATA_CONTRACT.md` (V5, V6) and `CHANGELOG.md`.

**Tests first (hand-made rows):** a season with 25 drivers in the standings and 22 rows per round gives no V6 warning; 19 rows in one round does; 24 rows does; two names with one abbreviation fail V5; the new-driver case (empty code, derived abbreviation) still passes.

**Commit:** `fix: V5 duplicate abbreviations, V6 against the number of cars`

### Step 2: Best positions (engine)

**Goal:** the D43 rule as a pure function.

**Change (`engine/positions.ts`, exported from `engine/index.ts`):** `bestPositions(entries)` takes `{ id, points, ceiling }[]` and returns a map from id to the best place. A helper turns `driverStatus` rows (using `maxPossible`) and `teamStatus` rows into entries, so the table, the feed and the CLI use the same numbers. The function does not modify its input and never throws on an empty list.

**Tests first (hand-made):**
- The rule on a small table, including a tie on points (a tie is not "strictly greater", so it does not count as above).
- `1 ≤ best ≤ current rank` for every entry.
- Every entry that can still win the title has `best = 1`; every entry that cannot has `best ≥ 2` (checked against `driverStatus` and `teamStatus` on hand-made tables and on the real fixture).
- A driver who is not racing has `best` equal to their place by points.
- Scenario-aware: with nothing left to run (every remaining session locked), each ceiling equals the projected points, and the best place equals the place by points (ties aside). With one open session, a lock changes the projected points and the ceilings as a hand calculation says.
- The real fixture gives the numbers listed above.

**Commit:** `feat(engine): best position by points ceiling`

### Step 3: The `✕ No title` marker

**Goal:** no strike-through; the table reads like a normal standings table.

**Change:**
- Remove the `line-through` styling. Eliminated rows keep the normal text color. Rows of drivers who are not racing stay in `text-3` with their "not racing" tag.
- The status tag for eliminated reads **`✕ No title`** (sentence case, no fill, `text-3`, a cross icon plus the text; the accessible name says "Cannot win the title"). Drivers and teams use the same tag. Add the icon to `web/components/icons.tsx`.
- The PNG card (`web/viewModel/card.ts`) uses the same mark and text.
- `DESIGN.md`: replace the "Eliminated is not a color … line-through" rule with the new rule, and update the status tag description (section 6) and the content rules (section 8, "Clinched, No title"). Add a check to `tests/design-tokens.test.ts` that no file under `web/` contains `line-through`.

**Tests first (view-model):** the tag for each status including `No title`; no row view carries a strike flag; "not racing" is unchanged; the card text for an eliminated driver.

**Commit:** `feat(web): no-title marker instead of strike-through`

### Step 4: The Best column

**Goal:** show the highest place still possible.

**Change:**
- `web/viewModel/tower.ts`: every row gets `best` (a number) and its display text ("P2"), from `bestPositions` applied to the **projected** table of the current scenario (so locks change it), for the WDC and the WCC tabs.
- `TowerRow` and `Tower` get a narrow "Best" column before the status tag, with a header and an accessible name "Highest place still possible on points alone". One short hint line under the table (caption size): "Best = the highest place still possible on points alone."
- Nothing else in the row changes; layout checked at 1920×1080 and 1280 wide.

**Tests first (view-model):** values and text for drivers and teams, the leader, a driver who is not racing, a scenario that changes a value, and the invariant with `status`.

**Check:** on the real data, the Best values agree with a hand calculation for two drivers (count the drivers whose points are above the driver's ceiling).

**Commit:** `feat(web): best position column`

### Step 5: "Title info" control (Auto, On, Off)

**Goal:** the same screen works as a plain standings table.

**Change:**
- `web/useTitleInfo.ts` keeps the choice (`auto`, `on` or `off`; default `auto`) in `localStorage`, inside try/catch. A pure `titleInfoVisible(mode, rows)` decides: `on` is true, `off` is false, `auto` is true only when some row's best place is 2 or worse.
- `web/components/TitleInfoSwitch.tsx`: a labeled three-way control above the table ("Title info: Auto / On / Off"), keyboard operable with a visible focus ring (`DESIGN.md` controls). The WDC and WCC tabs decide separately in `auto`.
- When the info is hidden (Off, or Auto while nobody is out), the status tag and the Best column are not drawn; the rank, team strip, driver, points and delta stay. The PNG card follows the same decision (`buildCard` takes the flag).
- The "Possible?" and "Likely?" panels are not affected.

**Tests first:** the hook's default (`auto`) and storage failure (storage that throws gives the default); `titleInfoVisible` for each mode, including `auto` with nobody out and with one entry out; the table view-model and the card layout when the info is hidden.

**Commit:** `feat(web): title info switch`

### Step 6: CLI, feed and docs

**Goal:** the same figure everywhere.

**Change:**
- `engine/report.ts`: the WDC and WCC rows carry `bestPosition`; the text tables of `bun run check` get a "Best" column ("P2"); `--json` includes it.
- `/api/feed/status` and `/api/feed/team-status`: each row gets `best_position` (a number), and the flattened fields get `top{n}_best` for easy field picking. The change only adds keys, so existing overlay bindings keep working. Update `docs/FEED.md`.

**Tests first:** the report shape and text, the feed rows and flattened fields agree, and the numbers equal the engine's for the fixture.

**Commit:** `feat: best position in the check report and the feed`

### Step 7: Polish and docs

**Change:** keyboard walkthrough of the switch and the table; layouts at 1920×1080 and 1280 wide; the `DESIGN.md` checklist (section 11); `README.md` (what the Best column means, the switch); `SPEC.md` (phase table and decisions D42 to D45, domain note on "Best"); `AGENTS.md` status; `docs/PHASE_7.md` marked as built.

**Commit:** `chore: standings and positions polish and docs`

### Step 8 (optional, only if the owner asks): position probabilities

**Goal:** "Likely?" for places other than P1.
**Change:** `simulateSeason` also counts, per driver and per team, how often each final place occurs; `OddsResult` gets a `positions` block (for each id: the chance of each place, the chance of the top three and the most likely place, all through `formatProbability`); the "Likely?" panel gets a place view; `/api/feed/odds` gets the fields. Same labels as before ("Model estimate", "as of Round N"). Seeds and the model version stay as they are, so existing numbers do not change.
**Commit:** `feat: position probabilities`

## Phase 7 is done when

1. In a fresh clone without extra files, `bun test` and `bun run typecheck` pass and `bun run build` works; F1GStats `pytest` passes.
2. No strike-through exists in the UI or the PNG card (a test enforces it); out-of-title entries carry the `✕ No title` tag, and drivers who are not racing keep their tag.
3. The table shows the Best column for drivers and teams, scenario-aware, and the values agree with a hand calculation; `best ≥ 2` exactly when the entry cannot win the title.
4. In Auto the tags and the Best column appear only once someone is out of the title race in that table; Off always gives a plain standings table; the choice survives a reload.
5. `bun run check` and the feed show the same best places as the UI.
6. A fetch with a newly added driver whose code is empty in the API produces `ok` or `warn`, never `fail`, and V6 stays quiet when 22 cars race.
7. `DESIGN.md`, `SPEC.md` and `AGENTS.md` are updated.

Then open pull requests `phase-7-positions` → `main` in `to-the-flag` and `phase-7-validation` → `main` in F1GStats, and merge (F1GStats first).

## Known limits (deliberate)

- "Best" is a floor from points only. It does not check that all rivals can be held back at the same time, so in tight fights the highest place may be a little optimistic. The label and the hint say "on points alone".
- Ties on points do not count as "above", so a tie never lowers Best; the tie-break (countback) is not applied.
- No worst-possible place and no solver for target places; both need a rival-slot model that Phase 7 does not attempt.

## As built

Steps 1 to 7 are done. Step 1 is in F1GStats (`phase-7-validation`); Steps 2 to 7 are in `to-the-flag` (`phase-7-positions`).

**Where the code is:** `engine/positions.ts` (`bestPositions`, `driverPositionEntries`, `teamPositionEntries`); `web/viewModel/titleInfo.ts` (the modes, the storage under `ttf_title_info`, `titleInfoVisible`, the keyboard rule); `web/useTitleInfo.ts`; `web/components/TitleInfoSwitch.tsx`; `web/viewModel/tower.ts` (`best`, `bestText`, `towerColumns`, `rowTextTone`, the no-title constants); `engine/report.ts` and `api/routes/feed.ts` for the CLI and the feed.

**Where it differs from the plan above:**

- **F1GStats V6** checks Sprint rounds as well as Race rounds, with the same bounds (`2 × teams − 2` to `2 × teams`). With no constructor rows it is skipped (`ok`), because V1 already reports that.
- **No strike flag:** the tower row view no longer has an `eliminated` field at all; the text tone comes from `rowTextTone` (only a driver who is not racing is dimmed). A test (`tests/design-tokens.test.ts`) fails if any file under `web/` contains `line-through`.
- **The PNG card flag** is `CardView.showTitleInfo`, set by `buildCardView` (which has the drivers' rows that Auto looks at), not a third parameter of `buildCard`. The card draws no status column when it is false. A driver who is not racing still has a blank status on the card, as before.
- **Feed:** `best_position` is a row field of `/api/feed/status` and `/api/feed/team-status` (snake_case, also in `/status`, whose other fields are camelCase). Because every row field is flattened, it also appears as `top{n}_best_position`; `top{n}_best` (places 1 to 10) is the short alias and is `0` for an empty place.
- **`bun run check`:** the text tables got a `Best` column and `--json` has `bestPosition`. `scripts/statusReport.ts` (a separate script) is unchanged. The CLI and the feed still say `eliminated` as the status value; only the UI and the card say "No title".
- **No `CHANGELOG.md` in this repo** (the release notes are planned for Phase 10); F1GStats has its own, updated in Step 1.

**Checked with tests (both repos, in fresh clones with a clean install):** F1GStats `pytest` 66 passed; `to-the-flag` `bun test` 1672 passed (2 skipped), `bun run typecheck` and `bun run build` clean. The Round 16 values equal the list in "What exists" in the engine, the table view-model, `bun run check` and both feeds; two drivers (GAS, ALB) and one team (RB) are also checked against a hand count in `tests/bestColumn.test.ts`. A Ferrari one-two lock moves RB from P2 to P3 in the team feed, as counted by hand.

**Not checked by the agent (needs a real browser or real data; tick these yourself):**

- [ ] Keyboard walkthrough of the Title info switch (Tab reaches the selected option, arrows, Home and End move and keep focus, the focus ring is visible) and of the table rows.
- [ ] Layout at 1920×1080 and at 1280 wide: the tag `✕ No title` fits its 6rem column; at 1280 the name column is about 96px with the title info shown, so a long team name may be cut (it has a tooltip). If it is cut, narrow the `2.5rem` Best column or widen the panel in `TOWER_COLUMNS` (`web/components/TowerRow.tsx`).
- [ ] Auto switches on by itself when a lock puts someone out of the title fight, and back when the lock is removed; the table does not jump in a way that is hard to follow.
- [ ] The choice survives a reload, and the page still works with browser storage blocked (it falls back to Auto).
- [ ] Export picture with Title info On and Off: the card follows the choice, and the `✕` character shows in the exported image (it is text; the card font may fall back to a system font for that glyph).
- [ ] `bun run check` and a real F1GStats fetch on the current data: the Best column shows, `--json` parses, and the V5 and V6 results are `ok` or `warn`, never `fail`, with a newly added driver and with 22 cars racing (unit-tested, but no real fetch was run).

**The "done" list above:** items 1, 3 (values and `best ≥ 2` exactly when out), 5 and 7 are covered by the checks above. Item 2 (no strike-through) is enforced by a test; item 4 (Auto and Off behavior) is tested on the view-model and the markup, with the browser part in the list above; item 6 is covered by unit tests in F1GStats.