# Phase 6: Access and ops (LAN mode, write token, refresh, new-data notice, PNG export)

Branch: `phase-6-access`. One commit per step. Tests first wherever there is logic. Read `README.md` (Configuration), `docs/FEED.md`, `docs/PHASE_2.md` (server, feed, UI), `DESIGN.md`, and `AGENTS.md`.

**Goal:** use the tool from a phone or a second PC on the home network without opening it to everyone, update the data with one command, notice new data while the page is open, and export a picture of the table.
**Not in Phase 6:** accounts or logins, HTTPS or exposure to the internet, a token for reading the feed, multi-season prior (Phase 7), changes to the model.

## Decisions (all approved)

| # | Decision | Recommendation |
|---|---|---|
| D37 | Access policy | **Reading is open** (the UI, `/api/season`, `/api/health`, the whole feed), so LiveOverlay can poll from another PC. **Writing needs a token** (`TTF_WRITE_TOKEN`) whenever the server can be reached beyond this computer. Without a token, writes are allowed only from this computer. The server **refuses to start** if `HOST` is not loopback and no token is set. No CORS headers, ever. **Approved.** |
| D38 | Token in the browser | Kept for the browser session by default; a "Remember on this device" box keeps it longer. It is never put in a URL or a share link. **Approved.** |
| D39 | Refreshing data | A script the owner runs (`bun run refresh`), not automatic. The open page shows a "New data" notice and lets the owner reload; it never reloads by itself (no surprises on stream). **Approved.** |
| D40 | PNG export | Drawn on a canvas from a pure layout, in two sizes (square 1080×1080 and wide 1920×1080), with the "Model estimate" and "as of Round N" labels whenever odds are shown. **Approved.** |
| D41 | F1GStats debug output | Hidden by default; `--verbose` brings it back (a small change in the F1GStats repo). **Approved.** |

## What exists (verified on a fresh clone of `main` @ `8df077f`)

- 1304 tests pass, 2 skipped, 0 fail; typecheck clean; build OK. The WCC solver reproduces the Phase 5 sanity numbers on the Round 16 fixture (Mercedes 556, Ferrari needs 152, McLaren 241, Red Bull 259 with 2 one-twos; every team can still score 316).
- `config.ts` has `HOST` (default `127.0.0.1`) and `PORT` (3100). `README.md` says "Keep it local: there is no login."
- `api/server.ts` has no CORS and no auth. Write routes: `POST /api/scenarios`, `PUT` and `DELETE /api/scenarios/:id`, `PUT /api/active-scenario` (`api/routes/scenarios.ts`). Everything else is read-only.
- `web/scenarioApi.ts` calls the API with relative URLs and no auth header.
- `web/useHealth.ts` reads `/api/health` **once**: an open page never learns about new data.
- There is no `start` script (only `dev`), no refresh script, and no image export.

## Layout added in this phase

```
api/        access.ts  (policy, pure)   guard.ts  (Elysia plugin)   banner.ts  (startup text)
scripts/    refresh.ts
web/        useAccess.ts  useFreshness.ts  components/TokenDialog.tsx  components/NewDataNotice.tsx
            viewModel/access.ts  viewModel/freshness.ts  viewModel/card.ts  exportCard.ts
```

Rules that still apply: `engine/` stays pure and untouched; the web UI makes no external requests; tests do not depend on the live database or on the network.

## Steps

Steps 5 to 8 do not depend on Steps 1 to 4. If a second device is not needed yet, they can be done first.

### Step 1: Access policy (pure)

**Goal:** one function decides who may write.

**Change (`api/access.ts`, no I/O):**
- `isLoopbackAddress(ip)`: true for `127.0.0.0/8`, `::1`, `::ffff:127.x.x.x`; false for anything else, including `null`.
- `isLoopbackHost(host)`: true for `127.0.0.1`, `::1`, `localhost`; `0.0.0.0`, `::` and LAN addresses are not loopback.
- `checkStartup({ host, token })`: an error message when `host` is not loopback and `token` is empty or shorter than 16 characters; otherwise null. The message says what to do ("Set TTF_WRITE_TOKEN to a long random value, or keep HOST=127.0.0.1").
- `decideWrite({ token, clientIp, presented })` returns `"allow"`, `"deny-token"` (a token is configured and `presented` is missing or wrong) or `"deny-remote"` (no token configured and the client is not on this computer). Compare tokens in constant time.

**Tests first:** a truth table over token set or not, loopback or remote client, presented token missing, wrong, right; loopback address forms; startup check for each host type and short tokens; constant-time compare (equal-length and different-length inputs).

