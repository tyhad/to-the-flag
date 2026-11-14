/**
 * Phase 8, Step 7: the Export section of the Race tab, rendered on the server. (Choosing a range and pressing the
 * buttons need a browser; these checks cover what the HTML promises.)
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { SeasonState } from "../engine/types";
import { GridEditor } from "../web/components/GridEditor";
import { GridExport } from "../web/components/GridExport";
import type { GridControls } from "../web/useGrid";
import { initialGridState, type GridInfo } from "../web/viewModel/grid";
import { UNSAVED_EXPORT_NOTE } from "../web/viewModel/gridExport";
import { makeState } from "./helpers";

const six = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"];
const season: SeasonState = makeState({
  rounds: 4,
  completed: 2,
  teams: { red: ["AAA", "BBB"], blue: ["CCC", "DDD"], green: ["EEE", "FFF"] },
  results: { "1:race": six, "2:race": six },
});
const info: GridInfo = {
  round: 3,
  effective: { order: six, pit: [], source: "openf1" },
  data: { source: "openf1", order: six },
  override: null,
  differs: false,
};
const render = (over: { info?: GridInfo; unsaved?: boolean } = {}) =>
  renderToStaticMarkup(<GridExport state={season} info={over.info ?? info} unsavedChanges={over.unsaved ?? false} />);

describe("GridExport", () => {
  test("a heading and the buttons, in words", () => {
    const html = render();
    expect(html).toContain('aria-label="Export the starting grid"');
    expect(html).toContain(">Export</h3>");
    for (const label of ["Export picture", "Copy as CSV", "Copy as JSON", "Download CSV", "Download JSON"]) {
      expect(html).toMatch(new RegExp(`<button[^>]*>${label}</button>`));
    }
  });

  test("the picture's size and places are chosen like the standings card's", () => {
    const html = render();
    expect(html).toContain('aria-label="Export picture size"');
    expect(html).toContain("Square (1080×1080)");
    expect(html).toContain("Wide (1920×1080)");
    expect(html).toContain('aria-label="Export places"');
    for (const option of ["All", "Top 10", "Top 12", "Custom (P...–P...)"]) expect(html).toContain(`>${option}</option>`);
  });

  test("starts with the whole grid: no custom boxes, no range note", () => {
    const html = render();
    expect(html).toContain('<option value="all" selected="">All</option>');
    expect(html).not.toContain('aria-label="From position"');
    expect(html).not.toContain("The picture shows");
    expect(html).not.toContain("always have every place");
  });

  test("every button is a plain button, none is disabled to start with", () => {
    const buttons = render().match(/<button[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(5);
    for (const b of buttons) {
      expect(b).toContain('type="button"');
      expect(b).not.toMatch(/\sdisabled=""/);
    }
  });

  test("says the export is of the saved grid while there are unsaved changes, and only then", () => {
    expect(render({ unsaved: true })).toContain(UNSAVED_EXPORT_NOTE);
    expect(render({ unsaved: false })).not.toContain(UNSAVED_EXPORT_NOTE);
  });

  test("shows nothing without a grid or a round", () => {
    expect(render({ info: { ...info, effective: null } })).toBe("");
    expect(render({ info: { ...info, round: null } })).toBe("");
  });

  test("needs no token: nothing in it is tied to write access", () => {
    expect(render()).not.toContain("token");
    expect(render()).not.toContain("Read-only");
  });
});

describe("the Export section in the Race tab", () => {
  const controls: GridControls = {
    state: { ...initialGridState(), status: "ready", info },
    keepMine: () => {},
    chooseOpenF1: async () => {},
    save: async () => {},
  };
  const editor = () => renderToStaticMarkup(<GridEditor state={season} controls={controls} canWrite verdict="open" />);

  test("sits at the end of the editor, after Save grid", () => {
    const html = editor();
    expect(html.indexOf("Export picture")).toBeGreaterThan(html.indexOf("Save grid"));
  });

  test("an editor with nothing changed does not warn about unsaved changes", () => {
    expect(editor()).not.toContain(UNSAVED_EXPORT_NOTE);
  });
});
