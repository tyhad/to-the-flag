# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- Phase 11: the multi-season prior (the carryover) was evaluated under D64 and rejected; the engine
  parameters stay with a default of 0, so the app behaves as in 1.0.0 (`docs/MODEL.md`).

## [1.0.0] - 2026-11-18

First release. A personal, local-first what-if tool for F1 title fights: you set the results of the
sessions left and see the final tables, the paths to both titles and the model odds. No accounts, no
hosting; it runs on your machine and, with a write token, on a trusted LAN.

### Added

- Phase 1: the engine for both championships: points, countback, remaining points, and the Path
  Solver for drivers and teams.
- Phase 2: the web UI and the overlay feed (`/api/feed/*`); the table, status and path update while
  you type.
- Phase 3: the *Likely?* tab, the odds feed, a walk-forward backtest and the model card.
- Phase 4: model v2: history data, calibration and the grid signal.
- Phase 5: the Constructors' Path Solver, team feeds and a Constructors view.
- Phase 6: LAN mode with a write token, `bun run refresh`, the new-data notice and PNG export.
- Phase 7: the `✕ No title` marker, the *Best* column, the *Title info* control, best places in the
  CLI and the feed.
- Phase 8: a manual starting grid, the *Race* tab with the race forecast, and grid PNG, CSV and JSON
  export and feed.
- Phase 10: season edge states, the write-host allowlist, scenario export and import, third-party
  notices, the season rollover guide, README screenshots and a release rehearsal.

### Changed

- Phase 9: the points chance and expected finish keep their "indicative" note; model v3 was
  evaluated under D53 and rejected with numbers (`docs/MODEL.md`).

### Notes

- No license is granted; see the README. The data comes from third-party sources under their own
  terms (`docs/DATA_TERMS.md`).
