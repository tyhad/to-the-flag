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
