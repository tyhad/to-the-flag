# LiveOverlay Feed API Reference

To the Flag serves flat JSON feeds for LiveOverlay Studio (port 3000) or streaming tools under `/api/feed/`.

## General Information

- **Base URL:** `http://127.0.0.1:3100/api/feed`
- **Cache Control:** Every response includes `Cache-Control: no-cache` and an `ETag` header.
- **Common Metadata:** All feed responses include standard season metadata fields:
  - `updated_at`: ISO timestamp string of the last data update.
  - `as_of_round`: Current completed round number.
  - `data_status`: `"ok"`, `"warn"`, or `"fail"`.
  - `season`: Season year (e.g. `2026`).

---

## LAN Access & Security

When the server runs in LAN mode (`HOST=0.0.0.0`):
- **All feed routes under `/api/feed/` remain open and unauthenticated on the home network.** Streaming software (such as LiveOverlay Studio running on a separate streaming PC) can freely poll feeds without authentication headers.
- **Write actions are guarded:** only clients presenting `TTF_WRITE_TOKEN` can create, modify, or delete scenarios or switch the active overlay scenario.
- Keep the server on a private home network; do not expose the port to the public internet.

---

## Routes & Response Examples

### 1. `GET /api/feed/standings`

Returns base Driver World Championship (WDC) standings.

**Example Response:**
```json
{
  "updated_at": "2026-10-07T02:06:22Z",
  "as_of_round": 16,
  "data_status": "ok",
  "season": 2026,
  "rows": [
    {
      "rank": 1,
      "driver": "ANT",
      "name": "Kimi Antonelli",
      "team": "mercedes",
      "teamName": "Mercedes",
      "points": 320,
      "wins": 6,
      "podiums": 12,
      "basePoints": 320,
      "baseRank": 1,
      "deltaPoints": 0,
      "deltaRank": 0
    },
    {
      "rank": 2,
      "driver": "RUS",
      "name": "George Russell",
      "team": "mercedes",
      "teamName": "Mercedes",
      "points": 236,
      "wins": 3,
      "podiums": 9,
      "basePoints": 236,
      "baseRank": 2,
      "deltaPoints": 0,
      "deltaRank": 0
    }
  ],
  "top1_rank": 1,
  "top1_driver": "ANT",
  "top1_name": "Kimi Antonelli",
  "top1_team": "mercedes",
  "top1_teamName": "Mercedes",
  "top1_points": 320,
  "top1_wins": 6,
  "top1_podiums": 12,
  "top2_rank": 2,
  "top2_driver": "RUS",
  "top2_name": "George Russell",
  "top2_team": "mercedes",
  "top2_teamName": "Mercedes",
  "top2_points": 236,
  "top2_wins": 3,
  "top2_podiums": 9
}
```

---

### 2. `GET /api/feed/status`

Returns driver title statuses (clinched, alive, or eliminated) and gap metrics.

**Example Response:**
```json
{
  "updated_at": "2026-10-07T02:06:22Z",
  "as_of_round": 16,
  "data_status": "ok",
  "season": 2026,
  "rows": [
    {
      "driver": "ANT",
      "status": "alive",
      "points": 320,
      "maxPossible": 503,
      "gapToLeader": 0,
      "pointsToClinch": 100,
      "best_position": 1
    },
    {
      "driver": "RUS",
      "status": "alive",
      "points": 236,
      "maxPossible": 419,
      "gapToLeader": 84,
      "pointsToClinch": null,
      "best_position": 1
    }
  ],
  "top1_driver": "ANT",
  "top1_status": "alive",
  "top1_points": 320,
  "top1_maxPossible": 503,
  "top1_gapToLeader": 0,
  "top1_pointsToClinch": 100,
  "top1_best_position": 1,
  "top1_best": 1,
  "top2_driver": "RUS",
  "top2_status": "alive",
  "top2_points": 236,
  "top2_maxPossible": 419,
  "top2_gapToLeader": 84,
  "top2_pointsToClinch": null,
  "top2_best_position": 1,
  "top2_best": 1
}
```

**Fields**

- Row fields keep their camelCase names (`driver`, `name`, `status`, `points`, `maxPossible`, `gapToLeader`,
  `pointsToClinch`), except `best_position`, which is snake_case like the same field in `team-status`.
