# Phase 10: Release V1.0

Branches: `phase-10-release` in **F1GStats** (Step 4, merged first) and in **to-the-flag** (Steps 1 to 3 and 5 to 8). One commit per step, tests first wherever there is logic, `git push -u origin <branch>` on the first push, pull request and `gh pr merge --merge --delete-branch`. Order of merging: F1GStats first, then to-the-flag. Read `AGENTS.md`, `SPEC.md` (D54 to D60) and `docs/PHASE_6.md` (the access rules) before anything else.

**Goal:** a first release another person can clone, run, trust and update: safe by default, credited, with a guide for the next season, and rehearsed on a real race weekend.
**Not in Phase 10:** the multi-season prior (Phase 11), peluang posisi selain P1 (D45), any model change (`MODEL_VERSION` stays `"v2"`), CI (D59), Docker, publishing to npm or PyPI, a login or HTTPS, and hosting on the public internet. V1.0 is for the owner's machine and a trusted LAN.

## Decisions

D54, D55, D56, D57, D58 and D60 are decided (see `SPEC.md`). D59 (CI) was dropped by the owner: this is a personal tool used on one machine, and every change is verified on a fresh clone before the merge.

| # | Decision | Recommendation |
|---|---|---|
| D54 | Release scope and order | The nine steps below. Both repos are released as `1.0.0`, tagged `v1.0.0` on the same day, after the rehearsal (Step 7) passes. `package.json` stays `"private": true` (no npm publishing). Step 1 goes first because the 2026 season ends soon (see Step 1). |
| D55 | License | Decided by the owner: no license. The repositories stay public, but no license is granted: the code can be read and forked on GitHub, and nobody else may reuse or redistribute it. The README says so in one line. A short `THIRD_PARTY.md` stays, because the Barlow fonts in the repository are under the SIL OFL 1.1, which asks that its text travels with the font files. |
| D56 | Data credit and trademark wording | Decided: a "Data and credits" section in both READMEs and a short line in the "How this works" note, with the text below. Each source has its own terms (a free API is not the same as free reuse of its data); the owner records what was checked in `docs/DATA_TERMS.md`. No F1 logo or font is used. |
| D57 | Host allowlist for write routes | Write routes (`POST`, `PUT`, `DELETE`) accept a request only when its `Host` is `localhost`, an IP literal (any IPv4 or IPv6 address), or a name listed in the new `TTF_ALLOWED_HOSTS`. Reads are not restricted. Reason: a DNS-rebinding page reaches the server through a hostname it controls, and it cannot send an IP literal as `Host`, so IP access from a phone keeps working with no setup and only named hosts (such as `mypc.local`) need listing. |
| D58 | Scenario export and import | One JSON file, `format` `"to-the-flag-scenarios"`, `version` 1, with name, season, as-of round, locks and contenders for each scenario: no ids, no timestamps, no token, no path, no grid. Import makes new ids, keeps only scenarios of the current season, skips invalid ones with a reason, renames duplicates ("Name (2)"), and is limited to 1 MB and 200 scenarios. Share links (`v1.` codec) are unchanged and stay the way to share one scenario. |
| D59 | CI | Dropped by the owner (not built). Revisit only if the project gets other users or contributors. |
| D60 | Edge states of a season | The app shows a defined state for a season with no race left ("Season complete") and for a season with no completed round ("Season not started"), and `docs/SEASON_ROLLOVER.md` says what to do between seasons. |

## Steps

### Step 1 (to-the-flag): Season edge states (D60)

**Why first:** the last rounds of 2026 are close (the date of the final race is in `schedule_full`), and after it the app has no next race. That state has to be correct before the last race weekend, not after.

**Define:** *complete* = no session left to run (every session of the schedule has a result). *Not started* = no round has a result.

**Check and fix, each with a test first** (build the two states from the Round 16 fixture with a helper in `tests/helpers.ts`; never re-export or edit `tests/fixtures/season-2026-r16.json`):
- Engine: standings, countback, title status, Path Solver (drivers and teams) and odds with zero sessions left (the champion is decided; the path says there is nothing left to play; odds are 100% and 0%), and with zero rounds done (all points 0, the model uses the prior only). No division by zero, no empty-list crash, no `NaN`.
- API and feed: `/api/season`, `/api/feed/*` and `/api/feed/odds` answer normally; `/api/feed/grid` says there is no next race; saved scenarios of a completed season open read-only.
- UI: a "Season complete" line in the header and in the Race tab ("No race left"), locks disabled with a one-line reason, "Possible?" shows the final result, "Likely?" shows the final odds, the PNG card says "Final" instead of "Round N" and has no simulation line. "Season not started" has its own plain line instead of empty tables.
- No strike-through, English text, same design tokens as the rest.

