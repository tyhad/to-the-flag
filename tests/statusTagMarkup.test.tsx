/**
 * Phase 7, Step 3: the `✕ No title` tag and the tower row, rendered to HTML on the server so the checks run
 * without a browser. (How it looks, and how the tag fits its column, needs a real browser.)
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusTag } from "../web/components/StatusTag";
import { TowerRow } from "../web/components/TowerRow";
import { buildTowerRows, statusTag, type TowerRow as Row } from "../web/viewModel/tower";
import { makeState } from "./helpers";

// AAA 75, BBB 54, CCC 45, DDD 36, EEE 20 (raced twice, not in round 3). One race left (25 points).
// CCC and DDD can no longer win; EEE is not racing.
const state = makeState({
  rounds: 4,
  completed: 3,
  teams: { t: ["AAA", "BBB", "CCC", "DDD", "EEE"] },
  results: {
    "1:race": ["AAA", "BBB", "CCC", "DDD", "EEE"],
    "2:race": ["AAA", "BBB", "CCC", "DDD", "EEE"],
    "3:race": ["AAA", "BBB", "CCC", "DDD"],
  },
});
const rows = buildTowerRows(state, undefined, "wdc");
const rowOf = (id: string): Row => rows.find((r) => r.id === id)!;
const renderRow = (id: string) => renderToStaticMarkup(<ul><TowerRow row={rowOf(id)} /></ul>);
const renderTag = (id: string) => renderToStaticMarkup(<StatusTag view={statusTag(rowOf(id))!} />);

describe("StatusTag: no title", () => {
  const html = renderTag("CCC");

  test("a cross icon plus the text, never color alone", () => {
    expect(html).toContain("<svg");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain(">No title<");
  });

  test("the accessible name says the driver cannot win the title", () => {
    expect(html).toContain("Cannot win the title");
    expect(html).toMatch(/class="sr-only">Cannot win the title</);
  });

  test("no fill: text-3 and no chamfer background", () => {
    expect(html).toContain("text-text-3");
    expect(html).not.toContain("chamfer");
    expect(html).not.toMatch(/\bbg-/);
  });

  test("the word 'Eliminated' is gone", () => {
    expect(html).not.toContain("Eliminated");
  });

  test("the other tags keep their markup: filled, with the label only", () => {
    expect(renderTag("AAA")).toContain("chamfer");
    expect(renderTag("AAA")).toContain(">Alive<");
    expect(renderTag("AAA")).not.toContain("<svg");
    expect(renderTag("AAA")).not.toContain("sr-only");
  });

  test("'not racing' keeps its text-3 tag without an icon", () => {
    const eee = renderTag("EEE");
    expect(eee).toContain(">not racing<");
    expect(eee).toContain("text-text-3");
    expect(eee).not.toContain("<svg");
  });
});

describe("TowerRow: no strike-through", () => {
  test("no row, for any status, uses line-through", () => {
    for (const r of rows) expect(renderRow(r.id)).not.toContain("line-through");
  });

  test("an out-of-title row keeps the normal text color and shows the tag", () => {
    const html = renderRow("CCC");
    expect(html).toMatch(/class="type-title truncate text-text"/);
    expect(html).not.toMatch(/class="type-title truncate text-text-3/);
    expect(html).toContain(">No title<");
  });

  test("the points of an out-of-title row are in the normal text color too", () => {
    expect(renderRow("DDD")).toMatch(/<span class="text-text">36<span class="sr-only"> points<\/span><\/span>/);
  });

  test("a driver who is not racing stays in text-3 with the 'not racing' tag", () => {
    const html = renderRow("EEE");
    expect(html).toMatch(/class="type-title truncate text-text-3"/);
    expect(html).toContain(">not racing<");
    expect(html).not.toContain("No title");
  });

  test("a driver who can still win looks as before", () => {
    const html = renderRow("AAA");
    expect(html).toMatch(/class="type-title truncate text-text"/);
    expect(html).toContain(">Alive<");
  });
});
