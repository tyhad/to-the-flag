/**
 * Phase 3 Step 10: the walk-forward backtest (scripts/backtest.ts). The pieces are pure and tested here;
 * the script itself only prints them.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLIP,
  FIRST_TEST_ROUND,
  MATERIAL_DIFFERENCE,
  RELIABILITY_EDGES,
  brierScore,
  clipProbability,
  compareCells,
  compareMethods,
  formatReport,
  logLoss,
  outcomeOf,
  pairsOf,
  pointsForecast,
  reliability,
  runGrid,
  scoreMethod,
  stateBefore,
  uniformForecast,
  walkForward,
  type Pair,
} from "../scripts/backtest";
import type { SeasonState } from "../engine/types";
import { defaultOddsParams } from "../engine/simulate";
import { makeState } from "./helpers";

const real = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "season-2026-r16.json"), "utf8")) as SeasonState;
const sum = (xs: Iterable<number>) => [...xs].reduce((a, b) => a + b, 0);
const teams4 = { red: ["AAA", "BBB"], blue: ["CCC", "DDD"] };

// ---------- looking only at the past ----------

describe("stateBefore", () => {
  test("keeps only the rounds before the given one, and says so", () => {
    const before = stateBefore(real, 10);
    expect(before.asOfRound).toBe(9);
    expect(Math.max(...before.results.map((r) => r.round))).toBe(9);
    expect(Math.max(...before.qualifying.map((q) => q.round))).toBe(9);
    expect(before.rounds.filter((r) => r.status === "completed").length).toBe(9);
    expect(before.rounds.find((r) => r.round === 10)!.status).toBe("scheduled");
    expect(before.results.length).toBeLessThan(real.results.length);
  });

  test("leaves out the sprint of the round itself", () => {
    const round = real.rounds.find((r) => r.hasSprint && r.round >= FIRST_TEST_ROUND)!.round;
    expect(real.results.some((r) => r.round === round && r.kind === "sprint")).toBe(true);
    expect(stateBefore(real, round).results.some((r) => r.round === round)).toBe(false);
  });

  test("a driver is active if he took part in the latest round before", () => {
    const state = makeState({
      rounds: 4, completed: 3, teams: teams4,
      results: { "1:race": ["AAA", "BBB", "CCC", "DDD"], "2:race": ["AAA", "BBB", "CCC", "DDD"], "3:race": ["AAA", "BBB", "CCC"] },
    });
    const before3 = stateBefore(state, 3);
    expect(before3.drivers.filter((d) => d.active).map((d) => d.code).sort()).toEqual(["AAA", "BBB", "CCC", "DDD"]);
    const before4 = stateBefore(state, 4);
    expect(before4.drivers.filter((d) => d.active).map((d) => d.code).sort()).toEqual(["AAA", "BBB", "CCC"]);
  });

  test("does not change the state it is given", () => {
    const frozen = JSON.stringify(real);
    stateBefore(real, 8);
    expect(JSON.stringify(real)).toBe(frozen);
  });
});

describe("outcomeOf", () => {
  test("the field is everyone who started, the winner and the podium are classified finishers", () => {
    const state = makeState({
      rounds: 2, completed: 2, teams: teams4,
      results: { "1:race": ["AAA", "BBB", "CCC", "DDD"], "2:race": { order: ["BBB", "AAA", "CCC", "DDD"], dnf: ["AAA", "DDD"] } },
    });
    const o = outcomeOf(state, 2)!;
    expect(o.field.sort()).toEqual(["AAA", "BBB", "CCC", "DDD"]);
    expect(o.winner).toBe("BBB");
    expect(o.podium.sort()).toEqual(["BBB", "CCC"]); // AAA was second on the road but did not finish
  });

  test("a round without a race has no outcome", () => {
    expect(outcomeOf(real, 99)).toBeNull();
  });

  test("on the real data every test race has a winner and three on the podium", () => {
    for (let round = FIRST_TEST_ROUND; round <= real.asOfRound; round++) {
      const o = outcomeOf(real, round)!;
      expect(o.winner).not.toBeNull();
      expect(o.podium).toHaveLength(3);
      expect(o.podium).toContain(o.winner!);
    }
  });
});

// ---------- the baselines ----------

describe("baselines", () => {
  test("uniform: 1/n to win and 3/n to be on the podium", () => {
    const f = uniformForecast(["A", "B", "C", "D", "E", "F"]);
    expect(f.win.A).toBeCloseTo(1 / 6, 12);
    expect(f.podium.A).toBeCloseTo(0.5, 12);
    expect(sum(Object.values(f.win))).toBeCloseTo(1, 12);
    expect(sum(Object.values(f.podium))).toBeCloseTo(3, 12);
  });

  test("uniform: a small field cannot have podium chances above 1", () => {
    expect(uniformForecast(["A", "B"]).podium.A).toBe(1);
  });

  test("points so far: proportional to points among the field, none for a driver with no points", () => {
    const state = makeState({
      rounds: 3, completed: 2, teams: teams4,
      results: { "1:race": ["AAA", "BBB", "CCC", "DDD"], "2:race": ["AAA", "BBB", "CCC", "DDD"] },
    });
    const points = { AAA: 50, BBB: 36, CCC: 30, DDD: 24 };
    const total = sum(Object.values(points));
    const f = pointsForecast(state, ["AAA", "BBB", "CCC", "DDD", "NEW"]);
    expect(f.win.AAA).toBeCloseTo(points.AAA / total, 12);
    expect(f.win.NEW).toBe(0);
    expect(sum(Object.values(f.win))).toBeCloseTo(1, 12);
    expect(f.podium.AAA).toBeCloseTo(Math.min(1, (3 * points.AAA) / total), 12);
    expect(f.podium.AAA).toBeLessThanOrEqual(1);
  });

  test("points so far: with no points yet it falls back to uniform", () => {
    const empty = makeState({ rounds: 3, teams: teams4 });
    expect(pointsForecast(empty, ["AAA", "BBB"]).win.AAA).toBeCloseTo(0.5, 12);
  });
});

// ---------- the scores ----------

describe("scores", () => {
  test("clipping keeps probabilities away from 0 and 1", () => {
    expect(clipProbability(0)).toBe(CLIP);
    expect(clipProbability(1)).toBe(1 - CLIP);
    expect(clipProbability(0.3)).toBe(0.3);
  });

  test("log loss is the mean of -ln p for what happened", () => {
    const pairs: Pair[] = [{ p: 0.8, y: 1 }, { p: 0.3, y: 0 }];
    expect(logLoss(pairs)).toBeCloseTo(-(Math.log(0.8) + Math.log(0.7)) / 2, 12);
  });

  test("Brier score is the mean squared error", () => {
    const pairs: Pair[] = [{ p: 0.8, y: 1 }, { p: 0.3, y: 0 }];
    expect(brierScore(pairs)).toBeCloseTo((0.2 ** 2 + 0.3 ** 2) / 2, 12);
  });

  test("a confident wrong forecast costs a lot but stays finite", () => {
    const loss = logLoss([{ p: 0, y: 1 }]);
    expect(Number.isFinite(loss)).toBe(true);
    expect(loss).toBeCloseTo(-Math.log(CLIP), 12);
  });

  test("a better forecast scores better on both", () => {
    const sharp: Pair[] = [{ p: 0.9, y: 1 }, { p: 0.1, y: 0 }];
    const vague: Pair[] = [{ p: 0.6, y: 1 }, { p: 0.4, y: 0 }];
    expect(logLoss(sharp)).toBeLessThan(logLoss(vague));
    expect(brierScore(sharp)).toBeLessThan(brierScore(vague));
  });

  test("nothing to score is an error, not NaN", () => {
    expect(() => logLoss([])).toThrow(RangeError);
    expect(() => brierScore([])).toThrow(RangeError);
  });
});

describe("reliability", () => {
  test("every pair lands in exactly one bin, and the last bin includes 1", () => {
    const pairs: Pair[] = [0, 0.02, 0.05, 0.0999, 0.1, 0.39, 0.4, 0.69, 0.7, 1].map((p) => ({ p, y: 0 }));
    const bins = reliability(pairs);
    expect(sum(bins.map((b) => b.n))).toBe(pairs.length);
    // [0, .05): 0 and .02   [.05, .10): .05 and .0999   [.10, .20): .1   [.20, .40): .39   [.40, .70): .4 and .69   [.70, 1]: .7 and 1
    expect(bins.map((b) => b.n)).toEqual([2, 2, 1, 1, 2, 2]);
    expect(RELIABILITY_EDGES[0]).toBe(0);
    expect(RELIABILITY_EDGES.at(-1)).toBe(1);
  });

  test("reports the mean predicted and the observed share in each bin", () => {
    const pairs: Pair[] = [
      { p: 0.02, y: 0 }, { p: 0.04, y: 1 }, // bin 0: mean 0.03, observed 0.5
      { p: 0.5, y: 1 }, { p: 0.6, y: 1 }, { p: 0.5, y: 0 }, // bin [0.40, 0.70): mean 0.5333, observed 2/3
    ];
    const bins = reliability(pairs);
    expect(bins[0]).toMatchObject({ n: 2 });
    expect(bins[0]!.meanPredicted).toBeCloseTo(0.03, 12);
    expect(bins[0]!.observed).toBeCloseTo(0.5, 12);
    const mid = bins.find((b) => b.from === 0.4)!;
    expect(mid.meanPredicted).toBeCloseTo((0.5 + 0.6 + 0.5) / 3, 12);
    expect(mid.observed).toBeCloseTo(2 / 3, 12);
  });

  test("an empty bin has no numbers rather than zeros", () => {
    const bins = reliability([{ p: 0.5, y: 1 }]);
    const empty = bins.find((b) => b.n === 0)!;
    expect(empty.meanPredicted).toBeNull();
    expect(empty.observed).toBeNull();
  });
});

// ---------- walking forward ----------

describe("walkForward", () => {
  const params = { nSims: 1500 };
  const records = walkForward(real, params);

  test("one record per race from round 6 to the last completed round", () => {
    expect(records.map((r) => r.round)).toEqual(Array.from({ length: real.asOfRound - FIRST_TEST_ROUND + 1 }, (_, i) => FIRST_TEST_ROUND + i));
    expect(records).toHaveLength(11);
  });

  test("each record has the model and both baselines, for the drivers who started", () => {
    for (const r of records) {
      for (const method of ["model", "uniform", "points"] as const) {
        expect(Object.keys(r.forecasts[method].win).sort()).toEqual([...r.outcome.field].sort());
        expect(Object.keys(r.forecasts[method].podium).sort()).toEqual([...r.outcome.field].sort());
      }
      expect(r.outcome.field).toContain(r.outcome.winner!);
    }
  });

  test("is reproducible", () => {
    expect(walkForward(real, params)).toEqual(records);
  });

  test("never uses the future: changing what happened from round r on leaves the forecast for round r unchanged", () => {
    const round = 9;
    const tampered: SeasonState = {
      ...real,
      results: real.results.map((r) => (r.round >= round ? { ...r, position: 23 - r.position, points: 0 } : r)),
    };
    const a = walkForward(real, params).find((r) => r.round === round)!;
    const b = walkForward(tampered, params).find((r) => r.round === round)!;
    expect(b.forecasts.model).toEqual(a.forecasts.model);
    expect(b.forecasts.points).toEqual(a.forecasts.points);
  });

  test("every race has its own fixed seed, the same for every setting, so settings are compared on the same noise", () => {
    const a = walkForward(real, { nSims: 500, recencyHalfLife: 4 });
    const b = walkForward(real, { nSims: 500, recencyHalfLife: 16, priorStrength: 0.5 });
    expect(a.map((r) => r.seed)).toEqual(b.map((r) => r.seed));
    expect(new Set(a.map((r) => r.seed)).size).toBe(a.length); // but each race has a different one
    expect(a.find((r) => r.round === 7)!.forecasts.model).not.toEqual(b.find((r) => r.round === 7)!.forecasts.model);
  });

  test("scores and pairs line up", () => {
    const pairs = pairsOf(records, "model", "win");
    expect(pairs.filter((p) => p.y === 1)).toHaveLength(records.length);
    expect(pairs.length).toBe(sum(records.map((r) => r.outcome.field.length)));
    const s = scoreMethod(records, "model");
    expect(s.winLogLoss).toBeCloseTo(logLoss(pairs), 12);
    expect(s.winBrier).toBeCloseTo(brierScore(pairs), 12);
    expect(s.races).toBe(11);
    expect(s.winnerLogLoss).toBeGreaterThan(0);
  });

  test("the uniform baseline's winner log loss is ln of the field size", () => {
    const s = scoreMethod(records, "uniform");
    const expected = sum(records.map((r) => Math.log(r.outcome.field.length))) / records.length;
    expect(s.winnerLogLoss).toBeCloseTo(expected, 12);
  });

  // The Phase 3 acceptance test: the model has to beat guessing.
  test("the model's log loss is lower than the uniform baseline's, for winners and for podiums", () => {
    const model = scoreMethod(records, "model");
    const uniform = scoreMethod(records, "uniform");
    expect(model.winLogLoss).toBeLessThan(uniform.winLogLoss);
    expect(model.podiumLogLoss).toBeLessThan(uniform.podiumLogLoss);
    expect(model.winBrier).toBeLessThan(uniform.winBrier);
    expect(model.podiumBrier).toBeLessThan(uniform.podiumBrier);
  });
});

// ---------- comparing two forecasts race by race ----------

describe("compareMethods and compareCells", () => {
  const records = walkForward(real, { nSims: 800 });

  test("a method against itself: no difference", () => {
    const c = compareMethods(records, "model", "model");
    expect(c.meanDiff).toBe(0);
    expect(c.se).toBe(0);
    expect(c.clear).toBe(false);
  });

  test("the model against uniform: negative (better), and the reverse is the same size with the other sign", () => {
    const a = compareMethods(records, "model", "uniform");
    const b = compareMethods(records, "uniform", "model");
    expect(a.meanDiff).toBeLessThan(0);
    expect(b.meanDiff).toBeCloseTo(-a.meanDiff, 12);
    expect(b.se).toBeCloseTo(a.se, 12);
    expect(a.clear).toBe(true);
  });

  test("the difference is the mean over races of the per-race loss difference", () => {
    const c = compareMethods(records, "points", "uniform");
    const perRace = records.map((r) => compareMethods([r], "points", "uniform").meanDiff);
    expect(c.meanDiff).toBeCloseTo(perRace.reduce((s, x) => s + x, 0) / perRace.length, 12);
  });

  test("two settings of the model are compared on the same races", () => {
    const other = walkForward(real, { nSims: 800, recencyHalfLife: 4 });
    const c = compareCells(other, records);
    expect(Number.isFinite(c.meanDiff)).toBe(true);
    expect(c.se).toBeGreaterThanOrEqual(0);
  });
});

// ---------- the grid and the report ----------

describe("runGrid and formatReport", () => {
  const grid = { recencyHalfLife: [4, Infinity], priorStrength: [1, 3] };
  const cells = runGrid(real, grid, { nSims: 400 });

  test("one cell for every combination, each with scores", () => {
    expect(cells).toHaveLength(4);
    expect(cells.map((c) => `${c.recencyHalfLife}/${c.priorStrength}`).sort()).toEqual(["4/1", "4/3", "Infinity/1", "Infinity/3"]);
    for (const c of cells) {
      expect(Number.isFinite(c.scores.winLogLoss)).toBe(true);
      expect(Number.isFinite(c.scores.podiumLogLoss)).toBe(true);
    }
  });

  test("the report is a readable table with the baselines, the reliability bins and the sample size", () => {
    const records = walkForward(real, { nSims: 400 });
    const text = formatReport({ state: real, nSims: 400, cells, records });
    expect(text).toContain("Walk-forward backtest");
    expect(text).toContain("11 races");
    for (const word of ["Model", "Uniform", "Points so far", "Reliability", "half-life", "prior"]) expect(text).toContain(word);
    expect(text).toMatch(/Against points so far, race by race: [+-]\d\.\d{3} per race \(standard error \d\.\d{3}\): (clearly|not clearly) (better|worse)/);
    expect(text).not.toMatch(/NaN|undefined|Infinity\)/);
    expect(text).toContain("no decay");
    expect(text.split("\n").length).toBeGreaterThan(25);
    expect(text.split("\n").every((line) => line.length <= 110)).toBe(true);
  });
});

describe("what counts as clearly different", () => {
  const records = walkForward(real, { nSims: 800 });

  test("a tiny gain is not clear even when it is very consistent", () => {
    const tiny = walkForward(real, { nSims: 800, priorStrength: 3.05 });
    const c = compareCells(tiny, records);
    expect(Math.abs(c.meanDiff)).toBeLessThan(MATERIAL_DIFFERENCE);
    expect(c.clear).toBe(false);
  });

  test("a gain of a material size, many standard errors wide, is clear", () => {
    const c = compareMethods(records, "model", "uniform");
    expect(Math.abs(c.meanDiff)).toBeGreaterThan(MATERIAL_DIFFERENCE);
    expect(c.clear).toBe(true);
  });
});

// ---------- the model card ----------

describe("docs/MODEL.md", () => {
  const card = readFileSync(join(import.meta.dir, "..", "docs", "MODEL.md"), "utf8");

  test("exists and says what the odds are", () => {
    expect(card.length).toBeGreaterThan(2000);
    expect(card).toContain("model estimate");
    expect(card).toContain("## Limits");
  });

  test("lists every parameter of the model, so a new parameter cannot be forgotten", () => {
    for (const key of Object.keys(defaultOddsParams)) expect(card).toContain(`\`${key}\``);
  });

  test("states the defaults it describes", () => {
    expect(card).toMatch(/\| `priorStrength` \| 3 \|/);
    expect(card).toMatch(/\| `recencyHalfLife` \| none \|/);
    expect(card).toMatch(/\| `nSims` \| 10,000 \|/);
    expect(defaultOddsParams.priorStrength).toBe(3);
    expect(defaultOddsParams.recencyHalfLife).toBe(Infinity);
    expect(defaultOddsParams.nSims).toBe(10_000);
  });

  test("records the results and the limits that matter: beats uniform, loses to points so far, one season", () => {
    expect(card).toContain("beats the uniform baseline");
    expect(card).toContain("loses to \"points so far\"");
    expect(card).toContain("One season of data");
    expect(card).toContain("Title odds cannot be calibrated");
  });
});