**Commit:** `fix: define the season complete and season not started states`

### Step 2 (to-the-flag): Host allowlist (D57)

**Change:** `config.ts` reads `TTF_ALLOWED_HOSTS` (comma-separated host names, no scheme, no port, no path; checked at start like the token, so an invalid entry stops the server with a clear message). `api/guard.ts` runs the host check first on write methods, before the rate limiter and the token, so a rejected host does not count as a failed attempt. A rejected request gets `403` with `{ "error": "forbidden_host", "message": ... }`.

**Tests first:**
- accepted: `127.0.0.1:3100`, `localhost`, `LOCALHOST:3100`, `[::1]:3100`, `192.168.1.20:3100`, a name in `TTF_ALLOWED_HOSTS` (case-insensitive, port ignored);
- rejected: `evil.example:3100`, `localhost.evil.example`, `127.0.0.1.evil.example`, a missing `Host`;
- reads with any `Host` are unchanged; the existing Origin, Content-Type, token and rate-limit tests still pass in their order;
- an invalid `TTF_ALLOWED_HOSTS` entry stops the start.

**Docs:** `.env.example`, the configuration table in the README, `docs/PHASE_6.md` access note.

**Commit:** `feat(api): host allowlist for the write routes`

### Step 3 (to-the-flag): Scenario export and import (D58)

**Change:** `GET /api/scenarios/export` (a read route; the file name is `to-the-flag-scenarios-{season}-r{round}.json`) and `POST /api/scenarios/import` (write-guarded, so it needs the token in LAN mode). The scenario strip gets an *Export scenarios* button and an *Import scenarios* button (file picker) that shows "Imported N, skipped M" with the reasons. Validation uses the existing scenario validation; ids in the file are ignored.

**Tests first:**
- a round trip (export, delete all, import) restores the same names, locks and contenders;
- a file of another season, an unknown `version`, an invalid lock, a wrong type, `__proto__` or `constructor` keys, more than 200 scenarios and a file over 1 MB are each refused or skipped with a reason, and never crash;
- duplicates are renamed; an imported scenario never overwrites an existing one;
- the file contains no token, server address, file path or timestamp.

**Docs:** `docs/EXPORT.md` (a new "Scenario file" section) and the README.

**Commit:** `feat: export and import scenarios`

### Step 4 (F1GStats): Credits (D55, D56)

**Change:** a one-line "No license" note, a "Data and credits" section in `README.md` (sources, the not-affiliated line, a link to the data terms). No version bump yet (Step 8).

**Check:** `pytest` still passes (94 tests).

**Commit:** `docs: add data credits and the no-license note`

### Step 5 (to-the-flag): Credits and notices (D55, D56)

**Change:** a one-line "No license" note in the README, `THIRD_PARTY.md` (each runtime dependency and the Barlow fonts with license names; the OFL text for the fonts), the "Data and credits" section, the line in "How this works", `docs/DATA_TERMS.md` (one row per source: terms link, date checked, what the owner concluded).

**Test first:** every name in `dependencies` of `package.json` appears in `THIRD_PARTY.md` (so the file cannot drift); the credits line is in the built UI; the PNG card code contains no logo or external request (extends the existing offline test).

**Owner:** fill `DATA_TERMS.md` before Step 8 (Jolpica publishes its Terms of Use and a rate limit of 500 requests an hour; OpenF1 offers historical data free and real-time data on a paid plan; FastF1 is a library with its own license and notes on the data it fetches). If a source's terms do not fit the intended use, stop and decide before the tag.

**Credits text (the same in both READMEs; the "How this works" note uses the first two sentences):**
```
## Data and credits

To the Flag is an unofficial fan project. It is not affiliated with, endorsed or sponsored by Formula 1, the FIA, Formula One Licensing B.V. or any team. F1, FORMULA 1 and related marks belong to their owners.

The data comes from third-party sources, each under its own terms:
- Jolpica F1 API (api.jolpi.ca), the community successor to the Ergast API: schedules, results and standings.
- FastF1, a Python library: session data.
- OpenF1: starting-grid information.

Check each source's terms before reusing its data.

## License

No license is granted. The source is public for reference; all rights are reserved.
```