**Commit:** `feat(api): write access policy`

### Step 2: Enforce it on the write routes

**Goal:** the policy guards every write, and nothing else changes.

**Change (`api/guard.ts`, an Elysia plugin used by `createScenarioRoutes`):** for `POST`, `PUT` and `DELETE`:
- `401` with `{ error: "token_required" }` when the token is missing or wrong; `403` with `{ error: "local_only" }` for a remote client when no token is configured.
- `415` unless the body is JSON.
- `403` when an `Origin` header is present and does not match the server's own origin (stops a web page on another site from writing).
- After 5 failed attempts from one address within a minute: `429` with a plain message for the next minute (in memory).
- Messages are plain words (what failed, what to do). No CORS headers are added anywhere.
- `ServerOptions` gets an injectable `clientIp(request)` (and the token) so tests do not need a real socket; the real one reads `server.requestIP(request)`.

**Tests first (through `app.handle`):** each outcome above; reads stay open with and without a token; the rate limit counts failures per address and resets; a token never appears in a response or a log line.

**Commit:** `feat(api): guard the write routes`

### Step 3: Config, access endpoint, startup banner

**Goal:** a safe way to turn LAN mode on, and a way for the UI to know.

**Change:**
- `config.ts` adds `TTF_WRITE_TOKEN` (empty by default); `.env.example` and `README.md` (Configuration) describe it and the LAN steps.
- The server calls `checkStartup` and exits with the message and a non-zero code when it fails.
- `api/banner.ts` builds the startup text: the local URL, the LAN URLs (from `os.networkInterfaces()`, IPv4 only), and either "Writing: needs the token" or "Writing: this computer only". Print it from `server.ts`.
- `GET /api/access` returns `{ writeRequiresToken: boolean, canWrite: boolean }`; `canWrite` is the decision for this request, using the token it presents.
- `README.md`: a short LAN section (set `HOST=0.0.0.0` and a token, allow the port in the Windows firewall when asked, open `http://<this PC's address>:3100` on the phone), and a note that this is for a home network, not the internet.

**Tests first:** the banner text for loopback and LAN hosts (inject the interface list); `/api/access` for each case; `server.ts` refuses to start with `HOST=0.0.0.0` and no token (test the function, not the process).

**Commit:** `feat(api): LAN mode, access endpoint and startup banner`

### Step 4: Token in the UI

**Goal:** a phone can save scenarios once it has the token.

**Change:**
- `web/useAccess.ts` reads `/api/access`; `web/viewModel/access.ts` (pure) decides the state: `open` (writing works), `needs-token`, `local-only` (this device cannot write), `error`.
- When writing needs a token and none works: a small notice "Read-only. Enter the write token to save or share scenarios." with a button that opens `web/components/TokenDialog.tsx` (14px text, focus moves in, Escape closes, visible focus, an error line in plain words, a "Remember on this device" box). The write controls (save, delete, "Show on overlay") are disabled in the meantime and say why.
- `web/scenarioApi.ts` sends the token as `Authorization: Bearer …` when it has one; a `401` reopens the dialog.
- Storage: the token goes to `sessionStorage`; with the box ticked it goes to `localStorage`. Wrap every access in try/catch. It is never added to a URL, a share link, or an exported image.

**Tests first (view-model and storage logic):** the state for each `/api/access` answer; the token is stored in the right place and cleared on request; a share link never contains it.

**Check:** with a token set, open the page from a second device: it loads read-only, saving fails with the dialog, and after entering the token saving works; with a wrong token the dialog says so.

**Commit:** `feat(web): write token dialog and read-only state`

### Step 5: `start` and `refresh`

**Goal:** the two commands the owner types on race day.

**Change:**
- `package.json` gets `start` (`bun api/server.ts`, serving the built `dist/`) and `refresh`.
- `scripts/refresh.ts`: runs the F1GStats fetch and reports the result in plain words.
  - Settings from env: `F1GSTATS_DIR` (default `../F1GStats`), `F1GSTATS_PY` (default `py` on Windows, `python3` elsewhere), the season from `--season` or from `meta.season` in the existing database or else the current year, and the output path from `F1GSTATS_DB`.
  - Exit code 0 means data was written (say "ok" or "ok with warnings"); 2 means the data check failed and the last valid data stays (say so, and suggest trying again in a few minutes, because the API often lags after a race); 1 means an unexpected error. The script exits with the same meaning.
  - A pure part builds the command and interprets the exit code; the spawn is injected so tests do not run Python.

