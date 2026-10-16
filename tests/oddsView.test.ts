/**
 * Phase 3 Step 9: the "Likely?" panel's view-model (DESIGN.md sections 6 and 8). Pure.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeOdds, formatProbability, type OddsResult, type OddsRow, type SeasonState } from "../engine";
import { ODDS_BANDS } from "../web/config";
import {
  barWidth,
  buildOddsView,
  combineOddsStates,
  formWeightFor,
  formatPpDelta,
  oddsErrorCopy,
  probabilityBand,
  probabilityDelta,
  shownProbability,
  snapFormPercent,
  whatIfNote,
} from "../web/viewModel/odds";
import { failOdds, initialOddsState, markCalculating, type OddsState } from "../web/viewModel/oddsRequests";
import { makeState } from "./helpers";

const fixture = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "season-2026-r16.json"), "utf8")) as SeasonState;
const teams4 = { red: ["AAA", "BBB"], blue: ["CCC", "DDD"] };
const order4 = ["AAA", "BBB", "CCC", "DDD"];
const races = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${i + 1}:race`, order4])) as Record<`${number}:race`, string[]>;
const FAST = { nSims: 400, seed: 1 };

/** A hand-made odds result, for cases the engine would not produce on demand. */
function fakeOdds(wdc: Partial<OddsRow>[], extra: Partial<OddsResult> = {}, wcc: Partial<OddsRow>[] = []): OddsResult {
  const row = (r: Partial<OddsRow>): OddsRow => {
    const probability = r.probability ?? 0.5;
    return { id: "X", wins: probability * 1000, probability, display: formatProbability(probability), avgPoints: 100, ...r };
  };
  return {
    asOfRound: 8, roundsCompleted: 8, lowConfidence: false, nSims: 1000, seed: 1,
    modelVersion: "v2", gridKnownRound: null, params: {} as OddsResult["params"], wdc: wdc.map(row), wcc: wcc.map(row), maxStdError: 0.01, ...extra,
  };
}

// ---------- bands and bar width ----------

describe("probabilityBand", () => {
  test("at least 50% is green, 10 to under 50% is yellow, under 10% is orange", () => {
    expect(probabilityBand(0.9)).toBe("green");
    expect(probabilityBand(0.5)).toBe("green");
    expect(probabilityBand(0.49)).toBe("yellow");
    expect(probabilityBand(0.1)).toBe("yellow");
    expect(probabilityBand(0.09)).toBe("orange");
    expect(probabilityBand(0)).toBe("orange");
  });

  test("the color follows the number the reader sees, so two rows that both read 50% share a color", () => {
    // 49.6% and 50.4% are both shown as "50%"
    expect(probabilityBand(0.496)).toBe("green");
    expect(probabilityBand(0.504)).toBe("green");
    expect(probabilityBand(0.494)).toBe("yellow"); // shown as "49%"
    // 9.96% is shown as "10%", 9.4% as "9.4%"
    expect(probabilityBand(0.0996)).toBe("yellow");
    expect(probabilityBand(0.094)).toBe("orange");
    // under 1% and over 99% are shown as such
    expect(probabilityBand(0.0099)).toBe("orange");
    expect(probabilityBand(0.9901)).toBe("green");
  });

  test("shownProbability is the probability after the rounding the text does", () => {
    expect(shownProbability(0.496)).toBeCloseTo(0.5, 12);
    expect(shownProbability(0.0345)).toBeCloseTo(0.035, 12);
    expect(shownProbability(0.004)).toBe(0);
    expect(shownProbability(0.999)).toBe(1);
  });

  test("the limits are configurable", () => {
    expect(probabilityBand(0.3, { green: 0.25, yellow: 0.05 })).toBe("green");
    expect(probabilityBand(0.06, { green: 0.25, yellow: 0.05 })).toBe("yellow");
    expect(ODDS_BANDS).toEqual({ green: 0.5, yellow: 0.1 });
  });
});

describe("barWidth", () => {
  test("is the probability in percent, but never an empty or a full bar", () => {
    expect(barWidth(0.47)).toBe(47);
    expect(barWidth(0)).toBe(1);
    expect(barWidth(0.004)).toBe(1);
    expect(barWidth(1)).toBe(99);
    expect(barWidth(0.999)).toBe(99);
  });
});

// ---------- delta in percentage points ----------

