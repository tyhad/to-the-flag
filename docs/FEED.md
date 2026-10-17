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
      "pointsToClinch": 100
    },
    {
      "driver": "RUS",
      "status": "alive",
      "points": 236,
      "maxPossible": 419,
      "gapToLeader": 84,
      "pointsToClinch": null
    }
  ],
  "top1_driver": "ANT",
  "top1_status": "alive",
  "top1_points": 320,
  "top1_maxPossible": 503,
  "top1_gapToLeader": 0,
  "top1_pointsToClinch": 100,
  "top2_driver": "RUS",
  "top2_status": "alive",
  "top2_points": 236,
  "top2_maxPossible": 419,
  "top2_gapToLeader": 84,
  "top2_pointsToClinch": null
}
```

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
      "points_to_clinch": 166
    },
    {
      "rank": 2,
      "team": "ferrari",
      "name": "Ferrari",
      "points": 405,
      "status": "alive",
      "max_possible": 721,
      "gap_to_leader": 151,
      "points_to_clinch": 468
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
  "top2_rank": 2,
  "top2_team": "ferrari"
}
```

**Fields**

- `scenario`: `{ id, name }` of the active scenario, or `null`.
- Row fields use snake_case: `rank`, `team` (constructor id), `name`, `points` (including the scenario's locked
  sessions), `status`, `max_possible` (points if the team's two cars finished 1-2 in every open session; a team with one
  active car can only score for P1), `gap_to_leader`, and `points_to_clinch`.
- `points_to_clinch` is `0` when clinched and `null` when eliminated. Otherwise it is the points the team must hold to be
  safe against every rival scoring the maximum from here (conservative).
- A team with no active driver is always `eliminated`.
- Flattened fields for places 1 to 10: `top1_*` to `top10_*`, one per row field (for example `top2_team`,
  `top2_status`, `top2_points_to_clinch`). A place with no team is empty (`""`, `0`, `null` for `points_to_clinch`)
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
