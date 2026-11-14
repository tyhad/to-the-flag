/**
 * Phase 8, Step 7: the starting-grid card (web/viewModel/gridCard.ts). Pure: layout and text only.
 * The drawing itself and the fonts need a browser; what is checked here is where things go and what is written.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { activeDrivers, type SeasonState } from "../engine";
import { gridTag, type GridSource } from "../web/viewModel/grid";
import type { DrawCommand } from "../web/viewModel/card";
import { GRID_CARD_EMPTY, GRID_CARD_PIT_LABEL, GRID_CARD_TITLE, buildGridCard, layoutGridCard, type Rect, type SlotRect } from "../web/viewModel/gridCard";
import { buildGridCardView, type GridCardView, type GridRange } from "../web/viewModel/gridExport";

type Size = "square" | "wide";
const SIZES: Size[] = ["square", "wide"];
const DIMENSIONS: Record<Size, { w: number; h: number }> = { square: { w: 1080, h: 1080 }, wide: { w: 1920, h: 1080 } };

/** n drivers with three-letter codes AAA, AAB, ..., in places 1..n; the last `pit` of them are pit-lane starters. */
function makeView(n: number, opts: { pit?: number; source?: GridSource; range?: GridRange | null; raceName?: string | null } = {}): GridCardView {
  const pit = opts.pit ?? 0;
  return {
    season: 2026,
    round: 17,
    raceName: opts.raceName === undefined ? "Singapore Grand Prix" : opts.raceName,
    source: opts.source ?? "openf1",
    range: opts.range ?? null,
    rows: Array.from({ length: n }, (_, i) => ({
      position: i + 1,
      code: String.fromCharCode(65 + Math.floor(i / 26), 65 + (i % 26), 65),
      teamId: ["red_bull", "ferrari", "mclaren", "mercedes", "williams", "alpine"][i % 6]!,
      pit: i >= n - pit,
    })),
  };
}

const texts = (commands: DrawCommand[]) => commands.filter((c): c is Extract<DrawCommand, { type: "text" }> => c.type === "text");
const textOf = (commands: DrawCommand[]) => texts(commands).map((t) => t.text);
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (inner: Rect, outer: Rect) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
const rectOf = (s: SlotRect): Rect => ({ x: s.x, y: s.y, w: s.w, h: s.h });
const slotOf = (layout: ReturnType<typeof layoutGridCard>, position: number) => [...layout.grid, ...layout.pit].find((s) => s.position === position)!;