describe("formatPpDelta", () => {
  test("up, down and no change, with an arrow and a number so color is never the only signal", () => {
    expect(formatPpDelta(12)).toMatchObject({ text: "▲ 12 pp", tone: "up" });
    expect(formatPpDelta(-8)).toMatchObject({ text: "▼ 8 pp", tone: "down" });
    expect(formatPpDelta(0)).toMatchObject({ text: "●", tone: "none" });
  });

  test("rounds to whole points, and a change that rounds to nothing is no change", () => {
    expect(formatPpDelta(11.6).text).toBe("▲ 12 pp");
    expect(formatPpDelta(-7.5).text).toBe("▼ 8 pp");
    expect(formatPpDelta(0.4)).toMatchObject({ text: "●", tone: "none" });
    expect(formatPpDelta(-0.4)).toMatchObject({ text: "●", tone: "none" });
  });

  test("a change smaller than the sampling noise is no change", () => {
    expect(formatPpDelta(1.2, 1.4).text).toBe("●");
    expect(formatPpDelta(-1.2, 1.4).text).toBe("●");
    expect(formatPpDelta(2, 1.4).text).toBe("▲ 2 pp");
  });

  test("describes itself in words for screen readers", () => {
    expect(formatPpDelta(12).description).toBe("Up 12 percentage points compared with no locks");
    expect(formatPpDelta(-1).description).toBe("Down 1 percentage point compared with no locks");
    expect(formatPpDelta(0).description).toBe("No clear change compared with no locks");
  });
});

describe("probabilityDelta", () => {
  test("is the difference in percentage points", () => {
    expect(probabilityDelta(0.6, 0.48, 10_000).text).toBe("▲ 12 pp");
    expect(probabilityDelta(0.2, 0.28, 10_000).text).toBe("▼ 8 pp");
  });

  test("two estimates of the same thing differ by noise: a gap of one point at 10,000 simulations is not a change", () => {
    expect(probabilityDelta(0.51, 0.5, 10_000).text).toBe("●");
    expect(probabilityDelta(0.5, 0.51, 10_000).text).toBe("●");
  });

  test("with fewer simulations the noise is bigger", () => {
    expect(probabilityDelta(0.56, 0.5, 10_000).text).toBe("▲ 6 pp");
    expect(probabilityDelta(0.56, 0.5, 300).text).toBe("●");
  });

  test("a certain outcome against a certain outcome is no change", () => {
    expect(probabilityDelta(1, 1, 10_000).text).toBe("●");
    expect(probabilityDelta(0, 0, 10_000).text).toBe("●");
  });

  test("when the shown value does not change, there is no change to show: <1% to <1%, >99% to >99%", () => {
    expect(probabilityDelta(0.009, 0.0003, 10_000).text).toBe("●"); // both read "<1%", though 0.9 points apart
    expect(probabilityDelta(0.9905, 0.999, 10_000).text).toBe("●"); // both read ">99%"
    expect(probabilityDelta(0.012, 0.009, 10_000).text).toBe("●"); // "1.2%" against "<1%": too small to matter anyway
  });

  test("a move out of the extreme band is shown", () => {
    expect(probabilityDelta(0.05, 0.004, 10_000)).toMatchObject({ text: "▲ 5 pp", tone: "up" });
    expect(probabilityDelta(0.779, 0.999, 10_000)).toMatchObject({ text: "▼ 22 pp", tone: "down" });
  });

  test("a driver who goes from under 1% to a real chance shows the gain", () => {
    expect(probabilityDelta(0.17, 0.004, 10_000)).toMatchObject({ text: "▲ 17 pp", tone: "up" });
  });
});

// ---------- the form-weight slider ----------

describe("form weight slider", () => {
  test("snaps to steps of 10% between 0 and 100", () => {
    expect(snapFormPercent(47)).toBe(50);
    expect(snapFormPercent(44)).toBe(40);
    expect(snapFormPercent(-5)).toBe(0);
    expect(snapFormPercent(130)).toBe(100);
    expect(snapFormPercent(Number.NaN)).toBe(100);
    expect(snapFormPercent(100)).toBe(100);
    expect(snapFormPercent(0)).toBe(0);
  });

  test("slider values become formWeight for the model", () => {
    expect(formWeightFor(100)).toBe(1);
    expect(formWeightFor(50)).toBe(0.5);
    expect(formWeightFor(0)).toBe(0);
    expect(formWeightFor(37)).toBe(0.4);
    expect(formWeightFor(300)).toBe(1);
  });

  test("says it is a what-if when the weight is not 100%", () => {
    expect(whatIfNote(100)).toBeNull();
    expect(whatIfNote(50)).toBe("What-if: form weight 50%.");
    expect(whatIfNote(0)).toBe("What-if: form weight 0%.");
    expect(whatIfNote(47)).toBe("What-if: form weight 50%.");
  });
});