**Commit:** `docs: add third-party notices, data credits and the no-license note`

### Step 6 (to-the-flag): Guides and screenshots

**Change:**
- `docs/SEASON_ROLLOVER.md` (D60): what to run when a new season starts (`fetch_f1_data.py --season N`, check `data_health` and `schema_version`); what to verify each year (the points table and sprint rule in `engine/points`, the constructor ids and colors in `web/theme/teams.ts`, new teams and renamed ones, driver codes); how to add the finished season to `F1GStats/history/` and when to rerun `bun run calibrate` (the model stays v2 until a new D30 run decides otherwise); what happens to saved scenarios and grid overrides of the old season; a short "if something looks wrong" list.
- README: screenshots in `docs/img/` (tower, "Possible?", "Likely?", Race tab, one exported card), each under 300 KB, taken by the owner, none showing a token, a path or an address. A quick start that has been run from a fresh clone on Windows `cmd` and by the assistant on a fresh Linux clone.

**Test first:** every link and image path in `README.md` and `docs/*.md` exists (a small test that scans them).

**Commit:** `docs: season rollover guide, screenshots and quick start check`

### Step 7 (both, owner): Rehearsal

**Do:** run a full race weekend (or the last rounds of 2026) with the release candidate and fill `docs/REHEARSAL.md`: date, round, and one line per item with pass or fail and a note.
1. `bun run refresh` with the real Python after a session; the new-data notice appears.
2. The grid: automatic, then a manual correction, then clear it (priority manual, OpenF1, qualifying).
3. The Race tab: forecast, the "indicative" note, the exports (PNG, CSV, JSON).
4. The standings card in both sizes; the overlay feed in LiveOverlay Studio (`/api/feed/*`, `/api/feed/odds`).
5. LAN: open from a phone by IP with the token (write works), then without the token (write is refused), then through a name not in `TTF_ALLOWED_HOSTS` (write is refused).
6. Scenario export, wipe, import.
7. The season-complete state on the last race (Step 1).
8. Running for a whole weekend without a restart: memory, the log, the database size.

Every fail becomes a fix with a test, in this branch, before Step 8. The OpenF1 404 cause is not a blocker (it is information now).

**Commit:** `docs: record the release rehearsal`

### Step 8 (both): Release

**Change:** `CHANGELOG.md` for to-the-flag (Keep a Changelog, a `[1.0.0]` entry that summarizes Phases 1 to 10 in a few lines per phase), F1GStats `CHANGELOG.md` `[Unreleased]` becomes `[1.0.0]`, `version` `1.0.0` in `package.json` and `pyproject.toml`, `SPEC.md` status, D54 to D60 to Done. Verify on a fresh clone of each: `bun install`, `bun test`, `bun run typecheck`, `bun run build`, `bun run start` with curl on `/api/health`, `/api/season` and the feed; `pytest` for F1GStats. Both `main` branches are clean and match `origin/main`.

**Tag (owner, after both are merged and green):**
```
git tag -a v1.0.0 -m "V1.0"
git push origin v1.0.0
gh release create v1.0.0 --title "V1.0" --notes-file <the CHANGELOG entry>
```

**Commit:** `chore: release 1.0.0`

### Step 9: Close

Update `SPEC.md` (Phase 10 done, Phase 11 next), `AGENTS.md`, and this file's "What this does not do" if the rehearsal changed anything.

**Commit:** `docs: close Phase 10`

## What this does not do

- It does not make the app safe for the public internet. There is no login, no HTTPS and no per-user data; the write token and the host allowlist protect a trusted LAN, nothing more.
- It does not change any number the model produces. The points chance and expected finish keep their "indicative" note (Phase 9, rejected).
- It does not give legal advice. Leaving the repositories without a license, the credits and the trademark wording are the owner's choices; the data terms are checked and recorded by the owner.
- The rehearsal (docs/REHEARSAL.md) did not cover LiveOverlay Studio, a real phone, or a non-Windows clone; the release rests on the checks listed there.