describe.each(SIZES)("the layout, %s card", (size) => {
  const { w, h } = DIMENSIONS[size];
  const canvas: Rect = { x: 0, y: 0, w, h };

  test.each([22, 20, 12, 3, 1])("%d cars: every place is inside the card, and no two overlap", (n) => {
    const layout = layoutGridCard(makeView(n), size);
    const all = [...layout.grid, ...layout.pit];
    expect(all).toHaveLength(n);
    for (const slot of all) expect(inside(rectOf(slot), layout.panel)).toBe(true);
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(overlap(rectOf(all[i]!), rectOf(all[j]!))).toBe(false);
    expect(inside(layout.panel, canvas)).toBe(true);
  });

  test("the grid places are on the track strip, and the strip is inside the card", () => {
    const layout = layoutGridCard(makeView(22), size);
    expect(layout.track).not.toBeNull();
    for (const slot of layout.grid) expect(inside(rectOf(slot), layout.track!)).toBe(true);
    expect(inside(layout.track!, layout.panel)).toBe(true);
  });

  test("pole is the furthest forward, on the left", () => {
    const layout = layoutGridCard(makeView(22), size);
    const pole = slotOf(layout, 1);
    expect(Math.min(...layout.grid.map((s) => s.y))).toBe(pole.y);
    expect(Math.min(...layout.grid.map((s) => s.x))).toBe(pole.x);
  });

  test("P2 is on the front row, on the right, but a little further back than pole", () => {
    const layout = layoutGridCard(makeView(22), size);
    const [p1, p2, p3] = [1, 2, 3].map((p) => slotOf(layout, p));
    expect(p2!.x).toBeGreaterThan(p1!.x + p1!.w); // right of pole, with a gap
    expect(p2!.y).toBeGreaterThan(p1!.y); // further back than pole
    expect(p2!.y).toBeLessThan(p3!.y); // still ahead of the second row
    const pitch = p3!.y - p1!.y;
    expect(Math.abs(p2!.y - p1!.y - pitch / 2)).toBeLessThanOrEqual(1); // half a row back
  });

  test("odd places are one column and even places the other, row after row", () => {
    const layout = layoutGridCard(makeView(22), size);
    const left = layout.grid.filter((s) => s.position % 2 === 1);
    const right = layout.grid.filter((s) => s.position % 2 === 0);
    expect(new Set(left.map((s) => s.x)).size).toBe(1);
    expect(new Set(right.map((s) => s.x)).size).toBe(1);
    expect(left).toHaveLength(11);
    expect(right).toHaveLength(11);
  });

  test("the rows are evenly spaced, and every right-hand car is half a row behind the left-hand one of its row", () => {
    const layout = layoutGridCard(makeView(22), size);
    // The row spacing from the first and the last row, so the rounding of each box does not add up.
    const pitch = (slotOf(layout, 21).y - slotOf(layout, 1).y) / 10;
    for (let row = 0; row < 11; row++) {
      const left = slotOf(layout, row * 2 + 1);
      const right = slotOf(layout, row * 2 + 2);
      expect(Math.abs(left.y - (slotOf(layout, 1).y + row * pitch))).toBeLessThanOrEqual(1);
      expect(Math.abs(right.y - left.y - pitch / 2)).toBeLessThanOrEqual(1);
    }
  });

  test("an odd number of cars ends on a left-hand place alone, with its right-hand place empty", () => {
    const layout = layoutGridCard(makeView(21), size);
    expect(layout.grid).toHaveLength(21);
    const last = slotOf(layout, 21);
    expect(last.x).toBe(slotOf(layout, 1).x);
  });

  test("every box is wider than it is tall, and all boxes are the same size", () => {
    const layout = layoutGridCard(makeView(22), size);
    expect(new Set(layout.grid.map((s) => `${s.w}x${s.h}`)).size).toBe(1);
    expect(layout.grid[0]!.w).toBeGreaterThan(layout.grid[0]!.h * 2);
  });

  test("the layout does not change the view it was given", () => {
    const view = makeView(22, { pit: 2, range: { from: 3, to: 9 } });
    const before = JSON.stringify(view);
    layoutGridCard(view, size);
    buildGridCard(view, size);
    expect(JSON.stringify(view)).toBe(before);
  });
});