// ---------- the states ----------

describe("oddsErrorCopy", () => {
  test("says what failed and how to fix it, and never apologises", () => {
    for (const kind of ["invalid_scenario", "failed", null] as const) {
      const copy = oddsErrorCopy(kind);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.body.length).toBeGreaterThan(0);
      expect(`${copy.title} ${copy.body}`.toLowerCase()).not.toMatch(/sorry|oops|unfortunately/);
    }
    expect(oddsErrorCopy("invalid_scenario").body).toMatch(/reset|unlock/i);
    expect(oddsErrorCopy("failed").body).toMatch(/reload/i);
    expect(oddsErrorCopy(null)).toEqual(oddsErrorCopy("failed"));
  });
});

describe("combineOddsStates", () => {
  const result = computeOdds(makeState({ rounds: 6, completed: 4, teams: teams4, results: races(4) }), undefined, FAST);
  const ready = (r: OddsResult): OddsState => ({ status: "ready", result: r, error: null, errorKind: null, durationMs: 5 });

  test("nothing yet is idle", () => {
    expect(combineOddsStates(initialOddsState, null)).toMatchObject({ status: "idle", result: null, base: null });
  });

  test("ready when the odds are ready, with the base for the deltas", () => {
    const base = computeOdds(makeState({ rounds: 6, completed: 4, teams: teams4, results: races(4) }), undefined, { ...FAST, seed: 2 });
    expect(combineOddsStates(ready(result), null)).toMatchObject({ status: "ready", result, base: null });
    expect(combineOddsStates(ready(result), ready(base))).toMatchObject({ status: "ready", result, base });
  });

  test("calculating keeps the previous result, so it can be shown dimmed", () => {
    const calc = markCalculating(ready(result));
    expect(combineOddsStates(calc, null)).toMatchObject({ status: "calculating", result });
  });

  test("calculating when only the base is being recalculated", () => {
    expect(combineOddsStates(ready(result), markCalculating(ready(result))).status).toBe("calculating");
  });

  test("an error in the odds is an error, and carries its kind", () => {
    const failed = failOdds(ready(result), "x", "invalid_scenario");
    expect(combineOddsStates(failed, null)).toMatchObject({ status: "error", errorKind: "invalid_scenario", result });
  });

  test("an error only in the base leaves the odds ready, without deltas", () => {
    const baseFailed = failOdds(initialOddsState, "x", "failed");
    expect(combineOddsStates(ready(result), baseFailed)).toMatchObject({ status: "ready", base: null });
  });
});

// ---------- the view ----------

describe("buildOddsView: header and honesty", () => {
  const state = makeState({ rounds: 6, completed: 4, teams: teams4, results: races(4) });
  const odds = computeOdds(state, undefined, FAST);
  const view = buildOddsView({ result: odds, base: null, state, table: "wdc", formPercent: 100, hasLocks: false });

  test("says it is a model estimate and as of which round", () => {
    expect(view.estimateLabel).toBe("Model estimate");
    expect(view.asOf).toBe("as of Round 4");
  });

  test("explains how it works, with the real number of simulated seasons", () => {
    expect(view.howItWorks).toContain("this season's results");
    expect(view.howItWorks).toContain("where drivers finish and how often they retire");
    expect(view.howItWorks).toContain("It does not know about upgrades, tracks or weather.");
    expect(view.howItWorks).toContain("400 simulated seasons");
    expect(view.howItWorks).toContain("Drivers you did not set in a locked session still race.");
    const big = buildOddsView({ result: computeOdds(state, undefined, { nSims: 10_000, seed: 1 }), base: null, state, table: "wdc", formPercent: 100, hasLocks: false });
    expect(big.howItWorks).toContain("10,000 simulated seasons");
  });

  test("no what-if note at full form weight, one otherwise", () => {
    expect(view.whatIf).toBeNull();
    expect(buildOddsView({ result: odds, base: null, state, table: "wdc", formPercent: 60, hasLocks: false }).whatIf).toBe("What-if: form weight 60%.");
  });

  test("no scenario note and no deltas without locks", () => {
    expect(view.scenarioNote).toBeNull();
    expect(view.rows.every((r) => r.delta === null)).toBe(true);
  });
});

