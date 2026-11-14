/**
 * Phase 8, Step 5: the forecast section and its place in the Race tab, rendered on the server.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RaceForecast } from "../web/components/RaceForecast";
import { RacePanel } from "../web/components/RacePanel";
import type { GridControls } from "../web/useGrid";
import { initialGridState, type GridInfo } from "../web/viewModel/grid";
import type { ForecastData } from "../web/viewModel/forecastRequests";
import { buildRaceForecastView, FORECAST_NOTE, type ForecastDisplay } from "../web/viewModel/raceForecast";
import { makeState } from "./helpers";

const state = makeState({ rounds: 4, completed: 2, teams: { red: ["AAA", "BBB"], blue: ["CCC", "DDD"] }, results: { "1:race": ["AAA", "BBB", "CCC", "DDD"], "2:race": ["AAA", "BBB", "CCC", "DDD"] } });
const data: ForecastData = {
  nSims: 1000,
  seed: 1,
  win: { AAA: 0.5, BBB: 0.3, CCC: 0.034, DDD: 0.001 },
  podium: { AAA: 0.9, BBB: 0.8, CCC: 0.47, DDD: 0.02 },
  top10: { AAA: 0.999, BBB: 0.99, CCC: 0.95, DDD: 0.6 },
  meanPosition: { AAA: 1.84, BBB: 2.5, CCC: 3.04, DDD: 4.4 },
  field: ["AAA", "BBB", "CCC", "DDD"],
  grid: { AAA: 2, BBB: 1, CCC: 3, DDD: 4 },
  gridRound: 3,
  gridSource: "openf1",
  asOfRound: 2,
};
const view = buildRaceForecastView(data, state);
const ready = (over: { updating?: boolean; failed?: string | null } = {}): ForecastDisplay => ({ kind: "ready", view, updating: false, failed: null, ...over });
const render = (display: ForecastDisplay) => renderToStaticMarkup(<RaceForecast display={display} />);

describe("RaceForecast", () => {
  test("a heading, the model-estimate header, the table and the note", () => {
    const html = render(ready());
    expect(html).toContain("Race forecast");
    expect(html).toContain("Model estimate · as of Round 2 · Grid: OpenF1");
    expect(html).toContain("<table");
    expect(html).toContain(FORECAST_NOTE);
  });

  test("a real table: column headings with their full words, and the driver as the row heading", () => {
    const html = render(ready());
    for (const label of ["Driver", "Grid", "Win", "Podium", "Points", "Exp. finish"]) expect(html).toContain(`>${label}</th>`);
    expect(html).toContain('aria-label="Chance to win the race"');
    expect(html).toContain('aria-label="Expected finishing place (a retirement counts as last)"');
    expect(html).toMatch(/<th scope="row"[^>]*>AAA<\/th>/);
    expect((html.match(/scope="col"/g) ?? []).length).toBe(6);
  });

  test("one row per driver, best chance first, with the numbers in words and figures", () => {
    const html = render(ready());
    expect((html.match(/scope="row"/g) ?? []).length).toBe(4);
    expect(html.indexOf(">AAA<")).toBeLessThan(html.indexOf(">BBB<"));
    expect(html.indexOf(">BBB<")).toBeLessThan(html.indexOf(">CCC<"));
    for (const text of ["50%", "90%", ">99%", "3.4%", "<1%", "1.8"]) expect(html.replace(/&gt;/g, ">").replace(/&lt;/g, "<")).toContain(`>${text}<`);
  });

  test("each row has a team color on its edge, from the theme", () => {
    expect((render(ready()).match(/border-left:3px solid/g) ?? []).length).toBe(4);
  });

  test("not dimmed and no Updating line when it is up to date", () => {
    const html = render(ready());
    expect(html).not.toContain("Updating…");
    expect(html).not.toContain("opacity-60");
    expect(html).toContain('aria-busy="false"');
  });

  test("while updating: the old numbers stay, dimmed, with a status line", () => {
    const html = render(ready({ updating: true }));
    expect(html).toContain("Updating…");
    expect(html).toContain("opacity-60");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("<table");
  });

  test("a failed update keeps the table, dimmed, and says so in an alert", () => {
    const html = render(ready({ failed: "The background calculation stopped unexpectedly." }));
    expect(html).toContain("The forecast could not be updated");
    expect(html).toContain("The background calculation stopped unexpectedly.");
    expect(html).toContain('role="alert"');
    expect(html).toContain("opacity-60");
    expect(html).toContain("<table");
  });

  test("the first calculation shows a status line and no table", () => {
    const html = render({ kind: "calculating" });
    expect(html).toContain("Calculating the forecast…");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("<table");
  });

  test("a failure with nothing to show is an alert in words", () => {
    const html = render({ kind: "failed", message: "boom" });
    expect(html).toContain("The forecast could not be calculated");
    expect(html).toContain("boom");
    expect(html).toContain('role="alert"');
  });

  test("nothing at all when there is nothing to show: not even the heading", () => {
    expect(render({ kind: "none" })).toBe("");
  });
});

describe("the forecast in the Race tab", () => {
  const info: GridInfo = {
    round: 3,
    effective: { order: ["AAA", "BBB", "CCC", "DDD"], pit: [], source: "openf1" },
    data: { source: "openf1", order: ["AAA", "BBB", "CCC", "DDD"] },
    override: null,
    differs: false,
  };
  const controls: GridControls = {
    state: { ...initialGridState(), status: "ready", info },
    keepMine: () => {},
    chooseOpenF1: async () => {},
    save: async () => {},
  };
  const panel = (i = info) =>
    renderToStaticMarkup(
      <RacePanel
        state={state}
        controls={{ ...controls, state: { ...controls.state, info: i } }}
        canWrite
        verdict="open"
        forecast={<p>THE FORECAST</p>}
      />,
    );

  test("sits under the grid editor, after its buttons", () => {
    const html = panel();
    expect(html.indexOf("THE FORECAST")).toBeGreaterThan(html.indexOf("Use data grid"));
  });

  test("is not shown when there is no grid to follow", () => {
    expect(panel({ round: 3, effective: null, data: null, override: null, differs: false })).not.toContain("THE FORECAST");
  });
});
