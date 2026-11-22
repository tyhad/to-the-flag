# The PNG cards (Export picture)

How the exported cards are built, the rules they follow, and the steps to add something new to them, so that new content looks and behaves like what is already there. There are four cards: the **standings card** (WDC or WCC, from the scenario strip), the **starting-grid card** (from the Race tab, Phase 8; see its section below), the **podium card** (also from the Race tab; see its section below) and the **weekend schedule card** (also from the Race tab; see its section below). Read this before changing `web/viewModel/card.ts`, `web/viewModel/cardView.ts`, `web/viewModel/gridCard.ts`, `web/viewModel/gridExport.ts`, `web/viewModel/podiumCard.ts`, `web/viewModel/scheduleCard.ts`, `web/exportCard.ts`, `web/exportText.ts` or the export controls in `web/components/ScenarioStrip.tsx`, `web/components/GridExport.tsx`, `web/components/PodiumExport.tsx` and `web/components/ScheduleExport.tsx`.

The standings card started in Phase 6 (`docs/PHASE_6.md`, Step 7, D40). Later work (WCC mode, row choice, custom range, simulation note, the Best and status columns of Phase 7) is described here as it is now.

## How it is built

```
page state ──▶ buildCardView()  ──▶ CardView ──▶ buildCard(view, size) ──▶ DrawCommand[] ──▶ exportCard() ──▶ PNG
(table view-model)  cardView.ts       (data)     card.ts (pure layout)       (shapes, text)    exportCard.ts (canvas)
```

| Piece | File | Job | Tested in |
|---|---|---|---|
| Assemble | `web/viewModel/cardView.ts` | Turns the live page state into a `CardView`. It reuses the table's rows (`buildTowerRows`), so the card shows the same numbers as the table. Pure. | `tests/cardView.test.ts` |
| Layout | `web/viewModel/card.ts` | `buildCard(view, size)` returns drawing commands (`rect`, `text`, `line`) with positions, fonts and colors. No DOM, no canvas. | `tests/card.test.ts` |
| Draw | `web/exportCard.ts` | Browser only. Resolves `var(--token)` from the page, draws the commands on a canvas, downloads the PNG. | by hand, in a browser |
| Controls | `web/components/ScenarioStrip.tsx` | Size, rows and custom range, and the Export picture button. | by hand, in a browser |

## What the card contains today

- **Sizes:** square 1080×1080 (margin 36) and wide 1920×1080 (margin 48). Every command must stay inside the canvas.
- **Header:** "Formula 1"; "Season N · Round N"; the table title (WDC or WCC); and, only when needed, a yellow line: "Simulation to Round N" when the scenario has locks, plus the scenario name when it is not "Base". "Model estimate" sits at the top right when odds are shown. When the season is complete, the line says "Season N · Final" instead of the round, there is no simulation line, and the top-right label is "Final" (the odds are exact, not an estimate).
- **Table:** whichever tab is open (WDC or WCC). Columns: `#`, driver or constructor (with the team strip), `POINTS` (current → projected), `+/-`, then `BEST` and `STATUS` only when the Title info choice shows them, then `ODDS` only when odds exist.
- **Rows:** Top 10, Top 12, All, or a custom range (from P to P). A custom range wins over the row choice. The row height scales to fill the card (minimum 28px) and the fonts scale with it.
- **Names:** drivers are "CODE · Given SURNAME" (`formatCardDriverName`); constructors use the team name; both are truncated, never allowed to overflow.
- **Credit line** at the bottom center: "to the flag by " in `text-3` and "Tyhad | F1 Watchalong" in `text` (brighter, weight 600). It is one centered line drawn as two colored runs (see "Colored pieces in one line" below).
- **File name:** `standings-[wcc-]{size}-{season}-r{round}.png`.

## Rules the cards follow (both)