describe("buildOddsView: low confidence", () => {
  const at = (completed: number) => {
    const state = makeState({ rounds: 8, completed, teams: teams4, results: races(completed) });
    return buildOddsView({ result: computeOdds(state, undefined, FAST), base: null, state, table: "wdc", formPercent: 100, hasLocks: false });
  };

  test("a tag and a sentence while fewer than 5 rounds are complete", () => {
    const view = at(3);
    expect(view.lowConfidence).toEqual({ tag: "Low confidence", note: "Fewer than 5 rounds are complete, so these numbers can move a lot." });
  });

  test("none from 5 rounds on", () => {
    expect(at(5).lowConfidence).toBeNull();
  });
});

describe("buildOddsView: which drivers are listed", () => {
  test("only drivers who are still alive get a bar; the rest are counted in words", () => {
    // AAA 100, BBB 72, CCC 60, DDD 48 with two races left: DDD can no longer win
    const state = makeState({ rounds: 6, completed: 4, teams: teams4, results: races(4) });
    const view = buildOddsView({ result: computeOdds(state, undefined, FAST), base: null, state, table: "wdc", formPercent: 100, hasLocks: false });
    expect(view.rows.map((r) => r.id).sort()).toEqual(["AAA", "BBB", "CCC"]);
    expect(view.outLine).toBe("1 driver is out of the title fight.");
    expect(view.clinched).toEqual([]);
  });

  test("the count uses the plural", () => {
    const state = makeState({ rounds: 6, completed: 5, teams: teams4, results: races(5) });
    const odds = computeOdds(state, undefined, FAST);
    // after five races only AAA is left: three drivers out
    expect(buildOddsView({ result: odds, base: null, state, table: "wdc", formPercent: 100, hasLocks: false }).outLine).toBe("3 drivers are out of the title fight.");
  });

  test("a clinched driver is stated in words, with no bar and no percentage", () => {
    const state = makeState({ rounds: 6, completed: 5, teams: teams4, results: races(5) });
    const view = buildOddsView({ result: computeOdds(state, undefined, FAST), base: null, state, table: "wdc", formPercent: 100, hasLocks: false });
    const name = state.drivers.find((d) => d.code === "AAA")!.name;
    expect(view.clinched).toEqual([`${name} has clinched the title.`]);
    expect(view.rows).toEqual([]);
  });

  test("no sentence about drivers being out when nobody is", () => {
    const state = makeState({ rounds: 6, completed: 1, teams: teams4, results: races(1) });
    const view = buildOddsView({ result: computeOdds(state, undefined, FAST), base: null, state, table: "wdc", formPercent: 100, hasLocks: false });
    expect(view.rows).toHaveLength(4);
    expect(view.outLine).toBeNull();
  });

  test("on the real data: ANT is far ahead, and the eliminated drivers are not listed", () => {
    const odds = computeOdds(fixture, undefined, { nSims: 2000, seed: 1 });
    const view = buildOddsView({ result: odds, base: null, state: fixture, table: "wdc", formPercent: 100, hasLocks: false });
    expect(view.rows[0]).toMatchObject({ id: "ANT", display: ">99%", band: "green" });
    expect(view.rows.map((r) => r.id).sort()).toEqual(["ANT", "HAM", "LEC", "NOR", "RUS", "VER"]);
    expect(view.rows.map((r) => r.id)).not.toContain("TSU");
    expect(view.outLine).toBe(`${fixture.drivers.length - 6} drivers are out of the title fight.`);
  });

  test("a row has a title, a name, a display that is never 0% or 100%, a band and a bar width", () => {
    const odds = fakeOdds([
      { id: "AAA", probability: 1, status: "alive" },
      { id: "BBB", probability: 0, status: "alive" },
      { id: "CCC", probability: 0.347, status: "alive" },
    ]);
    const state = makeState({ rounds: 6, completed: 4, teams: teams4, results: races(4) });
    const view = buildOddsView({ result: odds, base: null, state, table: "wdc", formPercent: 100, hasLocks: false });
    expect(view.rows.map((r) => r.display)).toEqual([">99%", "<1%", "35%"]);
    expect(view.rows.map((r) => r.band)).toEqual(["green", "orange", "yellow"]);
    expect(view.rows.map((r) => r.widthPercent)).toEqual([99, 1, 35]);
    for (const r of view.rows) expect(["0%", "100%"]).not.toContain(r.display);
    expect(view.rows[0]).toMatchObject({ title: "AAA", subtitle: state.drivers.find((d) => d.code === "AAA")!.name });
  });
});

