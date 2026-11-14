# The PNG cards (Export picture)

How the exported cards are built, the rules they follow, and the steps to add something new to them, so that new content looks and behaves like what is already there. There are two cards: the **standings card** (WDC or WCC, from the scenario strip) and the **starting-grid card** (from the Race tab, Phase 8; see the last section). Read this before changing `web/viewModel/card.ts`, `web/viewModel/cardView.ts`, `web/viewModel/gridCard.ts`, `web/viewModel/gridExport.ts`, `web/exportCard.ts`, `web/exportText.ts` or the export controls in `web/components/ScenarioStrip.tsx` and `web/components/GridExport.tsx`.

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
- **Header:** "Formula 1"; "Season N · Round N"; the table title (WDC or WCC); and, only when needed, a yellow line: "Simulation to Round N" when the scenario has locks, plus the scenario name when it is not "Base". "Model estimate" sits at the top right when odds are shown.
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
5. **Simulated numbers are labeled.** Odds always come with "Model estimate" and the as-of round. A scenario with locks is labeled as a simulation.
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

## Not covered by tests (check by eye)

The canvas drawing itself (`exportCard.ts`), the real font rendering, the clipboard and download (`exportText.ts`), and the controls. Say in the commit or the phase notes what was and was not checked in a browser.
