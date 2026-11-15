/**
 * Phase 8, Step 5: the race forecast as the page words it (web/viewModel/raceForecast.ts). Pure.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { activeDrivers, forecastRace, gridFromOrder, type SeasonState } from "../engine";
import { answerForecastRequest, initialForecastState, type ForecastData, type ForecastState } from "../web/viewModel/forecastRequests";
import {
  FORECAST_COLUMNS,
  FORECAST_NOTE,
  buildRaceForecastView,
  forecastDisplay,
  forecastGridWord,
  formatExpectedFinish,
} from "../web/viewModel/raceForecast";
import { makeState } from "./helpers";

/** A small hand-made forecast, so the numbers are known. */
const data = (over: Partial<ForecastData> = {}): ForecastData => ({
  nSims: 1000,
  seed: 1,
  win: { AAA: 0.5, BBB: 0.3, CCC: 0.034, DDD: 0.001 },
  podium: { AAA: 0.9, BBB: 0.8, CCC: 0.47, DDD: 0.02 },
  top10: { AAA: 0.999, BBB: 0.99, CCC: 0.95, DDD: 0.6 },
  meanPosition: { AAA: 1.84, BBB: 2.5, CCC: 3.04, DDD: 4.4 },
  field: ["DDD", "CCC", "BBB", "AAA"],
  grid: { AAA: 2, BBB: 1, CCC: 3, DDD: 4 },
  gridRound: 3,
  gridSource: "openf1",
  asOfRound: 2,
  ...over,
});
const teams = makeState({ rounds: 4, completed: 2, teams: { red: ["AAA", "BBB"], blue: ["CCC", "DDD"] }, results: { "1:race": ["AAA", "BBB", "CCC", "DDD"], "2:race": ["AAA", "BBB", "CCC", "DDD"] } });

describe("the header", () => {
  test("says it is a model estimate, as of which round, and which grid", () => {
    expect(buildRaceForecastView(data(), teams).header).toBe("Model estimate · as of Round 2 · Grid: OpenF1");
  });

  test("names each kind of grid in words", () => {
    expect(forecastGridWord("openf1")).toBe("OpenF1");
    expect(forecastGridWord("manual")).toBe("manual");
    expect(forecastGridWord("qualifying_fallback")).toBe("qualifying");
    expect(forecastGridWord("qualifying")).toBe("qualifying");
    expect(forecastGridWord("something else")).toBe("qualifying");
    expect(forecastGridWord(null)).toBe("none");
    expect(buildRaceForecastView(data({ gridSource: "manual" }), teams).header).toContain("Grid: manual");
    expect(buildRaceForecastView(data({ gridSource: null, grid: null }), teams).header).toContain("Grid: none");
  });

  test("says as of the round the model fitted on", () => {
    expect(buildRaceForecastView(data({ asOfRound: 16 }), teams).header).toContain("as of Round 16");
  });
});

describe("the rows", () => {
  test("are sorted by the chance to win, best first", () => {
    expect(buildRaceForecastView(data(), teams).rows.map((r) => r.code)).toEqual(["AAA", "BBB", "CCC", "DDD"]);
  });

  test("a tie in the win chance is broken by the podium chance, then the grid place, then the code", () => {
    const tied = data({
      win: { AAA: 0.2, BBB: 0.2, CCC: 0.2, DDD: 0.2 },
      podium: { AAA: 0.5, BBB: 0.7, CCC: 0.7, DDD: 0.7 },
      grid: { AAA: 4, BBB: 3, CCC: 2, DDD: 2 },
    });
    expect(buildRaceForecastView(tied, teams).rows.map((r) => r.code)).toEqual(["CCC", "DDD", "BBB", "AAA"]);
  });

  test("shows the grid place, the three chances and the expected finish", () => {
    const [first, second] = buildRaceForecastView(data(), teams).rows;
    expect(first).toMatchObject({ code: "AAA", grid: "2", win: "50%", podium: "90%", points: ">99%", finish: "1.8" });
    expect(second).toMatchObject({ code: "BBB", grid: "1", win: "30%", podium: "80%", points: "99%", finish: "2.5" });
  });

  test("every chance is worded like the rest of the app: <1%, one decimal below 10%, whole percent, >99%", () => {
    const rows = buildRaceForecastView(data(), teams).rows;
    const ccc = rows.find((r) => r.code === "CCC")!;
    const ddd = rows.find((r) => r.code === "DDD")!;
    expect(ccc.win).toBe("3.4%");
    expect(ddd.win).toBe("<1%");
  });

  test("a driver the grid does not have is shown at the back, as the model assumed", () => {
    const view = buildRaceForecastView(data({ grid: { AAA: 1, BBB: 2, CCC: 3 } }), teams);
    expect(view.rows.find((r) => r.code === "DDD")!.grid).toBe("4");
  });

  test("with no grid at all every driver is shown at the back", () => {
    const view = buildRaceForecastView(data({ grid: null }), teams);
    expect(view.rows.every((r) => r.grid === "4")).toBe(true);
  });

  test("each row carries the driver's team for the color strip", () => {
    const rows = buildRaceForecastView(data(), teams).rows;
    expect(rows.find((r) => r.code === "AAA")!.teamId).toBe("red");
    expect(rows.find((r) => r.code === "CCC")!.teamId).toBe("blue");
  });

  test("the expected finish has one decimal", () => {
    expect(formatExpectedFinish(1)).toBe("1.0");
    expect(formatExpectedFinish(12.345)).toBe("12.3");
    expect(formatExpectedFinish(21.96)).toBe("22.0");
  });
});

