/**
 * Phase 8, Step 4: the grid editor, the Race panel and the Race tab, rendered on the server. (Keyboard focus, the menu
 * opening, colors and layout need a real browser; these checks cover what the HTML promises.)
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { SeasonState } from "../engine/types";
import { AnalysisPlaceholder } from "../web/components/AnalysisRail";
import { GridEditor } from "../web/components/GridEditor";
import { RacePanel } from "../web/components/RacePanel";
import type { GridControls } from "../web/useGrid";
import type { AccessVerdict } from "../web/viewModel/access";
import { initialGridState, type GridInfo, type GridState } from "../web/viewModel/grid";
import { makeState } from "./helpers";

const six = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"];
const base: SeasonState = makeState({
  rounds: 4,
  completed: 2,
  teams: { red: ["AAA", "BBB"], blue: ["CCC", "DDD"], green: ["EEE", "FFF", "GGG"] },
  results: { "1:race": [...six, "GGG"], "2:race": six },
});
const season: SeasonState = { ...base, rounds: base.rounds.map((r) => (r.round === 3 ? { ...r, name: "Test Grand Prix" } : r)) };

const openF1: GridInfo = {
  round: 3,
  effective: { order: six, pit: [], source: "openf1" },
  data: { source: "openf1", order: six },
  override: null,
  differs: false,
};
const manual: GridInfo = {
  round: 3,
  effective: { order: ["BBB", "AAA", "CCC", "DDD", "EEE"], pit: ["FFF"], source: "manual" },
  data: { source: "openf1", order: six },
  override: { updatedAt: "x", valid: true },
  differs: true,
};

const noop = async () => {};
const controls = (overrides: Partial<GridState> = {}): GridControls => ({
  state: { ...initialGridState(), status: "ready", info: openF1, ...overrides },
  keepMine: () => {},
  chooseOpenF1: noop,
  save: noop,
});

const DISABLED = /\sdisabled=""/;
const button = (html: string, label: string): string => html.match(new RegExp(`<button[^>]*>${label}</button>`))![0];
const labelled = (html: string, aria: string): string => html.match(new RegExp(`<button[^>]*aria-label="${aria}"[^>]*>`))![0];

const editor = (c: GridControls, access: { canWrite?: boolean; verdict?: AccessVerdict; state?: SeasonState } = {}) =>
  renderToStaticMarkup(<GridEditor state={access.state ?? season} controls={c} canWrite={access.canWrite ?? true} verdict={access.verdict ?? "open"} />);

describe("GridEditor", () => {
  test("lists every driver in start order with place, code and name", () => {
    const html = editor(controls());
    expect(html).toContain('<ol aria-label="Starting grid"');
    expect((html.match(/<li/g) ?? []).length).toBe(6);
    for (const code of six) expect(html).toContain(code);
    expect(html.indexOf("AAA")).toBeLessThan(html.indexOf("BBB"));
    expect(html).toContain("Place </span>1");
    expect(html).toContain(season.drivers.find((d) => d.code === "AAA")!.name);
  });

  test("each row has a team color strip that is decoration only", () => {
    const html = editor(controls());
    expect((html.match(/aria-hidden="true"[^>]*style="[^"]*background-color:/g) ?? []).length).toBe(6);
  });

  test("each row has Up, Down and More, named for the driver", () => {
    const html = editor(controls());
    for (const code of six) {
      expect(html).toContain(`aria-label="Move ${code} up"`);
      expect(html).toContain(`aria-label="Move ${code} down"`);
      expect(html).toContain(`aria-label="More actions for ${code}"`);
    }
  });

  test("Up is off for pole and Down for the last place; the rest are on", () => {
    const html = editor(controls());
    expect(labelled(html, "Move AAA up")).toMatch(DISABLED);
    expect(labelled(html, "Move AAA down")).not.toMatch(DISABLED);
    expect(labelled(html, "Move FFF down")).toMatch(DISABLED);
    expect(labelled(html, "Move FFF up")).not.toMatch(DISABLED);
    expect(labelled(html, "Move CCC up")).not.toMatch(DISABLED);
  });

  test("the menu is closed until asked for, and More says so", () => {
    const html = editor(controls());
    expect(html).not.toContain('role="group"');
    expect(labelled(html, "More actions for AAA")).toContain('aria-expanded="false"');
    expect(labelled(html, "More actions for AAA")).toContain('aria-controls="grid-AAA-menu"');
  });

  test("every button is a plain button", () => {
    const buttons = editor(controls()).match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(18);
    for (const b of buttons) expect(b).toContain('type="button"');
  });

  test("pit-lane starters come last and are marked in words", () => {
    const html = editor(controls({ info: manual }));
    expect(html).toContain("Pit-lane start");
    expect(html.indexOf("FFF")).toBeGreaterThan(html.indexOf("EEE"));
    expect(html).toContain("Place </span>6");
    expect(labelled(html, "Move FFF down")).toMatch(DISABLED);
    expect(labelled(html, "Move FFF up")).not.toMatch(DISABLED); // the first pit-lane starter can join the grid
  });

  test("says when a driver was missing from the grid and was added", () => {
    const short: GridInfo = { ...openF1, effective: { order: six.slice(0, 5), pit: [], source: "openf1" } };
    const html = editor(controls({ info: short }));
    expect((html.match(/<li/g) ?? []).length).toBe(6);
    expect(html).toContain("FFF was not in the grid and was added at the back. Check the order.");
  });

  test("Paste a list is closed to start with", () => {
    const html = editor(controls());
    expect(button(html, "Paste a list")).toContain('aria-expanded="false"');
    expect(html).not.toContain("<textarea");
  });

  test("with nothing changed and no saved grid, both buttons are off and say why", () => {
    const html = editor(controls());
    expect(button(html, "Save grid")).toMatch(DISABLED);
    expect(button(html, "Use data grid")).toMatch(DISABLED);
    expect(html).toContain("Change the grid first.");
    expect(html).toContain("No manual grid is saved.");
    expect(button(html, "Save grid")).toContain('aria-describedby="grid-reasons"');
    expect(html).toContain('id="grid-reasons"');
  });

  test("with a manual grid saved, Use data grid is on", () => {
    const html = editor(controls({ info: manual }));
    expect(button(html, "Use data grid")).not.toMatch(DISABLED);
    expect(html).not.toContain("No manual grid is saved.");
  });

  test("read-only: both buttons are off, and the reason is said once", () => {
    const html = editor(controls({ info: manual }), { canWrite: false, verdict: "needs-token" });
    expect(button(html, "Save grid")).toMatch(DISABLED);
    expect(button(html, "Use data grid")).toMatch(DISABLED);
    expect((html.match(/Enter the write token to change the grid\./g) ?? []).length).toBe(1);
    // reading and arranging still work: the correction buttons are not tied to access
    expect(labelled(html, "Move BBB down")).not.toMatch(DISABLED);
  });

  test("while saving: a status line and Save is off", () => {
    const html = editor(controls({ saving: true }));
    expect(html).toContain("Saving…");
    expect(button(html, "Save grid")).toMatch(DISABLED);
  });

  test("failures are alerts in words", () => {
    const html = editor(controls({ saveError: "AAA is listed 2 times.", error: "Could not reach the server. Check that it is running." }));
    expect(html).toMatch(/role="alert"[^>]*>AAA is listed 2 times\.</);
    expect(html).toMatch(/role="alert"[^>]*>Could not reach the server\./);
  });
});

describe("RacePanel", () => {
  const panel = (c: GridControls, notice?: React.ReactNode) =>
    renderToStaticMarkup(<RacePanel state={season} controls={c} canWrite verdict="open" notice={notice} />);

  test("names the race and says where the grid comes from, above the editor", () => {
    const html = panel(controls());
    expect(html).toContain("Starting grid");
    expect(html).toContain("Round 3 · Test Grand Prix");
    expect(html).toContain("Grid: OpenF1");
    expect(html.indexOf("Grid: OpenF1")).toBeLessThan(html.indexOf('<ol aria-label="Starting grid"'));
  });

  test("a manual grid is tagged manual", () => {
    expect(panel(controls({ info: manual }))).toContain("Grid: manual");
  });

  test("a qualifying grid has the warning tag", () => {
    const quali: GridInfo = { ...openF1, effective: { order: six, pit: [], source: "qualifying" }, data: { source: "qualifying", order: six } };
    const html = panel(controls({ info: quali }));
    expect(html).toContain("Grid: qualifying (may differ from the real grid)");
    expect(html).toContain("border-yellow");
  });

  test("the notice, when there is one, sits between the heading and the editor", () => {
    const html = panel(controls({ info: manual }), <p>THE NOTICE</p>);
    expect(html.indexOf("THE NOTICE")).toBeGreaterThan(html.indexOf("Starting grid"));
    expect(html.indexOf("THE NOTICE")).toBeLessThan(html.indexOf('<ol aria-label="Starting grid"'));
  });

  test("before qualifying there is no editor, only what to expect", () => {
    const html = panel(controls({ info: { round: 3, effective: null, data: null, override: null, differs: false } }));
    expect(html).toContain("The grid is known after qualifying.");
    expect(html).not.toContain("<ol");
    expect(html).not.toContain("Save grid");
  });

  test("season over, loading, and failed each say so", () => {
    expect(panel(controls({ info: { round: null, effective: null, data: null, override: null, differs: false } }))).toContain("No race left");
    expect(panel(controls({ status: "loading", info: null }))).toContain("Loading the grid…");
    const failed = panel(controls({ status: "error", info: null }));
    expect(failed).toContain("The grid could not be loaded");
    expect(failed).toContain("Reload the page to try again.");
  });

  test("a saved grid that no longer fits is explained, and the editor shows the grid in use", () => {
    const bad: GridInfo = { ...openF1, override: { updatedAt: "x", valid: false } };
    const html = panel(controls({ info: bad }));
    expect(html).toContain("no longer fits the drivers");
    expect(html).toContain('<ol aria-label="Starting grid"');
    expect(button(html, "Use data grid")).not.toMatch(DISABLED);
  });
});

describe("the Race tab", () => {
  test("is the third tab, after Possible? and Likely?", () => {
    const html = renderToStaticMarkup(<AnalysisPlaceholder />);
    const tabs = [...html.matchAll(/role="tab"[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect(tabs).toEqual(["Possible?", "Likely?", "Race"]);
  });
});