**Tests first:** the command for Windows and for other systems; season resolution; the message and exit code for 0, 2 and 1; a missing F1GStats folder gives a clear message.

**Commit:** `feat(scripts): start and refresh`

### Step 6: "New data" notice

**Goal:** an open page tells the owner when fresh data is ready.

**Change:**
- `web/useFreshness.ts` polls `/api/health` every 60 seconds while the tab is visible (and once when it becomes visible again), comparing `checkedAt` and `asOfRound` with what the page loaded.
- `web/viewModel/freshness.ts` (pure): `none | new-data` plus the copy "New data from Round N is ready." and a "Reload" button in `web/components/NewDataNotice.tsx`. It never reloads by itself, and it does not appear while the owner is in the middle of editing a lock (it waits until the picker is closed).
- A failed poll is ignored (the existing error states cover a real outage).

**Tests first (view-model):** same data gives no notice; a newer `checkedAt` or round gives the notice; the editing case; the copy.

**Commit:** `feat(web): new data notice`

### Step 7: PNG export

**Goal:** a picture of the table for posts and stream.

**Change:**
- `web/viewModel/card.ts` (pure): `buildCard(view, size)` returns a list of drawing commands (text, bars, team strips) for the standings card: title "To the Flag", season and "as of Round N", the scenario name, the top rows of the WDC table (rank, code, `current → projected`, delta, status) and, when the "Likely?" tab has odds, their `display` values with "Model estimate". Sizes: square 1080×1080 and wide 1920×1080. Long text is shortened, nothing is drawn outside the card, and numerals are right-aligned.
- `web/exportCard.ts` draws the commands on a canvas using the page's loaded fonts, reading colors from the theme variables (no raw hex), and downloads the PNG. A button "Export picture" with a size choice sits in the scenario strip. Team colors come from `teamColor(id)`.
- The share token, the write token and any server path never appear in the picture.

**Tests first (layout only; no pixels):** every command stays inside the card for both sizes; the row count and truncation; odds appear only when present and always with the "Model estimate" label; a pit-lane-style long driver name is truncated.

**Check:** export both sizes from the real data and look at them: readable at phone size, labels present, no overlap.

**Commit:** `feat(web): export the standings card as PNG`

### Step 8: F1GStats `--verbose` (in the F1GStats repo, branch `phase-6-verbose`)

**Goal:** a quiet normal run.

**Change:** the `[DEBUG]` lines (column lists and sample rows) print only with `--verbose`. Add the flag to `argparse`, a test that the default run prints no `[DEBUG]` and `--verbose` does, and a `CHANGELOG.md` and README note.

**Commit (F1GStats):** `feat: hide debug output unless --verbose`

### Step 9: Polish, docs, decisions

**Change:** keyboard walkthrough of the token dialog, the notice and the export button (focus order, Escape, visible focus); layout at 1920×1080 and 1280 wide, and on a phone-sized window; the `DESIGN.md` checklist (section 11); `README.md` (commands, LAN, refresh, export), `docs/FEED.md` (a LAN section: the feed is open on the network, writing is not), `SPEC.md` (phase table, decisions D37 to D41; mark the remaining "Proposed" decisions that were built as Decided), `AGENTS.md` status.

**Commit:** `chore: access and ops polish and docs`

## Phase 6 is done when

1. In a fresh clone without extra files, `bun test` and `bun run typecheck` pass, and `bun run build` works.
2. `HOST=0.0.0.0` without a token refuses to start with a clear message; with a token, the page loads from a second device, reading and the feed work, and writing works only with the token.
3. A wrong token, a missing token, a non-JSON body and a cross-site request are each rejected with a plain message; repeated wrong tokens are slowed down.
4. `bun run refresh` fetches new data and reports ok, ok with warnings, check failed, or error, with the matching exit code; `bun run start` serves the built UI.
5. An open page shows "New data from Round N is ready." after a refresh and never reloads by itself.
6. The PNG export works in both sizes, offline, with the right labels and no secrets in the picture.
7. The `DESIGN.md` checklist passes; `SPEC.md` and `AGENTS.md` are updated.

Then open a pull request `phase-6-access` → `main` and merge (and one for F1GStats).

## Known limits (deliberate)

- A home-network tool: no HTTPS, no login, no per-user rights. The token only separates "can look" from "can change". Do not expose the port to the internet.
- The feed is readable by anyone on the network. A feed token can be added later if the overlay can send one.
- The rate limit lives in memory and resets when the server restarts.
- The PNG shows what the page shows at that moment; it does not recompute anything.