1. **Layout stays pure.** `card.ts` and `cardView.ts` import no DOM or canvas. Anything visual that can be computed goes there and gets a test.
2. **Colors are tokens.** Write `var(--color-…)` in commands; `exportCard.ts` resolves them. No raw hex. Team colors come only from `teamColor()`.
3. **Same numbers as the table.** Never recompute standings, status or Best for the card; take them from the table view-model (`buildTowerRows`), so the UI, the card, `bun run check` and the feed agree.
4. **No strike-through** (the design-token test checks `web/`). "No title" is the text `✕ No title` in `text-3`, never red.
5. **Simulated numbers are labeled.** Odds always come with "Model estimate" and the as-of round. A scenario with locks is labeled as a simulation. The one exception is a complete season (no session left): the card says "Final" in both places and draws no simulation line.
6. **The Title info choice is followed.** When it hides the info, the Best and status columns are not drawn and nothing else moves in a way that leaves a gap.
7. **English UI text,** sentence case, plain words, like the rest of the app.
8. **Privacy and offline.** No token, server address, file path or external request ever appears in the image or the export code. Fonts are the bundled ones.
9. **Nothing may leave the canvas.** Truncate long text, scale rows, and keep the bounds test green for both sizes.

## Colored pieces in one line

A `text` command may carry `runs`: pieces with their own `fill` (and optional `font`). `text` must be the pieces joined, so anything reading `text` still sees the whole line. `align` and `x` apply to the whole line: `exportCard.ts` measures the pieces and starts at `runsStartX(align, x, totalWidth)`. Use this for a line that mixes colors; do not draw two separate commands and guess the widths.

## Adding new exportable content

Follow these steps in order, so the new content matches what exists:

1. **Data.** Add an optional field to `CardRow` (per row) or `CardView` (per card). Optional with a default that keeps today's picture unchanged, so existing tests and cards do not move.
2. **Assemble.** Fill it in `buildCardView` from the table view-model or the engine output the table already uses. If it needs a new input from the page (a new choice), add a parameter at the end of `buildCardView`, with a default.
3. **Layout.** Place it in `buildCard` for both sizes. A new column needs an x position per size, a header, a cell per row, and a rule for when it is hidden. A new header line moves `dividerY`; check the table still fits. Use tokens, scale fonts like the neighbours, and truncate text.
4. **Drawing.** If it needs a new kind of command, add it to `DrawCommand` and to `renderCommands` in `exportCard.ts`; keep `text` complete for text commands.
5. **Control.** If the owner chooses it, add the control in `ScenarioStrip.tsx` (an `aria-label`, keyboard operable, English label) and pass the choice through `handleExport` to `buildCardView`.
6. **Tests first.** In `tests/card.test.ts`: the new text or shapes exist, nothing leaves the canvas at both sizes, and the hidden case draws nothing. In `tests/cardView.test.ts`: the assembly, including defaults. Colors must pass `tests/design-tokens.test.ts`.
7. **Docs, in the same commit.** Update "What the card contains today" and the table above in this file, the *Export picture* list in `README.md`, and the file name rule here if it changes. If a rule above has to bend, change the rule here and tell the owner first.
8. **Browser check** (the pure layout cannot show this): export both sizes with WDC and WCC, Title info On, Off and Auto, odds on and off, a lock in the scenario, and a custom range. Look at the fit, the colors, the `✕` glyph, and the bottom credit line.

## The starting-grid card (Phase 8)

The same pipeline as the standings card, with its own data and layout: `buildGridCardView` (in `gridExport.ts`) makes a `GridCardView`, `buildGridCard` (in `gridCard.ts`) turns it into drawing commands, and `exportGridCard` (in `exportCard.ts`) draws them with the shared canvas renderer. `layoutGridCard` returns where every box goes; the drawing and the tests both use it.