describe("the note and the columns", () => {
  test("the note is this sentence, word for word", () => {
    expect(FORECAST_NOTE).toBe("The forecast follows the grid above. Retirements and weather are not known.");
    expect(buildRaceForecastView(data(), teams).note).toBe(FORECAST_NOTE);
  });

  test("the columns, in order, each with its full words", () => {
    expect(FORECAST_COLUMNS.map((c) => c.key)).toEqual(["grid", "win", "podium", "points", "finish"]);
    expect(FORECAST_COLUMNS.map((c) => c.label)).toEqual(["Grid", "Win", "Podium", "Points", "Exp. finish"]);
    for (const c of FORECAST_COLUMNS) expect(c.title.length).toBeGreaterThan(c.label.length);
  });
});

describe("on the real Round 16 data", () => {
  const round16 = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "season-2026-r16.json"), "utf8")) as SeasonState;
  const racing = activeDrivers(round16);
  const orderWith = (front: string[]) => [...front, ...racing.filter((c) => !front.includes(c))];
  const forecastFor = (order: string[]) =>
    (answerForecastRequest({
      id: 1,
      kind: "forecast",
      state: { ...round16, upcomingGrid: { round: 17, grid: gridFromOrder(order), source: "openf1" } },
      params: { nSims: 4000, seed: 11 },
    }) as { forecast: ForecastData }).forecast;

  test("the two front-row drivers have the two best chances to win", () => {
    const view = buildRaceForecastView(forecastFor(orderWith(["LEC", "ANT"])), round16);
    expect(view.rows.slice(0, 2).map((r) => r.code).sort()).toEqual(["ANT", "LEC"]);
    expect(view.rows[0]!.grid === "1" || view.rows[0]!.grid === "2").toBe(true);
  });

  test("moving a driver down the grid lowers that driver's chance to win and raises the expected finish", () => {
    const front = forecastFor(orderWith(["LEC", "ANT"]));
    const back = forecastFor([...orderWith(["ANT"]).filter((c) => c !== "LEC"), "LEC"]);
    expect(back.win["LEC"]!).toBeLessThan(front.win["LEC"]!);
    expect(back.meanPosition["LEC"]!).toBeGreaterThan(front.meanPosition["LEC"]!);
  });

  test("nothing reads 0% or 100%, in any column, for any driver", () => {
    const view = buildRaceForecastView(forecastFor(orderWith(["ANT", "LEC"])), round16);
    const chances = view.rows.flatMap((r) => [r.win, r.podium, r.points]);
    expect(chances.length).toBe(racing.length * 3);
    for (const text of chances) {
      expect(text).not.toBe("0%");
      expect(text).not.toBe("100%");
      expect(text).toMatch(/^(<1%|>99%|\d+(\.\d)?%)$/);
    }
  });

  test("there is a row for every driver who races, and the win chances are never more than 100% together", () => {
    const f = forecastFor(orderWith(["ANT"]));
    expect(buildRaceForecastView(f, round16).rows).toHaveLength(racing.length);
    expect(Object.values(f.win).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1 + 1e-12);
    expect(forecastRace(round16, { nSims: 100, seed: 1 }).win).toBeDefined();
  });
});

describe("what the section shows (forecastDisplay)", () => {
  const ready = (status: ForecastState["status"], error: string | null = null): ForecastState => ({ status, forecast: data(), error, durationMs: 5 });

  test("nothing when nothing is running and nothing arrived", () => {
    expect(forecastDisplay(initialForecastState, teams)).toEqual({ kind: "none" });
  });

  test("the first calculation says so", () => {
    expect(forecastDisplay({ ...initialForecastState, status: "calculating" }, teams)).toEqual({ kind: "calculating" });
  });

  test("a forecast, not updating", () => {
    const d = forecastDisplay(ready("ready"), teams);
    expect(d).toMatchObject({ kind: "ready", updating: false, failed: null });
  });

  test("a forecast that is being replaced is marked updating, and still shown", () => {
    const d = forecastDisplay(ready("calculating"), teams);
    expect(d).toMatchObject({ kind: "ready", updating: true });
    expect((d as any).view.rows).toHaveLength(4);
  });

  test("while the grid is being saved the numbers are marked updating too", () => {
    expect(forecastDisplay(ready("ready"), teams, true)).toMatchObject({ kind: "ready", updating: true });
  });

  test("a failed update keeps the last forecast and says what went wrong", () => {
    expect(forecastDisplay(ready("error", "The background calculation stopped unexpectedly."), teams)).toMatchObject({
      kind: "ready",
      failed: "The background calculation stopped unexpectedly.",
    });
  });

  test("a failure with nothing older to show is a failure", () => {
    expect(forecastDisplay({ status: "error", forecast: null, error: "boom", durationMs: null }, teams)).toEqual({ kind: "failed", message: "boom" });
    expect(forecastDisplay({ status: "error", forecast: null, error: null, durationMs: null }, teams)).toEqual({
      kind: "failed",
      message: "The forecast could not be calculated.",
    });
  });
});