describe.each(SIZES)("the pit-lane block, %s card", (size) => {
  const { w, h } = DIMENSIONS[size];

  test("the pit-lane starters are not on the grid; they are in their own block, inside the card", () => {
    const layout = layoutGridCard(makeView(22, { pit: 2 }), size);
    expect(layout.grid).toHaveLength(20);
    expect(layout.pit.map((s) => s.position)).toEqual([21, 22]);
    expect(layout.pitBlock).not.toBeNull();
    for (const slot of layout.pit) {
      expect(inside(rectOf(slot), layout.panel)).toBe(true);
      expect(inside(rectOf(slot), { x: 0, y: 0, w, h })).toBe(true);
      expect(layout.track === null || !overlap(rectOf(slot), layout.track)).toBe(true);
    }
    for (const slot of layout.grid) for (const p of layout.pit) expect(overlap(rectOf(slot), rectOf(p))).toBe(false);
  });

  test("the pit-lane starters keep their order and their place numbers", () => {
    const layout = layoutGridCard(makeView(22, { pit: 3 }), size);
    expect(layout.pit.map((s) => s.position)).toEqual([20, 21, 22]);
    const row = layout.pit.filter((s) => s.y === layout.pit[0]!.y);
    expect(row.map((s) => s.x)).toEqual([...row.map((s) => s.x)].sort((a, b) => a - b));
  });

  test("many pit-lane starters wrap into lines, and still fit the card without overlapping", () => {
    const layout = layoutGridCard(makeView(22, { pit: 8 }), size);
    expect(layout.pit).toHaveLength(8);
    expect(new Set(layout.pit.map((s) => s.y)).size).toBeGreaterThan(1);
    for (const slot of layout.pit) expect(inside(rectOf(slot), layout.panel)).toBe(true);
    for (let i = 0; i < layout.pit.length; i++) for (let j = i + 1; j < layout.pit.length; j++) expect(overlap(rectOf(layout.pit[i]!), rectOf(layout.pit[j]!))).toBe(false);
    for (const g of layout.grid) for (const p of layout.pit) expect(overlap(rectOf(g), rectOf(p))).toBe(false);
  });

  test("no pit-lane starters: no block, no label", () => {
    const layout = layoutGridCard(makeView(22), size);
    expect(layout.pitBlock).toBeNull();
    expect(layout.pit).toEqual([]);
    expect(textOf(buildGridCard(makeView(22), size))).not.toContain(GRID_CARD_PIT_LABEL);
  });

  test("the block has its label", () => {
    expect(textOf(buildGridCard(makeView(22, { pit: 2 }), size))).toContain(GRID_CARD_PIT_LABEL);
  });
});