| Piece | File | Job | Tested in |
|---|---|---|---|
| Rows, CSV, JSON, range, file names, card data | `web/viewModel/gridExport.ts` | The rows are the same as the overlay feed's (`api/gridFeed.ts`), and a test keeps them equal. | `tests/gridExport.test.ts` |
| Layout and drawing commands | `web/viewModel/gridCard.ts` | Pure. | `tests/gridCard.test.ts` |
| Controls | `web/components/GridExport.tsx` | Size, places, and the five buttons, at the end of the grid editor. | `tests/gridExportMarkup.test.tsx`; by hand in a browser |
| Copy and download | `web/exportText.ts` | Clipboard (with the older fallback for pages that are not https) and file download. | by hand in a browser |

- **Picture sizes:** square 1080×1080 and wide 1920×1080, like the standings card. The file name is `starting-grid-{size}-{season}-r{round}[-p{from}-p{to}].png`.
- **Look:** the grid is drawn like one on the track. Two columns, **pole at the top (the front)**: odd places on the left, even places on the right, and each right-hand car is half a row behind its neighbour, so P1 is furthest forward, P2 is on the front row but a little back, P3 is on the second row, and so on. Each place is a box marked on the track: the line across the front and the two sides, open at the back. Pole's box is drawn brighter. A box holds the place, the team color and **the driver code only** (no names).
- **Header:** "Formula 1", "Starting grid · Round N", the race name when the schedule has it, and where the grid comes from, with the same words as the grid tag: "Grid: manual", "Grid: OpenF1", and "Grid: qualifying (may differ from the real grid)" in the yellow timing color. The card never claims more than the data says.
- **Places:** All, Top 10, Top 12, or a custom range (P from, P to), like the standings card. A part of the grid keeps each place where it belongs (odd left, even right), and the header says "P6–P15 of 22". A range that has no places says so and draws no box. The range applies to the picture only: the CSV and JSON always have every place.
- **Pit-lane starters** are in their own small block with the label "Pit lane" (below the grid on the square card, in the left column on the wide one), never on the grid. Only a manual grid knows who they are.
- **The saved grid is exported**, not unsaved edits in the editor. The section says so while there are unsaved changes.
- **CSV** has `position,driver,name,team,pit,source`, quoted where needed; **JSON** is the same rows as an array. Nothing else goes into either: no token, path or note. Reading and exporting need no write token.
- **Credit line:** shared with the standings card through `buildCreditCommand`.
- **Rows scale to fit:** the box size follows the number of rows (with a limit, so a few places do not look lost), and nothing leaves the card at either size. The tests check 1, 3, 12, 20, 21 and 22 cars, the pit-lane block with up to eight starters, and ranges.

To add something to this card, follow "Adding new exportable content" above, with `GridCardView` / `GridCardRow` as the data, `layoutGridCard` and `buildGridCard` as the layout, and `GridExport.tsx` as the controls.

## The podium card

A small block at the end of the Race tab: choose *Prediction* or *Race result*, pick P1, P2 and P3 from the season's drivers, and export a 1080×1080 PNG. The picks start empty and are not saved (a reload clears them). Nothing here needs a write token.

| Piece | File | Job | Tested in |
|---|---|---|---|
| Data, layout, file name | `web/viewModel/podiumCard.ts` | Which race the picture is about, the pickers' drivers, the three steps and their text. Pure. | `tests/podiumCard.test.ts` |
| Controls | `web/components/PodiumExport.tsx` | Mode, the three pickers, the button and its note, at the end of `RacePanel.tsx`. | `tests/podiumExportMarkup.test.tsx`; by hand in a browser |
| Draw | `web/exportCard.ts` | `exportPodiumCard` uses the shared renderer. | by hand, in a browser |