- `best_position`: the highest place the driver can still reach **on points alone** (Phase 7), a whole number from 1 up.
  It counts the other drivers whose points are already **strictly above** this driver's `maxPossible`, plus one. It is a
  floor, not a promise: the driver may not be able to hold every rival back at once, and a tie on points is not counted
  as being above (no countback). `1` means the driver can still win the title; `2` or more means the driver cannot. A
  driver who is not racing has `maxPossible` equal to his points, so his best place is the place his points give him.
  There is deliberately no "worst place".
- Flattened fields for places 1 to 10: one per row field (`top1_driver`, `top1_best_position`, ...). `top1_best` to
  `top10_best` are the short names for `best_position`, for easy field picking in an overlay. A place with no driver has
  `top{n}_best` `0` rather than a missing key.

---

### 3. `GET /api/feed/path/:driver`

Returns title path summary (`PathResult`) for a specific active driver (e.g. `/api/feed/path/NOR`). If the driver is unknown or inactive, returns HTTP 404.

**Example Response:**
```json
{
  "updated_at": "2026-10-07T02:06:22Z",
  "as_of_round": 16,
  "data_status": "ok",
  "season": 2026,
  "driver": "NOR",
  "verdict": "alive",
  "points": 188,
  "maxPossible": 371,
  "pointsNeeded": 133,
  "difficulty": 0.726775956284153,
  "exact": true,
  "minWins": {
    "total": 5,
    "races": 5,
    "sprints": 0
  },
  "rivalBudgets": [
    {
      "driver": "ANT",
      "budget": 50,
      "paceLimit": 6
    },
    {
      "driver": "RUS",
      "budget": 134,
      "paceLimit": 1
    }
  ],
  "easiest": {
    "locks": {
      "17:race": { "fixed": { "NOR": 1 } },
      "18:race": { "fixed": { "NOR": 1 } },
      "19:race": { "fixed": { "NOR": 1 } },
      "20:race": { "fixed": { "NOR": 1 } },
      "21:race": { "fixed": { "NOR": 1 } }
    }
  }
}
```

---

### 4. `GET /api/feed/odds`

Returns championship odds from a Monte Carlo model of the rest of the season (see `docs/MODEL.md`). It is an **estimate**,
not a fact: show `label` next to the numbers. The odds are for the active scenario, or for the base season when none is active.

**Example Response** (shortened):
```json
{
  "updated_at": "2026-10-07T02:06:22Z",
  "as_of_round": 16,
  "data_status": "ok",
  "season": 2026,
  "available": true,
  "model": "estimate",
  "label": "Model estimate",
  "low_confidence": false,
  "model_version": "v2",
  "grid_known_round": null,
  "n_sims": 10000,
  "scenario": { "id": "c1f7b8d0-5e12-4a92-881b-3f21a5a92bc1", "name": "No ANT" },
  "wdc": [
    { "rank": 1, "id": "ANT", "name": "Andrea Kimi Antonelli", "win_pct": 77.1, "display": "77%", "base_display": ">99%" },
    { "rank": 2, "id": "HAM", "name": "Lewis Hamilton", "win_pct": 16.7, "display": "17%", "base_display": "<1%" }
  ],
  "wcc": [
    { "rank": 1, "id": "mercedes", "name": "Mercedes", "win_pct": 86, "display": "86%", "base_display": ">99%" }
  ],
  "top1_id": "ANT",
  "top1_name": "Andrea Kimi Antonelli",
  "top1_win_pct": 77.1,
  "top1_display": "77%",
  "top1_base_display": ">99%",
  "top1_wdc_display": "77%",
  "top1_wcc_display": "86%"
}
```

**Fields**

- `available`, `model`, `label`: always `true`, `"estimate"` and `"Model estimate"`.
- `low_confidence`: `true` while fewer than 5 rounds are complete. Show a warning next to the numbers.
- `model_version`: which model made the numbers, `"v2"` today (`MODEL_VERSION`; v1 stays reproducible with parameters,
  see `docs/MODEL.md`). The "How this works" note in the panel says the same.
