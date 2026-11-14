/**
 * The starting-grid card (Phase 8, Step 7): the grid drawn like a real one. Pure: drawing commands in, nothing else.
 * It is drawn by the same canvas renderer as the standings card (`web/exportCard.ts`), with the same theme tokens.
 *
 *   - Two columns, pole at the top (the front of the grid): odd places on the left, even places on the right. The
 *     right-hand car starts half a row behind its neighbour, as on the track, so P1 is the furthest forward, P2 is on
 *     the front row but a little back, P3 is on the second row, and so on.
 *   - Each place is a box marked on the track: the line across the front and the two sides, open at the back.
 *   - Only the driver code is written in a box (no names), with the place and the team color.
 *   - The pit-lane starters are in their own small block, not on the grid.
 *   - A part of the grid (P6 to P15) is drawn with the places where they belong: odd left, even right.
 *   - Nothing leaves the canvas: the rows scale to the space there is, and long text is shortened.
 */
import { gridTag } from "./grid";
import { formatGridRange, type GridCardRow, type GridCardView } from "./gridExport";
import { buildCreditCommand, type CardSize, type DrawCommand } from "./card";
import { teamColor } from "../theme/teams";

export interface SlotRect {
  position: number;
  code: string;
  teamId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GridCardLayout {
  width: number;
  height: number;
  /** The card panel. */
  panel: Rect;
  /** The places on the grid, pole first. */
  grid: SlotRect[];
  /** The pit-lane starters. */
  pit: SlotRect[];
  /** The track strip behind the grid slots, or null when no place of the grid is shown. */
  track: Rect | null;
  /** Where the pit-lane block starts (its label), or null when there are no pit-lane starters in view. */
  pitBlock: Rect | null;
  /** Where the credit line is. */
  creditY: number;
  /** The header lines, top to bottom. */
  header: HeaderLine[];
  /** The places that are drawn (all of them when there is no range). */
  visible: GridCardRow[];
}

export interface HeaderLine {
  text: string;
  x: number;
  y: number;
  font: string;
  fill: string;
}

/** The pieces of the card that are not data, word for word. */
export const GRID_CARD_TITLE = "Starting grid";
export const GRID_CARD_PIT_LABEL = "Pit lane";
export const GRID_CARD_EMPTY = "No grid positions in this range.";

/** One row of the grid is this tall (in slot heights) and the right-hand car starts this far behind (in row heights). */
const SLOT_RATIO = 0.78;
const STAGGER = 0.5;

function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : text.slice(0, maxLength - 1) + "…";
}

/** The places the card shows, in order. */
export function visibleGridRows(view: GridCardView): GridCardRow[] {
  const range = view.range;
  return view.rows.filter((r) => !range || (r.position >= range.from && r.position <= range.to)).sort((a, b) => a.position - b.position);
}