describe.each(SIZES)("a part of the grid, %s card", (size) => {
  test("only the chosen places are drawn, odd on the left and even on the right as on the full grid", () => {
    const layout = layoutGridCard(makeView(22, { range: { from: 6, to: 15 } }), size);
    expect(layout.grid.map((s) => s.position).sort((a, b) => a - b)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    const full = layoutGridCard(makeView(22), size);
    const leftX = slotOf(full, 1).x;
    for (const s of layout.grid) expect(s.x > leftX).toBe(s.position % 2 === 0);
  });

  test("the first place of the range is at the top, and the rows keep their order", () => {
    const layout = layoutGridCard(makeView(22, { range: { from: 6, to: 15 } }), size);
    const ys = [6, 7, 8, 9, 10].map((p) => slotOf(layout, p).y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(slotOf(layout, 6).y).toBeLessThan(slotOf(layout, 7).y); // P6 is half a row ahead of P7
  });

  test("everything is inside the card and nothing overlaps", () => {
    const layout = layoutGridCard(makeView(22, { range: { from: 6, to: 15 } }), size);
    for (const s of layout.grid) {
      expect(inside(rectOf(s), layout.panel)).toBe(true);
      expect(inside(rectOf(s), layout.track!)).toBe(true);
    }
    for (let i = 0; i < layout.grid.length; i++) for (let j = i + 1; j < layout.grid.length; j++) expect(overlap(rectOf(layout.grid[i]!), rectOf(layout.grid[j]!))).toBe(false);
  });

  test("a few places get bigger boxes than a full grid, so they do not look lost", () => {
    const few = layoutGridCard(makeView(22, { range: { from: 1, to: 4 } }), size);
    const all = layoutGridCard(makeView(22), size);
    expect(few.grid[0]!.h).toBeGreaterThan(all.grid[0]!.h);
  });

  test("a single place is drawn alone, in its own column", () => {
    const two = layoutGridCard(makeView(22, { range: { from: 2, to: 2 } }), size);
    expect(two.grid).toHaveLength(1);
    expect(two.grid[0]!.position).toBe(2);
    const full = layoutGridCard(makeView(22), size);
    expect(two.grid[0]!.x).toBeGreaterThan(slotOf(full, 1).x);
  });

  test("the card says which places and how many there are", () => {
    expect(textOf(buildGridCard(makeView(22, { range: { from: 6, to: 15 } }), size))).toContain("P6–P15 of 22");
    expect(textOf(buildGridCard(makeView(22), size)).some((t) => t.includes(" of 22"))).toBe(false);
  });

  test("a range that has no places says so, and draws no box", () => {
    const view = makeView(22, { range: { from: 40, to: 50 } });
    const commands = buildGridCard(view, size);
    expect(textOf(commands)).toContain(GRID_CARD_EMPTY);
    expect(layoutGridCard(view, size).grid).toEqual([]);
    expect(commands.filter((c) => c.type === "line")).toHaveLength(0);
  });

  test("a range that holds only pit-lane starters shows just the block", () => {
    const layout = layoutGridCard(makeView(22, { pit: 2, range: { from: 21, to: 22 } }), size);
    expect(layout.grid).toEqual([]);
    expect(layout.track).toBeNull();
    expect(layout.pit.map((s) => s.position)).toEqual([21, 22]);
  });
});

describe.each(SIZES)("what is written, %s card", (size) => {
  test("the title, the round, the race and where the grid comes from", () => {
    const t = textOf(buildGridCard(makeView(22), size));
    expect(t).toContain("Formula 1");
    expect(t).toContain(`${GRID_CARD_TITLE} · Round 17`);
    expect(t).toContain("Singapore Grand Prix");
    expect(t).toContain("Grid: OpenF1");
  });

  test("each box has the place and the driver code, and nothing else about the driver", () => {
    const view = makeView(22);
    const t = textOf(buildGridCard(view, size));
    for (const row of view.rows) {
      expect(t).toContain(row.code);
      expect(t).toContain(String(row.position));
    }
    // Every text on the card is one of: a code, a place number, a header line, the pit label, or the credit line.
    const header = new Set(["Formula 1", `${GRID_CARD_TITLE} · Round 17`, "Singapore Grand Prix", "Grid: OpenF1", "to the flag by Tyhad | F1 Watchalong"]);
    const codes = new Set(view.rows.map((r) => r.code));
    for (const text of t) expect(header.has(text) || codes.has(text) || /^\d+$/.test(text)).toBe(true);
  });

  test("a manual grid says manual", () => {
    expect(textOf(buildGridCard(makeView(22, { source: "manual" }), size))).toContain("Grid: manual");
  });

  test("a qualifying grid carries the warning words in the yellow timing color, so the card never claims more than the data", () => {
    const commands = buildGridCard(makeView(22, { source: "qualifying" }), size);
    const tag = texts(commands).find((c) => c.text === gridTag("qualifying").text)!;
    expect(tag.text).toContain("(may differ from the real grid)");
    expect(tag.fill).toBe("var(--color-yellow)");
  });

  test("manual and OpenF1 are not drawn in the warning color", () => {
    for (const source of ["manual", "openf1"] as const) {
      const tag = texts(buildGridCard(makeView(22, { source }), size)).find((c) => c.text === gridTag(source).text)!;
      expect(tag.fill).not.toBe("var(--color-yellow)");
    }
  });

  test("a long race name is shortened, and a missing one is left out", () => {
    const long = "The Very Long Name Of A Grand Prix That Would Never Fit On One Line Of This Card";
    const t = textOf(buildGridCard(makeView(22, { raceName: long }), size));
    const written = t.find((x) => x.startsWith("The Very Long"))!;
    expect(written.endsWith("…")).toBe(true);
    expect(written.length).toBeLessThanOrEqual(size === "wide" ? 34 : 44);
    const none = layoutGridCard(makeView(22, { raceName: null }), size);
    expect(none.header.map((l) => l.text)).not.toContain("Singapore Grand Prix");
    expect(none.header).toHaveLength(3);
  });

  test("the header lines are in order, inside the card and do not touch the grid", () => {
    const layout = layoutGridCard(makeView(22, { range: { from: 6, to: 15 } }), size);
    const ys = layout.header.map((l) => l.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    for (const line of layout.header) expect(line.x).toBeGreaterThan(layout.panel.x);
    if (size === "square") for (const slot of layout.grid) expect(slot.y).toBeGreaterThan(ys[ys.length - 1]!);
  });

  test("the credit line is last, and is drawn in two colors", () => {
    const commands = buildGridCard(makeView(22), size);
    const last = commands[commands.length - 1]! as Extract<DrawCommand, { type: "text" }>;
    expect(last.text).toBe("to the flag by Tyhad | F1 Watchalong");
    expect(last.runs).toHaveLength(2);
    expect(last.runs![0]!.fill).not.toBe(last.runs![1]!.fill);
  });
});

describe.each(SIZES)("drawing commands, %s card", (size) => {
  const { w, h } = DIMENSIONS[size];

  test("each box is the line across the front and the two sides, open at the back", () => {
    const view = makeView(4);
    const layout = layoutGridCard(view, size);
    const lines = buildGridCard(view, size).filter((c): c is Extract<DrawCommand, { type: "line" }> => c.type === "line");
    expect(lines).toHaveLength(12); // three per box
    const pole = slotOf(layout, 1);
    const front = lines.filter((l) => l.y1 === pole.y && l.y2 === pole.y && l.x1 <= pole.x && l.x2 >= pole.x + pole.w);
    expect(front).toHaveLength(1);
    const sides = lines.filter((l) => l.x1 === l.x2 && l.y1 === pole.y && l.y2 === pole.y + pole.h && (l.x1 === pole.x || l.x1 === pole.x + pole.w));
    expect(sides).toHaveLength(2);
    expect(lines.some((l) => l.y1 === l.y2 && l.y1 === pole.y + pole.h)).toBe(false); // nothing across the back
  });

  test("pole's box is drawn brighter than the others", () => {
    const lines = buildGridCard(makeView(22), size).filter((c): c is Extract<DrawCommand, { type: "line" }> => c.type === "line");
    const bright = lines.filter((l) => l.stroke === "var(--color-text)");
    expect(bright).toHaveLength(3);
    expect(lines.filter((l) => l.stroke !== "var(--color-text)").every((l) => l.stroke === "var(--color-text-3)")).toBe(true);
  });

  test("with pole out of the picture, no box is the bright one", () => {
    const lines = buildGridCard(makeView(22, { range: { from: 3, to: 8 } }), size).filter((c) => c.type === "line") as Extract<DrawCommand, { type: "line" }>[];
    expect(lines.some((l) => l.stroke === "var(--color-text)")).toBe(false);
  });

  test("every box has a team color strip: one per place, in the team's color from the theme", () => {
    const view = makeView(22, { pit: 2 });
    const rects = buildGridCard(view, size).filter((c): c is Extract<DrawCommand, { type: "rect" }> => c.type === "rect");
    const strips = rects.filter((r) => r.width <= 8 && r.height > r.width);
    expect(strips).toHaveLength(22);
    for (const strip of strips) expect(strip.fill).toMatch(/^#[0-9a-f]{6}$/i); // from teamColor(), the one place allowed to hold hex
  });

  test("apart from the team colors, every color is a theme token", () => {
    const commands = buildGridCard(makeView(22, { pit: 2, source: "qualifying" }), size);
    const colors: string[] = [];
    for (const c of commands) {
      if (c.type === "rect") colors.push(c.fill);
      if (c.type === "line") colors.push(c.stroke);
      if (c.type === "text") colors.push(c.fill, ...(c.runs ?? []).map((r) => r.fill));
    }
    const notTokens = colors.filter((x) => !/^var\(--color-[a-z0-9-]+\)$/.test(x));
    expect(notTokens.every((x) => /^#[0-9a-f]{6}$/i.test(x))).toBe(true);
    expect(notTokens).toHaveLength(22);
  });

  test("the background fills the card, then the panel", () => {
    const [bg, panel] = buildGridCard(makeView(22), size) as Extract<DrawCommand, { type: "rect" }>[];
    expect(bg).toMatchObject({ x: 0, y: 0, width: w, height: h, fill: "var(--color-s0)" });
    expect(panel!.fill).toBe("var(--color-s1)");
  });

  test("nothing is drawn outside the card", () => {
    for (const view of [makeView(22), makeView(22, { pit: 6 }), makeView(22, { range: { from: 6, to: 15 } }), makeView(3)]) {
      for (const c of buildGridCard(view, size)) {
        if (c.type === "rect") {
          expect(c.x).toBeGreaterThanOrEqual(0);
          expect(c.y).toBeGreaterThanOrEqual(0);
          expect(c.x + c.width).toBeLessThanOrEqual(w);
          expect(c.y + c.height).toBeLessThanOrEqual(h);
        } else if (c.type === "line") {
          for (const [x, y] of [[c.x1, c.y1], [c.x2, c.y2]] as const) {
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(w);
            expect(y).toBeGreaterThanOrEqual(0);
            expect(y).toBeLessThanOrEqual(h);
          }
        } else {
          expect(c.x).toBeGreaterThanOrEqual(0);
          expect(c.x).toBeLessThanOrEqual(w);
          expect(c.y).toBeGreaterThanOrEqual(0);
          expect(c.y).toBeLessThanOrEqual(h);
        }
      }
    }
  });

  test("the code and the place fit side by side inside the box (estimated text widths)", () => {
    const view = makeView(22);
    const layout = layoutGridCard(view, size);
    const commands = buildGridCard(view, size);
    for (const slot of layout.grid) {
      const code = texts(commands).find((t) => t.text === slot.code && t.y > slot.y && t.y < slot.y + slot.h)!;
      const place = texts(commands).find((t) => t.text === String(slot.position) && t.y > slot.y && t.y < slot.y + slot.h)!;
      const size_ = (font: string) => Number(/(\d+)px/.exec(font)![1]);
      const codeWidth = code.text.length * size_(code.font) * 0.62;
      const placeWidth = place.text.length * size_(place.font) * 0.62;
      expect(code.x - codeWidth).toBeGreaterThan(place.x + placeWidth);
      expect(code.x).toBeLessThanOrEqual(slot.x + slot.w);
    }
  });
});

describe("on the real Round 16 data", () => {
  const round16 = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "season-2026-r16.json"), "utf8")) as SeasonState;
  const racing = activeDrivers(round16);

  test.each(SIZES)("22 drivers, %s card: a full grid and one with a pit-lane start are inside the card with no overlap", (size) => {
    for (const grid of [
      { order: racing, pit: [] as string[], source: "openf1" as const },
      { order: racing.slice(0, 21), pit: racing.slice(21), source: "manual" as const },
    ]) {
      const view = buildGridCardView(round16, { round: 17, effective: grid }, null)!;
      expect(view.raceName).toBe("Singapore Grand Prix");
      const layout = layoutGridCard(view, size);
      const all = [...layout.grid, ...layout.pit];
      expect(all).toHaveLength(22);
      for (const s of all) expect(inside(rectOf(s), layout.panel)).toBe(true);
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(overlap(rectOf(all[i]!), rectOf(all[j]!))).toBe(false);
    }
  });

  test("the drivers are in the boxes in grid order: the code at pole is the first of the order", () => {
    const view = buildGridCardView(round16, { round: 17, effective: { order: [...racing].reverse(), pit: [], source: "openf1" } }, null)!;
    const layout = layoutGridCard(view, "square");
    expect(slotOf(layout, 1).code).toBe(racing[racing.length - 1]!);
    expect(slotOf(layout, 2).code).toBe(racing[racing.length - 2]!);
  });
});