- `grid_known_round`: the round whose real starting grid the model used for its next race, or `null` when it used none
  (no grid in the data yet, or the model's grid weight is 0). Later races use a simulated grid either way; this field
  only says whether the next race's grid is the real one.
- `n_sims`: number of simulated seasons. The odds carry a sampling error of at most `0.5 / sqrt(n_sims)` (0.5 points of
  percentage at 10,000 simulations).
- `scenario`: `{ id, name }` of the active scenario, or `null`. An active scenario that no longer fits the season (for
  example a session it locks has since been run) is ignored, so the feed keeps working and shows the base odds with `null`.
- `wdc`: drivers who won at least one simulated season, or whose title is still open (`alive` or `clinched`). `wcc`: teams
  that won at least one. Both are sorted best first. Row fields: `rank`, `id` (driver code or team id), `name`, `win_pct`
  (percent, two decimals), `display`, and `base_display` (the same odds without the scenario) only while a scenario is active.
- **`display` is the text to show.** It is `"<1%"` below 1%, one decimal from 1% to under 10% (`"3.4%"`), a whole
  percent from 10% to 99% (`"47%"`) and `">99%"` above. It is never `"0%"` or `"100%"`, because a simulation cannot prove
  either. `win_pct` is the raw estimate, so a clinched driver reads `100` there.
- Flattened fields for overlays, for places 1 to 10: `top1_*` is the drivers' table, `top1_wdc_*` the same table with a
  prefix, and `top1_wcc_*` the teams' table. Each place has `rank`, `id`, `name`, `win_pct`, `display` and `base_display`
  (for example `top1_wcc_display`). A place with no row is empty (`""`, `0`) rather than missing, and `base_display` is
  `""` when no scenario is active.

**Caching:** the result is kept per season file version, active scenario (id and last-changed time) and model parameters, so
polling does not simulate again. The response header `X-Odds-Cache` is `hit` when nothing had to be simulated and `miss`
otherwise. The first request after the data or the scenario changes takes a few hundred milliseconds.

**Errors:** HTTP 503 with `error` and `message` when the season data is missing or invalid, like the other routes.

---

### 5. `GET /api/feed/active-scenario`

Returns projected WDC and WCC tables under the current active scenario (or base tables if no active scenario is set).

**Example Response:**
```json
{
  "updated_at": "2026-10-07T02:06:22Z",
  "as_of_round": 16,
  "data_status": "ok",
  "season": 2026,
  "scenario": {
    "id": "c1f7b8d0-5e12-4a92-881b-3f21a5a92bc1",
    "name": "Norris Title Push"
  },
  "wdc": [
    {
      "rank": 1,
      "driver": "ANT",
      "name": "Kimi Antonelli",
      "team": "mercedes",
      "teamName": "Mercedes",
      "points": 345,
      "wins": 7,
      "podiums": 13,
      "basePoints": 320,
      "baseRank": 1,
      "deltaPoints": 25,
      "deltaRank": 0
    }
  ],
  "wcc": [
    {
      "rank": 1,
      "team": "mercedes",
      "name": "Mercedes",
      "points": 581,
      "basePoints": 556,
      "baseRank": 1,
      "deltaPoints": 25,
      "deltaRank": 0
    }
  ],
  "top1_driver": "ANT",
  "top1_points": 345,
  "top1_wdc_driver": "ANT",
  "top1_wdc_points": 345,
  "top1_wcc_team": "mercedes",
  "top1_wcc_points": 581
}
```

---

### 6. `GET /api/feed/team-status`

Returns the constructors' title status of every team (`clinched`, `alive` or `eliminated`), exact and model-free, like
`/api/feed/status` does for drivers. Rows come in projected table order. The route follows the **active scenario**; an
active scenario that no longer fits the season is ignored (as for `/api/feed/odds`), so the feed keeps working.

**Example Response** (shortened):
```json
{
  "updated_at": "2026-10-07T02:06:22Z",
  "as_of_round": 16,
  "data_status": "ok",
  "season": 2026,
  "scenario": null,
  "rows": [
    {
      "rank": 1,
      "team": "mercedes",
      "name": "Mercedes",
      "points": 556,
      "status": "alive",
      "max_possible": 872,
      "gap_to_leader": 0,
      "points_to_clinch": 166,
      "best_position": 1
    },
    {
      "rank": 2,
      "team": "ferrari",
      "name": "Ferrari",
      "points": 405,
      "status": "alive",
      "max_possible": 721,
      "gap_to_leader": 151,
      "points_to_clinch": 468,
      "best_position": 1
    }
  ],
  "top1_rank": 1,
  "top1_team": "mercedes",
  "top1_name": "Mercedes",
  "top1_points": 556,
  "top1_status": "alive",
  "top1_max_possible": 872,
  "top1_gap_to_leader": 0,
  "top1_points_to_clinch": 166,
  "top1_best_position": 1,
  "top1_best": 1,
  "top2_rank": 2,
  "top2_team": "ferrari"
}
```

**Fields**

- `scenario`: `{ id, name }` of the active scenario, or `null`.
- Row fields use snake_case: `rank`, `team` (constructor id), `name`, `points` (including the scenario's locked
  sessions), `status`, `max_possible` (points if the team's two cars finished 1-2 in every open session; a team with one
  active car can only score for P1), `gap_to_leader`, `points_to_clinch`, and `best_position`.
- `points_to_clinch` is `0` when clinched and `null` when eliminated. Otherwise it is the points the team must hold to be
  safe against every rival scoring the maximum from here (conservative).
- A team with no active driver is always `eliminated`.
- `best_position`: the highest place the team can still reach **on points alone**, a whole number from 1 up: the number of
  other teams whose points are already strictly above this team's `max_possible`, plus one. A floor, not a promise (see
  `/api/feed/status` for the details). `1` means the team can still win the title; `2` or more means it cannot. It follows
  the active scenario like the rest of the row. A team with no active car has its own points as `max_possible`, so its best
  place is the place its points give it.