/** Where everything goes, for one size. The drawing is made from this, and so are the tests of "nothing overlaps". */
export function layoutGridCard(view: GridCardView, size: CardSize): GridCardLayout {
  const isWide = size === "wide";
  const width = isWide ? 1920 : 1080;
  const height = 1080;
  const margin = isWide ? 48 : 36;
  const panel: Rect = { x: margin, y: margin, w: width - margin * 2, h: height - margin * 2 };
  const leftX = margin + 32;
  const rightX = margin + panel.w - 32;
  const creditY = height - margin - 12;
  const bottom = creditY - 18;

  // ---- header
  const visible = visibleGridRows(view);
  const gridRows = visible.filter((r) => !r.pit);
  const pitRows = visible.filter((r) => r.pit);
  const tag = gridTag(view.source);
  const lines: { text: string; font: string; fill: string; step: number }[] = [
    { text: "Formula 1", font: isWide ? "700 44px var(--font-display)" : "700 34px var(--font-display)", fill: "var(--color-text)", step: isWide ? 50 : 40 },
    {
      text: `${GRID_CARD_TITLE} · Round ${view.round}`,
      font: isWide ? "600 32px var(--font-display)" : "600 26px var(--font-display)",
      fill: "var(--color-text)",
      step: isWide ? 40 : 32,
    },
  ];
  if (view.raceName) {
    lines.push({
      text: truncate(view.raceName, isWide ? 34 : 44),
      font: isWide ? "500 26px var(--font-ui)" : "500 20px var(--font-ui)",
      fill: "var(--color-text-2)",
      step: isWide ? 34 : 28,
    });
  }
  lines.push({
    text: tag.text,
    font: isWide ? "600 22px var(--font-ui)" : "600 17px var(--font-ui)",
    fill: tag.tone === "warn" ? "var(--color-yellow)" : "var(--color-text-2)",
    step: isWide ? 34 : 28,
  });
  if (view.range) {
    lines.push({
      text: `${formatGridRange(view.range)} of ${view.rows.length}`,
      font: isWide ? "600 22px var(--font-ui)" : "600 17px var(--font-ui)",
      fill: "var(--color-text-2)",
      step: isWide ? 34 : 28,
    });
  }
  let y = margin + (isWide ? 54 : 36);
  const header: HeaderLine[] = lines.map((line) => {
    const placed = { text: line.text, x: leftX, y, font: line.font, fill: line.fill };
    y += line.step;
    return placed;
  });
  const headerBottom = y - 8;

  // ---- the pit-lane block: below the grid on the square card, in the left column on the wide one
  let pitBlock: Rect | null = null;
  const pit: SlotRect[] = [];
  if (pitRows.length > 0) {
    const blockW = isWide ? 560 : rightX - leftX;
    const gap = 16;
    const minW = 150;
    const perLine = Math.max(1, Math.floor((blockW + gap) / (minW + gap)));
    const slotW = Math.min(220, (blockW - (perLine - 1) * gap) / Math.min(perLine, pitRows.length));
    const slotH = isWide ? 56 : 50;
    const lineCount = Math.ceil(pitRows.length / perLine);
    const labelH = 30;
    const blockH = labelH + lineCount * slotH + (lineCount - 1) * 12;
    pitBlock = { x: leftX, y: bottom - blockH, w: blockW, h: blockH };
    pitRows.forEach((row, i) => {
      const col = i % perLine;
      const line = Math.floor(i / perLine);
      pit.push({
        position: row.position,
        code: row.code,
        teamId: row.teamId,
        x: leftX + col * (slotW + gap),
        y: pitBlock!.y + labelH + line * (slotH + 12),
        w: slotW,
        h: slotH,
      });
    });
  }

  // ---- the grid: the area it may use, and the size of a row
  const area: Rect = isWide
    ? { x: leftX + 560 + 40, y: margin + 32, w: rightX - (leftX + 560 + 40), h: bottom - (margin + 32) }
    : { x: leftX, y: headerBottom + 8, w: rightX - leftX, h: (pitBlock ? pitBlock.y - 14 : bottom) - (headerBottom + 8) };

  const grid: SlotRect[] = [];
  let track: Rect | null = null;
  if (gridRows.length > 0) {
    const firstRow = Math.ceil(gridRows[0]!.position / 2);
    // Offsets in rows: the row index, plus half a row for the right-hand column.
    const units = gridRows.map((r) => ({ r, top: Math.ceil(r.position / 2) - firstRow + (r.position % 2 === 0 ? STAGGER : 0) }));
    const minTop = Math.min(...units.map((u) => u.top));
    const extent = Math.max(...units.map((u) => u.top + SLOT_RATIO)) - minTop;
    const trackPad = 20;
    // A short range gets bigger boxes, up to a limit, so a few places do not look lost on the card.
    const pitch = Math.min(isWide ? 124 : 108, (area.h - trackPad * 2) / extent);
    const slotH = SLOT_RATIO * pitch;
    const slotW = Math.max(
      120,
      Math.min(Math.round(pitch * 3.6), isWide ? 400 : 360, Math.floor((area.w - trackPad * 2 - 0.3 * pitch * 3.6) / 2)),
    );
    const colGap = Math.round(slotW * 0.3);
    const gridW = slotW * 2 + colGap;
    const gridH = extent * pitch;
    const gridX = area.x + (area.w - gridW) / 2;
    const gridY = area.y + (area.h - gridH) / 2;
    for (const { r, top } of units) {
      grid.push({
        position: r.position,
        code: r.code,
        teamId: r.teamId,
        x: Math.round(gridX + (r.position % 2 === 1 ? 0 : slotW + colGap)),
        y: Math.round(gridY + (top - minTop) * pitch),
        w: slotW,
        h: Math.round(slotH),
      });
    }
    track = { x: Math.round(gridX - trackPad), y: Math.round(gridY - trackPad), w: Math.round(gridW + trackPad * 2), h: Math.round(gridH + trackPad * 2) };
  }

  return { width, height, panel, grid, pit, track, pitBlock, creditY, header, visible };
}