describe("buildOddsView: change against the odds without locks", () => {
  const state = makeState({ rounds: 6, completed: 4, teams: teams4, results: races(4) });
  const base = fakeOdds([
    { id: "AAA", probability: 0.6, status: "alive" },
    { id: "BBB", probability: 0.3, status: "alive" },
    { id: "CCC", probability: 0.1, status: "alive" },
  ], { nSims: 10_000 });
  const current = fakeOdds([
    { id: "BBB", probability: 0.42, status: "alive" },
    { id: "AAA", probability: 0.46, status: "alive" },
    { id: "CCC", probability: 0.1005, status: "alive" },
    { id: "DDD", probability: 0.0201, status: "alive" },
  ], { nSims: 10_000 });
  const view = buildOddsView({ result: current, base, state, table: "wdc", formPercent: 100, hasLocks: true });

  test("every row shows the change in percentage points against the base", () => {
    const by = new Map(view.rows.map((r) => [r.id, r.delta]));
    expect(by.get("AAA")).toMatchObject({ text: "▼ 14 pp", tone: "down" });
    expect(by.get("BBB")).toMatchObject({ text: "▲ 12 pp", tone: "up" });
    expect(by.get("CCC")).toMatchObject({ text: "●", tone: "none" });
  });

  test("a driver who was not in the base table counts from 0", () => {
    expect(view.rows.find((r) => r.id === "DDD")!.delta).toMatchObject({ text: "▲ 2 pp", tone: "up" });
  });

  test("says what the change is measured against", () => {
    expect(view.scenarioNote).toBe("With your locked results. The change is against the odds with nothing locked.");
  });

  test("with locks but no base result yet, there are no deltas and no claim about them", () => {
    const noBase = buildOddsView({ result: current, base: null, state, table: "wdc", formPercent: 100, hasLocks: true });
    expect(noBase.rows.every((r) => r.delta === null)).toBe(true);
    expect(noBase.scenarioNote).toBe("With your locked results.");
  });
});

describe("buildOddsView: teams", () => {
  const state = makeState({ rounds: 6, completed: 4, teams: teams4, results: races(4) });
  const odds = computeOdds(state, undefined, FAST);
  const view = buildOddsView({ result: odds, base: null, state, table: "wcc", formPercent: 100, hasLocks: false });

  test("lists the teams that can win, by name, with no sentence about drivers", () => {
    expect(view.rows.length).toBeGreaterThan(0);
    for (const r of view.rows) {
      expect(r.title).toBe(state.teams.find((t) => t.id === r.id)!.name);
      expect(r.subtitle).toBeNull();
    }
    expect(view.outLine).toBeNull();
    expect(view.clinched).toEqual([]);
  });

  test("says who is listed", () => {
    expect(view.tableNote).toBe("Only teams that won at least one simulated season are listed.");
  });

  test("the drivers' table has no such note", () => {
    expect(buildOddsView({ result: odds, base: null, state, table: "wdc", formPercent: 100, hasLocks: false }).tableNote).toBeNull();
  });

  test("team rows get deltas too when locks are on", () => {
    const view2 = buildOddsView({ result: odds, base: odds, state, table: "wcc", formPercent: 100, hasLocks: true });
    expect(view2.rows.every((r) => r.delta !== null)).toBe(true);
  });
});

// ---------- the grid tag (Phase 4, Step 8) ----------

describe("buildOddsView: grid known", () => {
  const view = (extra: Partial<OddsResult>) =>
    buildOddsView({ result: fakeOdds([{ id: "AAA", status: "alive" }], extra), base: null, state: fixture, table: "wdc", formPercent: 100, hasLocks: false });

  test("says which round's real grid the model used", () => {
    expect(view({ gridKnownRound: 17 }).gridKnown).toEqual({ tag: "Grid known: Round 17" });
  });

  test("has no tag when the model used no real grid", () => {
    expect(view({ gridKnownRound: null }).gridKnown).toBeNull();
  });
});