- Flattened fields for places 1 to 10: `top1_*` to `top10_*`, one per row field (for example `top2_team`,
  `top2_status`, `top2_points_to_clinch`, `top2_best_position`). `top1_best` to `top10_best` are the short names for
  `best_position`. A place with no team is empty (`""`, `0`, `null` for `points_to_clinch`, `0` for the best place)
  rather than missing, and `rank` holds the place number.

**Errors:** HTTP 503 with `error` and `message` when the season data is missing or invalid, like the other routes.

---

### 7. `GET /api/feed/team-path/:team`

Returns the path to the constructors' title (`TeamPathResult`) for one team, by constructor id, case-insensitive
(for example `/api/feed/team-path/ferrari`). An unknown id returns HTTP 404. A team that is `eliminated` is a normal
answer (HTTP 200) with the path fields set to `null`. The route follows the active scenario, like `team-status`.

**Example Response** (shortened):
```json
{
  "updated_at": "2026-10-07T02:06:22Z",
  "as_of_round": 16,
  "data_status": "ok",
  "season": 2026,
  "scenario": null,
  "team": "red_bull",
  "verdict": "alive",
  "exact": true,
  "points": 298,
  "maxPossible": 614,
  "pointsNeeded": 259,
  "difficulty": 0.819620253164557,
  "minOneTwos": { "total": 2, "races": 2, "sprints": 0 },
  "rivalBudgets": [
    { "team": "mercedes", "budget": 57, "paceLimit": 9 },
    { "team": "ferrari", "budget": 208, "paceLimit": 3 },
    { "team": "mclaren", "budget": 297, "paceLimit": 3 }
  ],
  "easiest": {
    "locks": {
      "17:race": { "fixed": { "VER": 1, "HAD": 2 } },
      "18:race": { "fixed": { "VER": 1, "HAD": 2 } }
    }
  }
}
```

**Fields** (the result fields keep the camelCase names of `/api/feed/path/:driver`)

- `verdict`: the same as the team's `status` in `team-status`.
- `exact`: `true` when at least 8 active drivers on eliminated teams exist to fill the points positions behind a
  one-two. When `false` the numbers are an estimate and should say so.
- `pointsNeeded`: highest other team's points minus this team's points plus 1, at least 0. `null` when eliminated.
- `difficulty`: `pointsNeeded` divided by what the team can still score, from 0 to 1. `null` when eliminated.
- `minOneTwos`: the fewest one-twos (both cars P1 and P2) in the open sessions, races first and then sprints, with P2
  and P3 in the rest, if every rival scores nothing. `null` when eliminated.
