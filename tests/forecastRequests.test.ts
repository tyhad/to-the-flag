/**
 * Phase 8, Step 5: the race forecast's conversation with the worker (web/viewModel/forecastRequests.ts). No Worker.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { activeDrivers, forecastRace, gridFromOrder, type SeasonState } from "../engine";
import {
  answerForecastRequest,
  answerWorkerRequest,
  applyForecastResponse,
  failForecast,
  initialForecastState,
  markForecastCalculating,
  markForecastIdle,
  type ForecastData,
  type ForecastResponse,
  type ForecastState,
} from "../web/viewModel/forecastRequests";

const round16 = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "season-2026-r16.json"), "utf8")) as SeasonState;
const racing = activeDrivers(round16);
const grid = gridFromOrder(racing);
const withGrid = (source: string): SeasonState => ({ ...round16, upcomingGrid: { round: 17, grid, source } });
const quick = { nSims: 500, seed: 3 };

describe("answerForecastRequest", () => {
  test("answers with the forecast of the drivers who race, using the season's grid", () => {
    const state = withGrid("openf1");
    const answer = answerForecastRequest({ id: 4, kind: "forecast", state, params: quick }) as Extract<ForecastResponse, { forecast: ForecastData }>;
    expect(answer.id).toBe(4);
    const direct = forecastRace(state, quick, racing, grid);
    expect(answer.forecast).toMatchObject({ win: direct.win, podium: direct.podium, top10: direct.top10, meanPosition: direct.meanPosition });
    expect(answer.forecast.field).toEqual(racing);
  });

  test("says what the numbers are based on: the grid, its round and source, and the round it fitted on", () => {
    const answer = answerForecastRequest({ id: 1, kind: "forecast", state: withGrid("manual"), params: quick }) as any;
    expect(answer.forecast.grid).toEqual(grid);
    expect(answer.forecast.gridRound).toBe(17);
    expect(answer.forecast.gridSource).toBe("manual");
    expect(answer.forecast.asOfRound).toBe(round16.asOfRound);
  });

  test("a different grid gives different numbers: the forecast follows the grid", () => {
    const reversed = [...racing].reverse();
    const a = answerForecastRequest({ id: 1, kind: "forecast", state: withGrid("openf1"), params: quick }) as any;
    const b = answerForecastRequest({
      id: 2,
      kind: "forecast",
      state: { ...round16, upcomingGrid: { round: 17, grid: gridFromOrder(reversed), source: "manual" } },
      params: quick,
    }) as any;
    expect(a.forecast.win).not.toEqual(b.forecast.win);
  });

  test("without a grid it still answers, and says it used none", () => {
    const answer = answerForecastRequest({ id: 1, kind: "forecast", state: round16, params: quick }) as any;
    expect(answer.forecast.grid).toBeNull();
    expect(answer.forecast.gridRound).toBeNull();
    expect(answer.forecast.gridSource).toBeNull();
  });

  test("reports how long it took, from the clock it is given", () => {
    const times = [1000, 1042];
    const answer = answerForecastRequest({ id: 1, kind: "forecast", state: withGrid("openf1"), params: quick }, () => times.shift()!) as any;
    expect(answer.ms).toBe(42);
  });

  test("never throws: a problem comes back as an error answer", () => {
    const answer = answerForecastRequest({ id: 9, kind: "forecast", state: withGrid("openf1"), params: { nSims: 0 } });
    expect(answer.id).toBe(9);
    expect("error" in answer && answer.error).toContain("nSims");
  });

  test("does not modify the state it was given", () => {
    const state = withGrid("openf1");
    const before = JSON.stringify(state);
    answerForecastRequest({ id: 1, kind: "forecast", state, params: quick });
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("the worker answers both kinds of request", () => {
  test("a forecast request gets a forecast answer", () => {
    const answer = answerWorkerRequest({ id: 2, kind: "forecast", state: withGrid("openf1"), params: quick });
    expect(answer).toHaveProperty("forecast");
    expect(answer).not.toHaveProperty("result");
  });

  test("an odds request (it has no kind) still gets the odds answer, as before", () => {
    const answer = answerWorkerRequest({ id: 3, state: round16, params: quick });
    expect(answer).toHaveProperty("result");
    expect(answer).not.toHaveProperty("forecast");
    expect(answer.id).toBe(3);
  });

  test("an odds request that fails still comes back as an error, not an exception", () => {
    const answer = answerWorkerRequest({ id: 5, state: round16, params: { nSims: 0 } });
    expect(answer).toHaveProperty("error");
  });
});

describe("the forecast state", () => {
  const data = (answerForecastRequest({ id: 1, kind: "forecast", state: withGrid("openf1"), params: quick }) as any).forecast as ForecastData;
  const ready = (id: number, forecast = data): ForecastResponse => ({ id, forecast, ms: 10 });
  const ofState = (over: Partial<ForecastState> = {}): ForecastState => ({ ...initialForecastState, ...over });

  test("starts idle with nothing", () => {
    expect(initialForecastState).toEqual({ status: "idle", forecast: null, error: null, durationMs: null });
  });

  test("a new calculation is marked at once; marking again changes nothing", () => {
    const calculating = markForecastCalculating(initialForecastState);
    expect(calculating.status).toBe("calculating");
    expect(markForecastCalculating(calculating)).toBe(calculating);
  });

  test("the previous forecast stays while a new one is calculated", () => {
    const calculating = markForecastCalculating(ofState({ status: "ready", forecast: data }));
    expect(calculating.forecast).toBe(data);
  });

  test("the answer to the newest request is used", () => {
    const state = applyForecastResponse(markForecastCalculating(initialForecastState), ready(7), 7);
    expect(state).toEqual({ status: "ready", forecast: data, error: null, durationMs: 10 });
  });

  test("an answer to an older request changes nothing (stale response)", () => {
    const calculating = markForecastCalculating(ofState({ status: "ready", forecast: data }));
    expect(applyForecastResponse(calculating, ready(6), 7)).toBe(calculating);
    expect(applyForecastResponse(calculating, { id: 6, error: "x" }, 7)).toBe(calculating);
  });

  test("an error answer to the newest request keeps the last good forecast and reports the problem", () => {
    const calculating = markForecastCalculating(ofState({ status: "ready", forecast: data, durationMs: 5 }));
    const failed = applyForecastResponse(calculating, { id: 8, error: "nSims must be a whole number" }, 8);
    expect(failed).toMatchObject({ status: "error", error: "nSims must be a whole number", forecast: data });
  });

  test("a worker that cannot start is an error too, and a new calculation clears it", () => {
    const failed = failForecast(initialForecastState, "This browser could not start the background calculation.");
    expect(failed).toMatchObject({ status: "error", error: "This browser could not start the background calculation." });
    expect(markForecastCalculating(failed)).toMatchObject({ status: "calculating", error: null });
  });

  test("nothing to calculate: idle, error cleared, the same object when already idle", () => {
    expect(markForecastIdle(initialForecastState)).toBe(initialForecastState);
    expect(markForecastIdle(failForecast(initialForecastState, "x"))).toMatchObject({ status: "idle", error: null });
  });

  test("the request ids work with the same tracker as the odds: only the latest is current", () => {
    // Out-of-order answers: 1 is slow, 2 is fast. Applying 2 then 1 must leave 2's result.
    const first = markForecastCalculating(initialForecastState);
    const two = applyForecastResponse(first, ready(2), 2);
    const late = applyForecastResponse(two, ready(1, { ...data, nSims: 1 }), 2);
    expect(late).toBe(two);
    expect(late.forecast!.nSims).toBe(data.nSims);
  });
});
