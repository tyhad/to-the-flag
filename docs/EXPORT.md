# The PNG card (Export picture)

How the exported standings card is built, the rules it follows, and the steps to add something new to it, so that new content looks and behaves like what is already there. Read this before changing `web/viewModel/card.ts`, `web/viewModel/cardView.ts`, `web/exportCard.ts` or the export controls in `web/components/ScenarioStrip.tsx`.

The card started in Phase 6 (`docs/PHASE_6.md`, Step 7, D40). Later work (WCC mode, row choice, custom range, simulation note, the Best and status columns of Phase 7) is described here as it is now.

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

## Rules the card follows

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

## Not covered by tests (check by eye)

The canvas drawing itself (`exportCard.ts`), the real font rendering, and the controls. Say in the commit or the phase notes what was and was not checked in a browser.
