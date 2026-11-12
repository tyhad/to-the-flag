/**
 * Phase 7, Step 4: the Best column as HTML, rendered on the server so the checks run without a browser.
 * (Widths at 1920x1080 and at 1280 wide need a real browser.)
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Tower } from "../web/components/Tower";
import { TOWER_COLUMNS, TowerRow } from "../web/components/TowerRow";
import { buildTowerRows, type TowerRow as Row } from "../web/viewModel/tower";
import { makeState } from "./helpers";

// AAA 75, BBB 54, CCC 45, DDD 36, EEE 20 (not racing). One race left. Best: P1, P1, P2, P2, P5.
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
const renderTower = () => renderToStaticMarkup(<Tower rows={rows} label="Drivers' championship" />);

describe("TowerRow: the Best cell", () => {
  test("shows the place as text, 'P2'", () => {
    expect(renderRow("CCC")).toMatch(/<span[^>]*aria-hidden="true"[^>]*>P2<\/span>/);
    expect(renderRow("AAA")).toMatch(/>P1</);
    expect(renderRow("EEE")).toMatch(/>P5</);
  });

  test("its accessible name says 'on points alone', and carries the value", () => {
    const html = renderRow("CCC");
    expect(html).toContain("Highest place still possible on points alone: P2");
    expect(html).toMatch(/class="sr-only">Highest place still possible on points alone: P2</);
  });

  test("it sits before the status tag", () => {
    const html = renderRow("CCC");
    expect(html.indexOf(">P2<")).toBeGreaterThan(-1);
    expect(html.indexOf(">P2<")).toBeLessThan(html.indexOf(">No title<"));
  });

  test("a driver who is not racing has a best place and keeps his 'not racing' tag", () => {
    const html = renderRow("EEE");
    expect(html).toContain(">P5<");
    expect(html).toContain(">not racing<");
    expect(html.indexOf(">P5<")).toBeLessThan(html.indexOf(">not racing<"));
  });

  test("the row uses the shared column template, with six columns", () => {
    expect(renderRow("AAA")).toContain(TOWER_COLUMNS);
    const tracks = TOWER_COLUMNS.replace(/^grid-cols-\[|\]$/g, "").split("_");
    expect(tracks).toHaveLength(6);
  });

  test("nothing else in the row changed: rank, name, points, delta and the tag are still there", () => {
    const html = renderRow("CCC");
    expect(html).toContain("Position </span>3");
    expect(html).toContain(">CCC<");
    expect(html).toContain("45");
    expect(html).toContain(">No title<");
  });
});

describe("Tower: header and hint", () => {
  const html = renderTower();

  test("a header 'Best' on the same column template as the rows", () => {
    expect(html).toContain(">Best<");
    // header and rows share one template, so the columns line up
    expect(html.split(TOWER_COLUMNS).length - 1).toBe(1 + rows.length);
  });

  test("the header is for the eye: the cells carry the accessible name", () => {
    expect(html).toMatch(/<div[^>]*aria-hidden="true"[^>]*>(?:(?!<\/div>).)*>Best</);
  });

  test("one short hint line under the table", () => {
    expect(html).toContain("Best = the highest place still possible on points alone.");
    expect(html.indexOf("Best = the highest place")).toBeGreaterThan(html.lastIndexOf("</ol>"));
    expect(html).toMatch(/<p[^>]*class="[^"]*type-caption[^"]*"[^>]*>Best = /);
  });

  test("the list keeps its label and one item per row", () => {
    expect(html).toContain('aria-label="Drivers&#x27; championship"');
    expect((html.match(/<li /g) ?? []).length).toBe(rows.length);
  });

  test("the hint never claims a promise: it says 'possible', on points alone", () => {
    expect(html).not.toMatch(/will finish|guarantee/i);
  });
});
