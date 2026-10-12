/**
 * Phase 3 Step 8: the request protocol between the UI and the odds worker. Pure logic, no Worker and no React.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeOdds, type Scenario, type SeasonState } from "../engine";
import {
  OddsRequestTracker,
  answerOddsRequest,
  applyOddsResponse,
  failOdds,
  initialOddsState,
  markCalculating,
  markIdle,
  type OddsRequest,
  type OddsResponse,
  type OddsState,
} from "../web/viewModel/oddsRequests";

const state = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "season-2026-r16.json"), "utf8")) as SeasonState;
const FAST = { nSims: 300, seed: 1 };
const request = (id: number, extra: Partial<OddsRequest> = {}): OddsRequest => ({ id, state, params: FAST, ...extra });
const ok = (id: number) => answerOddsRequest(request(id)) as Extract<OddsResponse, { result: unknown }>;

// ---------- which request is the latest ----------

describe("OddsRequestTracker", () => {
  test("every request gets a new, higher id", () => {
    const t = new OddsRequestTracker();
    const ids = [t.issue(), t.issue(), t.issue()];
    expect(ids[1]).toBeGreaterThan(ids[0]!);
    expect(ids[2]).toBeGreaterThan(ids[1]!);
    expect(t.latestId).toBe(ids[2]!);
  });

  test("only the latest id is current", () => {
    const t = new OddsRequestTracker();
    const a = t.issue();
    expect(t.isCurrent(a)).toBe(true);
    const b = t.issue();
    expect(t.isCurrent(a)).toBe(false);
    expect(t.isCurrent(b)).toBe(true);
  });

  test("invalidate makes every request so far out of date, and a new one is still possible", () => {
    const t = new OddsRequestTracker();
    const a = t.issue();
    t.invalidate();
    expect(t.isCurrent(a)).toBe(false);
    expect(t.isCurrent(t.issue())).toBe(true);
  });

  test("nothing is current before the first request", () => {
    expect(new OddsRequestTracker().isCurrent(0)).toBe(false);
  });
});

// ---------- the state the UI shows ----------

describe("odds state", () => {
  const result = ok(1).result;

  test("starts idle with nothing to show", () => {
    expect(initialOddsState).toEqual({ status: "idle", result: null, error: null, errorKind: null, durationMs: null });
  });

  test("calculating keeps the previous result so it can be shown dimmed", () => {
    const ready = applyOddsResponse(initialOddsState, { id: 1, result, ms: 12 }, 1);
    const next = markCalculating(ready);
    expect(next.status).toBe("calculating");
    expect(next.result).toBe(result);
    expect(next.durationMs).toBe(12);
  });

  test("marking calculating twice returns the same object, so nothing re-renders", () => {
    const once = markCalculating(initialOddsState);
    expect(markCalculating(once)).toBe(once);
  });

  test("going idle keeps the previous result", () => {
    const ready = applyOddsResponse(initialOddsState, { id: 1, result, ms: 5 }, 1);
    expect(markIdle(ready)).toMatchObject({ status: "idle", result });
    expect(markIdle(initialOddsState)).toBe(initialOddsState);
  });

  test("a current result makes the state ready and clears an old error", () => {
    const failed = failOdds(initialOddsState, "boom", "failed");
    const ready = applyOddsResponse(markCalculating(failed), { id: 4, result, ms: 7 }, 4);
    expect(ready).toEqual({ status: "ready", result, error: null, errorKind: null, durationMs: 7 });
  });

  test("an error is reported, and the previous result stays available", () => {
    const ready = applyOddsResponse(initialOddsState, { id: 1, result, ms: 5 }, 1);
    const after = applyOddsResponse(markCalculating(ready), { id: 2, error: "No longer fits", kind: "invalid_scenario" }, 2);
    expect(after.status).toBe("error");
    expect(after.error).toBe("No longer fits");
    expect(after.errorKind).toBe("invalid_scenario");
    expect(after.result).toBe(result);
  });

  test("calculating again after an error clears the error but keeps the old result", () => {
    const ready = applyOddsResponse(initialOddsState, { id: 1, result, ms: 5 }, 1);
    const failed = applyOddsResponse(ready, { id: 2, error: "x", kind: "failed" }, 2);
    const again = markCalculating(failed);
    expect(again).toMatchObject({ status: "calculating", error: null, errorKind: null, result });
  });

  test("failOdds reports a problem that did not come from a request (for example a worker that cannot start)", () => {
    expect(failOdds(initialOddsState, "no worker", "failed")).toMatchObject({ status: "error", error: "no worker", errorKind: "failed" });
  });
});

// ---------- latest request wins, stale responses are dropped ----------

describe("applyOddsResponse", () => {
  const result = ok(1).result;

  test("a response for an older request is dropped: the very same state comes back", () => {
    const calculating = markCalculating(initialOddsState);
    const next = applyOddsResponse(calculating, { id: 1, result, ms: 1 }, 2);
    expect(next).toBe(calculating);
  });

  test("an older error is dropped too", () => {
    const calculating = markCalculating(initialOddsState);
    expect(applyOddsResponse(calculating, { id: 1, error: "old", kind: "failed" }, 2)).toBe(calculating);
  });

  test("answers that arrive out of order: only the newest one counts", () => {
    const tracker = new OddsRequestTracker();
    const first = tracker.issue();
    const second = tracker.issue();
    let s: OddsState = markCalculating(initialOddsState);
    // the answer to the second request arrives first, then the late answer to the first
    s = applyOddsResponse(s, { id: second, result: ok(second).result, ms: 1 }, tracker.latestId);
    const winner = s.result;
    s = applyOddsResponse(s, { id: first, result: ok(first).result, ms: 1 }, tracker.latestId);
    expect(s.status).toBe("ready");
    expect(s.result).toBe(winner);
  });

  test("a response that arrives after the inputs went away is dropped", () => {
    const tracker = new OddsRequestTracker();
    const id = tracker.issue();
    tracker.invalidate();
    const idle = markIdle(markCalculating(initialOddsState));
    expect(applyOddsResponse(idle, { id, result, ms: 1 }, tracker.latestId)).toBe(idle);
  });
});

// ---------- what the worker does with a request ----------

describe("answerOddsRequest", () => {
  test("answers with the same id, the odds and how long it took", () => {
    const res = ok(7);
    expect(res.id).toBe(7);
    expect(res.result.nSims).toBe(300);
    expect(res.ms).toBeGreaterThanOrEqual(0);
  });

  test("gives exactly what computeOdds gives for the same inputs", () => {
    const scenario: Scenario = { locks: { "17:race": { fixed: { NOR: 1 } } } };
    const res = answerOddsRequest(request(1, { scenario })) as Extract<OddsResponse, { result: unknown }>;
    expect(res.result).toEqual(computeOdds(state, scenario, FAST));
  });

  test("the parameters are passed on", () => {
    const res = answerOddsRequest(request(1, { params: { nSims: 123, seed: 9, formWeight: 0.5 } })) as Extract<OddsResponse, { result: unknown }>;
    expect(res.result.nSims).toBe(123);
    expect(res.result.seed).toBe(9);
    expect(res.result.params.formWeight).toBe(0.5);
  });

  test("a request without a scenario or parameters uses the defaults", () => {
    const res = answerOddsRequest({ id: 1, state }) as Extract<OddsResponse, { result: unknown }>;
    expect(res.result.nSims).toBe(10_000);
  });

  test("a scenario that does not fit the season is an error of kind invalid_scenario, not a thrown exception", () => {
    const res = answerOddsRequest(request(3, { scenario: { locks: { "1:race": { fixed: { NOR: 1 } } } } }));
    expect(res).toMatchObject({ id: 3, kind: "invalid_scenario" });
    expect((res as { error: string }).error.length).toBeGreaterThan(0);
  });

  test("nonsense parameters are an error of kind failed", () => {
    const res = answerOddsRequest(request(4, { params: { nSims: 0 } }));
    expect(res).toMatchObject({ id: 4, kind: "failed" });
    expect((res as { error: string }).error).toContain("nSims");
  });

  test("a response survives structured cloning, as postMessage requires", () => {
    const res = ok(5);
    expect(structuredClone(res)).toEqual(res);
    const err = answerOddsRequest(request(6, { params: { nSims: 0 } }));
    expect(structuredClone(err)).toEqual(err);
  });
});