/** One marked box with the place, the team color and the code. Open at the back: the front line and both sides. */
function slotCommands(slot: SlotRect, size: CardSize, pole: boolean): DrawCommand[] {
  const isWide = size === "wide";
  const lw = isWide ? 4 : 3;
  const stroke = pole ? "var(--color-text)" : "var(--color-text-3)";
  const half = lw / 2;
  const commands: DrawCommand[] = [
    { type: "line", x1: slot.x - half, y1: slot.y, x2: slot.x + slot.w + half, y2: slot.y, stroke, lineWidth: lw },
    { type: "line", x1: slot.x, y1: slot.y, x2: slot.x, y2: slot.y + slot.h, stroke, lineWidth: lw },
    { type: "line", x1: slot.x + slot.w, y1: slot.y, x2: slot.x + slot.w, y2: slot.y + slot.h, stroke, lineWidth: lw },
  ];
  const codeSize = Math.max(16, Math.min(50, Math.round(slot.h * 0.6)));
  const placeSize = Math.max(11, Math.min(22, Math.round(slot.h * 0.34)));
  const stripH = Math.round(slot.h * 0.56);
  const stripW = isWide ? 7 : 6;
  const stripX = slot.x + Math.round(slot.w * 0.06);
  const centerY = slot.y + Math.round(slot.h * 0.56);
  commands.push({
    type: "rect",
    x: stripX,
    y: slot.y + Math.round(slot.h * 0.2),
    width: stripW,
    height: stripH,
    fill: teamColor(slot.teamId),
    radius: 3,
  });
  commands.push({
    type: "text",
    text: String(slot.position),
    x: stripX + stripW + 12,
    y: centerY,
    font: `600 ${placeSize}px var(--font-ui)`,
    fill: "var(--color-text-2)",
    align: "left",
    baseline: "middle",
  });
  commands.push({
    type: "text",
    text: slot.code,
    x: slot.x + slot.w - Math.round(slot.w * 0.08),
    y: centerY,
    font: `700 ${codeSize}px var(--font-display)`,
    fill: "var(--color-text)",
    align: "right",
    baseline: "middle",
  });
  return commands;
}

/** The starting-grid card as drawing commands, for the square (1080×1080) or the wide (1920×1080) picture. */
export function buildGridCard(view: GridCardView, size: CardSize): DrawCommand[] {
  const layout = layoutGridCard(view, size);
  const isWide = size === "wide";
  const commands: DrawCommand[] = [];

  commands.push({ type: "rect", x: 0, y: 0, width: layout.width, height: layout.height, fill: "var(--color-s0)" });
  commands.push({ type: "rect", x: layout.panel.x, y: layout.panel.y, width: layout.panel.w, height: layout.panel.h, fill: "var(--color-s1)", radius: 12 });

  for (const line of layout.header) {
    commands.push({ type: "text", text: line.text, x: line.x, y: line.y, font: line.font, fill: line.fill, align: "left", baseline: "middle" });
  }

  if (layout.track) {
    commands.push({ type: "rect", x: layout.track.x, y: layout.track.y, width: layout.track.w, height: layout.track.h, fill: "var(--color-s0)", radius: 10 });
  }
  for (const slot of layout.grid) commands.push(...slotCommands(slot, size, slot.position === 1));

  if (layout.visible.length === 0) {
    commands.push({
      type: "text",
      text: GRID_CARD_EMPTY,
      x: layout.width / 2,
      y: layout.height / 2,
      font: isWide ? "500 28px var(--font-ui)" : "500 22px var(--font-ui)",
      fill: "var(--color-text-2)",
      align: "center",
      baseline: "middle",
    });
  }

  if (layout.pitBlock) {
    commands.push({
      type: "text",
      text: GRID_CARD_PIT_LABEL,
      x: layout.pitBlock.x,
      y: layout.pitBlock.y + 12,
      font: isWide ? "600 22px var(--font-ui)" : "600 18px var(--font-ui)",
      fill: "var(--color-text-2)",
      align: "left",
      baseline: "middle",
    });
    for (const slot of layout.pit) commands.push(...slotCommands(slot, size, false));
  }

  commands.push(buildCreditCommand(layout.width / 2, layout.creditY));
  return commands;
}