- `rivalBudgets`: only while the team is not eliminated. If the team finishes 1-2 in every open session, each rival
  that is not eliminated may score at most `budget` more points. `paceLimit` is the first place of the best pair the
  rival may take in every session: `3` (P3-P4), `5`, `7`, `9`, or `11` for outside the points. `null` means the
  budget is negative: the team cannot be beaten this way. Rival budgets are independent of each other.
- `easiest`: the `minOneTwos` scenario, merged with the active scenario, ready to load into the sandbox. `null` when
  eliminated.

**Errors:** HTTP 404 `{ "error": "not_found", ... }` for an unknown team id; HTTP 503 like the other routes.

---

### 8. `GET /api/feed/grid`

Returns the starting grid of the **next race** that is in use: the manual grid when one is saved, otherwise the data
file's grid (`openf1` or the qualifying order). This is the same grid the "Race" tab and the title odds use. It always
shows the grid source, because a qualifying order may differ from the real grid (it ignores grid penalties and pit-lane
starts).

**Example Response** (shortened):
```json
{
  "updated_at": "2026-10-07T02:06:22Z",
  "as_of_round": 16,
  "data_status": "ok",
  "season": 2026,
  "available": true,
  "round": 17,
  "source": "openf1",
  "rows": [
    { "position": 1, "driver": "VER", "name": "Max Verstappen", "team": "red_bull", "pit": false, "source": "openf1" },
    { "position": 2, "driver": "NOR", "name": "Lando Norris", "team": "mclaren", "pit": false, "source": "openf1" },
    { "position": 3, "driver": "HAD", "name": "Isack Hadjar", "team": "red_bull", "pit": false, "source": "openf1" }
  ],
  "p1_position": 1,
  "p1_driver": "VER",
  "p1_name": "Max Verstappen",
  "p1_team": "red_bull",
  "p1_pit": false,
  "p1_source": "openf1",
  "p2_position": 2,
  "p2_driver": "NOR"
}
```

**Fields**

- `round`: the round of the race this grid is for (the next scheduled race).
- `source`: where the grid comes from: `"manual"` (saved by the owner), `"openf1"` (the actual grid) or `"qualifying"`
  (the qualifying order, which may differ from the real grid). Every row has the same `source`.
