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

Returns championship odds state (disabled placeholder until Phase 3 Monte Carlo simulation).

**Example Response:**
```json
{
  "updated_at": "2026-10-07T02:06:22Z",
  "as_of_round": 16,
  "data_status": "ok",
  "season": 2026,
  "available": false
}
```

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