- **Which race:** *Prediction* is the next round (`asOfRound + 1`); *Race result* is the last completed round (`asOfRound`). A finished season has no next round and a season before its first race has no result; that mode then says why and cannot export.
- **Sprint weekends:** `RoundInfo.hasSprint` adds "Sprint weekend" under the race name. It comes from the data, never a fixed list.
- **Look:** three steps on one base line: P2 left, P1 centre and tallest, P3 right and lowest. Each step has the team color strip, the place (`P1`), the driver code and the team name when the data has one (shortened if long). The credit line is the shared one.
- **The prediction is the owner's own**, not the model's, so the picture carries no "Model estimate" label. The top-right label is "Tyhad | F1 Watchalong's Prediction"; a result says "Race result".
- **File name:** `podium-prediction-2026-r17.png` / `podium-result-2026-r16.png`.
- **Not in the picture:** points, times, odds, or any other number. One size only, and always the next or the last race; an older race cannot be chosen.

## The weekend schedule card

At the end of the Race tab: choose *Current weekend* (`now`) or *Next weekend* (`next`) and export a 1080×1080 PNG (`schedule-{season}-r{round}.png`) showing every session in both circuit local time ("Track time") and WIB ("WIB time").

| Piece | File | Job | Tested in |
|---|---|---|---|
| Data, timezone, layout, file name | `web/viewModel/scheduleCard.ts` | Circuit IANA timezone lookup, `Intl.DateTimeFormat` dual-zone formatting, `1080×1080` layout. Pure. | `tests/scheduleCard.test.ts` |
| Controls | `web/components/ScheduleExport.tsx` | Current/Next selector, Export picture button and status line, at the end of `RacePanel.tsx`. | `tests/scheduleExportMarkup.test.tsx`; by hand in a browser |
| Draw | `web/exportCard.ts` | `exportScheduleCard` uses the shared renderer. | by hand, in a browser |

## Scenario file (Phase 10)

*Export scenarios* saves every saved scenario of the current season in one JSON file, and *Import scenarios* reads such a file back. It is a backup and a way to move scenarios to another computer. To share one scenario, use *Copy link* (the share link is unchanged).

- **File name:** `to-the-flag-scenarios-{season}-r{round}.json`, for example `to-the-flag-scenarios-2026-r16.json`. `GET /api/scenarios/export` is a read route, so it needs no token.
- **Shape:** `{ "format": "to-the-flag-scenarios", "version": 1, "scenarios": [ ... ] }`. Each scenario has `name`, `season`, `asOfRound`, `locks` and (when it has any) `contenders`. Nothing else: **no id, timestamp, token, server address, file path or starting grid.** `tests/scenarioFile.test.ts` and `tests/scenarioFileApi.test.ts` check this.
- **Import** is `POST /api/scenarios/import`, a write route: in LAN mode it needs the token, and the Host allowlist applies. The file is read as text and never trusted:
  - The whole file is refused (nothing is saved) when it is over 1 MB (413), is not JSON, has another `format`, has a `version` other than 1, has no list of scenarios, or has more than 200.
  - A single scenario is skipped, with a reason, when it is for another season, was made after the data's round, has no name or a name over 40 characters, has a lock that is not in the expected shape or that fails the ordinary save checks (unknown driver, a session that already has results, a position outside the points zone, and so on), has an unknown contender, or contains a `__proto__`, `constructor` or `prototype` key. One bad scenario never stops the others.
  - New ids are made on import; ids and times in the file are ignored. A scenario made at an earlier round of this season is kept (it shows as stale, like any saved scenario).
  - A name that is already saved, or repeated in the file, gets a number: "Name (2)", "Name (3)". An import never overwrites or merges with an existing scenario, and never changes the active overlay scenario.
- **What the page shows:** "Imported N, skipped M." and one line for each skipped or renamed scenario (the first eight, then a count). A refused file shows its reason in words. The page checks the 1 MB limit before sending.
- **Not covered by tests (check by eye):** the file picker and the browser's download of the file.

## Not covered by tests (check by eye)

The canvas drawing itself (`exportCard.ts`), the real font rendering, the clipboard and download (`exportText.ts`), and the controls. Say in the commit or the phase notes what was and was not checked in a browser.