- Rows, pole first: `position` (1-based; pit-lane starters come after everyone else), `driver` (code), `name`, `team`
  (constructor id), `pit` (`true` only for a manual grid's pit-lane starters), `source`.
- A data-file grid does not say who started from the pit lane, so those drivers are listed by place with `pit: false`.
  A manual grid does know: its pit-lane starters are at the end with `pit: true`.
- Flattened fields for places 1 to 22: `p1_*` to `p22_*`, one per row field (for example `p1_driver`, `p2_team`,
  `p3_pit`, `p22_position`). A place with no driver is empty (`""`, `0`, `false`) rather than missing.

**No grid:** HTTP 200 with the usual metadata and `{ "available": false }`; no `rows`, `source` or `p*_` fields. There is
nothing to show yet (qualifying has not run and no manual grid was saved), or the season is over.

**Errors:** HTTP 503 with `error` and `message` when the season data is missing or invalid, like the other routes.

---

### 9. `GET /api/feed/race-forecast`

Returns the model's forecast for the next race, from the effective grid of `/api/feed/grid`: per driver the chance to
win, to finish on the podium and in the points, and the expected finish. It is a **model estimate**, not a fact: show
`label` next to the numbers. It is the same calculation as the "Race" tab in the web app and does **not** use the active
scenario.

**Example Response** (shortened):
```json
{
  "updated_at": "2026-10-07T02:06:22Z",
  "as_of_round": 16,
  "data_status": "ok",
  "season": 2026,
  "available": true,
  "model": "estimate",
  "label": "Model estimate",
  "round": 17,
  "source": "openf1",
  "n_sims": 10000,
  "rows": [
    {
      "rank": 1,
      "driver": "VER",
      "name": "Max Verstappen",
      "team": "red_bull",
      "grid": 1,
      "win_display": "31%",
      "podium_display": "72%",
      "points_display": "96%",
      "mean_position": 2.31,
      "source": "openf1"
    },
    {
      "rank": 2,
      "driver": "NOR",
      "name": "Lando Norris",
      "team": "mclaren",
      "grid": 2,
      "win_display": "24%",
      "podium_display": "65%",
      "points_display": "94%",
      "mean_position": 2.78,
      "source": "openf1"
    }
  ],
  "top1_rank": 1,
  "top1_driver": "VER",
  "top1_grid": 1,
  "top1_win_display": "31%",
  "top2_driver": "NOR"
}
```

**Fields**

- `available`, `model`, `label`: always `true`, `"estimate"` and `"Model estimate"`.
- `round`: the round of the race this forecast is for. `source`: the grid source, as in `/api/feed/grid` (`"manual"`,
  `"openf1"` or `"qualifying"`). `n_sims`: the number of simulated races.
- Rows are the drivers still racing, sorted by the chance to win, best first. Row fields: `rank`, `driver` (code),
  `name`, `team` (constructor id), `grid` (the starting place the model used), `win_display`, `podium_display`,
  `points_display`, `mean_position`, `source`.
- **`*_display` are the texts to show.** They follow the same rules as `/api/feed/odds`: `"<1%"` below 1%, one decimal
  from 1% to under 10%, a whole percent from 10% to 99%, and `">99%"` above. They are never `"0%"` or `"100%"`.
- `mean_position` is the average finishing place, to two decimals; a retirement counts as the last place. It is the raw
  number, so format it as you wish (`"3.4"` for one decimal, as the web app shows it).
- Flattened fields for places 1 to 10: `top1_*` to `top10_*`, one per row field (for example `top1_driver`,
  `top1_win_display`, `top2_grid`, `top10_mean_position`). A place with no row is empty (`""`, `0`) rather than missing.
- The points chance and the expected finish are newer than the title odds' backtest; the model is fitted for the front
  of the field, so the middle and the back of the grid read too well. See `docs/MODEL.md` ("The race forecast's points
  chance and expected finish"). The win and podium numbers are the long-standing ones.

**Caching:** the result is kept per season file version (which changes when the manual grid changes) and model
parameters, so polling does not simulate again. The response header `X-Forecast-Cache` is `hit` when nothing had to be
simulated and `miss` otherwise.

**No grid:** HTTP 200 with the usual metadata and `{ "available": false }`; no `rows`, `label` or `top*_` fields. There is
nothing to forecast until a grid is known.

**Errors:** HTTP 503 with `error` and `message` when the season data is missing or invalid, like the other routes.

---

## LiveOverlay Binding Guide

To bind fields from To the Flag into LiveOverlay Studio:

1. In LiveOverlay Studio, open **API Binding Settings**.
2. Add a new HTTP GET Binding pointing to your target feed URL, e.g., `http://127.0.0.1:3100/api/feed/active-scenario`.
3. Set the polling interval (recommended: `1000ms` or on-demand).
4. In your overlay widget template, map text elements directly using flattened keys:
   - Leader driver code: `top1_driver` or `top1_wdc_driver`
   - Leader points: `top1_points` or `top1_wdc_points`
   - Leader team: `top1_wcc_team`
   - Active Scenario name: `scenario.name`
5. For the constructors' title, bind `/api/feed/team-status`:
   - Leader team: `top1_team` (id) and `top1_name`
   - Leader status: `top1_status`
   - Second place: `top2_team`, `top2_points`, `top2_gap_to_leader`
   - Highest place still possible for the third team: `top3_best` (`1` = still in the title fight; show it as `P` plus the
     number if you want the same text as the web app)
6. For the drivers' title status, bind `/api/feed/status` and use `top1_status`, `top1_best` and so on the same way.
7. For the race weekend's starting grid, bind `/api/feed/grid`:
   - Pole: `p1_driver`, `p1_name`, `p1_team`
   - Second place: `p2_driver`, `p2_name`
   - Grid source: `source` (`manual`, `openf1` or `qualifying`); show it, and label a qualifying grid as possibly
     different from the real grid
   - `available` tells you whether a grid is known yet; when it is `false`, hide the grid widget
8. For the race forecast, bind `/api/feed/race-forecast`:
   - Favourite: `top1_driver`, `top1_name`, `top1_win_display`, `top1_grid`
   - Second and third: `top2_driver`, `top3_driver` and their `*_win_display` / `*_podium_display`
   - Label: `label` (`"Model estimate"`); grid source: `source`; simulations: `n_sims`
   - `available` tells you whether a grid (and so a forecast) exists yet