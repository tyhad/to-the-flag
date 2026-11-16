/**
 * Phase 9, Step 2: the backtest scores the points chance (`top10`) and the expected finish (`meanPosition`)
 * (scripts/backtest.ts). The pieces are pure and tested here with hand-made races and with synthetic seasons drawn
 * from known strengths with the seeded RNG.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRng } from "../engine/rng";
import { forecastRace } from "../engine/simulate";
import type { SeasonState } from "../engine/types";
import {
  FIRST_TEST_ROUND,
  POINTS_EDGES,
  brierScore,
  formatPointsSection,
  formatReport,
  gridOf,
  outcomeOf,
  pairsOf,
  reliability,
  runGrid,
  scoreMethod,
  stateBefore,
  uniformForecast,
  walkForward,
  type Outcome,
  type RaceRecord,
} from "../scripts/backtest";
import { makeState } from "./helpers";

const real = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "season-2026-r16.json"), "utf8")) as SeasonState;
const sum = (xs: Iterable<number>) => [...xs].reduce((a, b) => a + b, 0);

// ---------- a synthetic season: 14 drivers, so that "the top ten" means something ----------

const CODES = ["D01", "D02", "D03", "D04", "D05", "D06", "D07", "D08", "D09", "D10", "D11", "D12", "D13", "D14"];
const TEAMS14 = Object.fromEntries(Array.from({ length: 7 }, (_, t) => [`team${t + 1}`, [CODES[2 * t]!, CODES[2 * t + 1]!]]));
/** From D01 (fast) to D14 (slow), clearly apart so that a few races say who is who. */
const TRUE_STRENGTH: Record<string, number> = Object.fromEntries(CODES.map((c, i) => [c, 3 - i * 0.55]));

/** Plackett-Luce races from known strengths; a retirement (5%) is drawn per driver and kept at its road place. */
function syntheticSeason(seed: number, rounds = 14): SeasonState {
  const rng = createRng(seed);
  const results: Record<string, { order: string[]; dnf: string[] }> = {};
  for (let r = 1; r <= rounds; r++) {
    const order = CODES.map((d) => ({ d, key: TRUE_STRENGTH[d]! + rng.gumbel() }))
      .sort((a, b) => b.key - a.key)
      .map((x) => x.d);
    const dnf = order.filter(() => rng.next() < 0.05);
    results[`${r}:race`] = { order, dnf };
  }
  return makeState({ rounds, completed: rounds, teams: TEAMS14, results });
}

const season = syntheticSeason(2024);

// ---------- what happened ----------

describe("outcomeOf: the points finishers and the place that happened", () => {
  const teams12 = Object.fromEntries(Array.from({ length: 6 }, (_, t) => [`t${t + 1}`, [CODES[2 * t]!, CODES[2 * t + 1]!]]));
  const twelve = CODES.slice(0, 12);
  const state = makeState({
    rounds: 1,
    completed: 1,
    teams: teams12,
    results: { "1:race": { order: twelve, dnf: ["D02", "D12"] } },
  });
  const o = outcomeOf(state, 1)!;

  test("the points are the classified top ten: a retirement in the top ten opens a place for nobody", () => {
    // D02 was second on the road but did not finish; the classified position of everyone else is unchanged
    expect(o.top10).not.toContain("D02");
    expect(o.top10).toHaveLength(9);
    expect(o.top10).toContain("D10");
    expect(o.top10).not.toContain("D11");
  });

  test("a classified driver's place is his position", () => {
    expect(o.finish.D01).toBe(1);
    expect(o.finish.D03).toBe(3);
    expect(o.finish.D11).toBe(11);
  });

  test("a driver who was not classified counts as last place, the field size, whatever his road position was", () => {
    expect(o.finish.D02).toBe(12);
    expect(o.finish.D12).toBe(12);
  });

  test("every starter has a place", () => {
    expect(Object.keys(o.finish).sort()).toEqual([...o.field].sort());
  });
});

// ---------- the baseline ----------

describe("the flat baseline: 10/n for everyone", () => {
  test("22 starters: 10/22 for the points and the middle place, 11.5, for the finish", () => {
    const field = Array.from({ length: 22 }, (_, i) => `X${i}`);
    const f = uniformForecast(field);
    expect(f.top10.X0).toBeCloseTo(10 / 22, 12);
    expect(f.meanPosition.X0).toBeCloseTo(11.5, 12);
    expect(sum(Object.values(f.top10))).toBeCloseTo(10, 10);
  });

  test("a field of ten or fewer is all in the points", () => {
    expect(uniformForecast(["A", "B", "C"]).top10.A).toBe(1);
  });

  test("its points Brier on one race of 22 is the known number", () => {
    const field = Array.from({ length: 22 }, (_, i) => `X${i}`);
    const record = handMade(field, (d) => Number(d.slice(1)) + 1, uniformForecast(field));
    const p = 10 / 22;
    expect(scoreMethod([record], "uniform").pointsBrier).toBeCloseTo((10 * (1 - p) ** 2 + 12 * p ** 2) / 22, 12);
  });
});

/** One race by hand: `place` says where each driver finished; `model` is what the model forecast. */
function handMade(field: string[], place: (d: string) => number, model: Pick<RaceRecord["forecasts"]["model"], "top10" | "meanPosition">, retired: string[] = []): RaceRecord {
  const finish: Record<string, number> = {};
  for (const d of field) finish[d] = retired.includes(d) ? field.length : place(d);
  const outcome: Outcome = {
    round: 7,
    field,
    winner: field.find((d) => finish[d] === 1) ?? null,
    podium: field.filter((d) => finish[d]! <= 3),
    top10: field.filter((d) => finish[d]! <= 10 && !retired.includes(d)),
    finish,
  };
  const flat = uniformForecast(field);
  return { round: 7, seed: 1, outcome, forecasts: { model: { ...flat, ...model }, uniform: flat, points: flat } };
}

// ---------- the scores ----------

describe("scoreMethod: points Brier and finish error", () => {
  const field = ["A", "B", "C", "D"];

  test("a forecast that is exactly right scores 0 on both", () => {
    const r = handMade(field, (d) => field.indexOf(d) + 1, { top10: { A: 1, B: 1, C: 1, D: 1 }, meanPosition: { A: 1, B: 2, C: 3, D: 4 } });
    const s = scoreMethod([r], "model");
    expect(s.pointsBrier).toBe(0);
    expect(s.finishMae).toBe(0);
  });

  test("the finish error is the mean absolute difference between the expected and the actual place", () => {
    const r = handMade(field, (d) => field.indexOf(d) + 1, { top10: { A: 1, B: 1, C: 1, D: 1 }, meanPosition: { A: 2, B: 2, C: 1, D: 4 } });
    expect(scoreMethod([r], "model").finishMae).toBeCloseTo((1 + 0 + 2 + 0) / 4, 12);
  });

  test("a retirement counts as last place: expecting last is right, expecting the win is off by n - 1", () => {
    const right = handMade(field, (d) => field.indexOf(d) + 1, { top10: { A: 1, B: 1, C: 1, D: 0 }, meanPosition: { A: 1, B: 2, C: 3, D: 4 } }, ["B"]);
    // B was second on the road but retired: he finished last, and C and D keep their places
    expect(right.outcome.finish.B).toBe(4);
    const wrong = handMade(field, (d) => field.indexOf(d) + 1, { top10: { A: 1, B: 1, C: 1, D: 1 }, meanPosition: { A: 1, B: 1, C: 3, D: 4 } }, ["B"]);
    expect(scoreMethod([wrong], "model").finishMae).toBeCloseTo((0 + 3 + 0 + 0) / 4, 12);
  });

  test("the points outcome of a pair is 'classified in the top ten': a retirement is a 0", () => {
    const r = handMade(field, (d) => field.indexOf(d) + 1, { top10: { A: 1, B: 1, C: 1, D: 1 }, meanPosition: { A: 1, B: 2, C: 3, D: 4 } }, ["B"]);
    const pairs = pairsOf([r], "model", "top10");
    expect(pairs.find((_, i) => field[i] === "B")!.y).toBe(0);
    expect(pairs.filter((p) => p.y === 1)).toHaveLength(3);
    expect(scoreMethod([r], "model").pointsBrier).toBeCloseTo(brierScore(pairs), 12);
  });

  test("the reliability table is in bands of ten points, and a probability of 1 is in the last band", () => {
    expect(POINTS_EDGES).toHaveLength(11);
    expect(POINTS_EDGES[0]).toBe(0);
    expect(POINTS_EDGES.at(-1)).toBe(1);
    for (let i = 1; i < POINTS_EDGES.length; i++) expect(POINTS_EDGES[i]! - POINTS_EDGES[i - 1]!).toBeCloseTo(0.1, 12);
    const bins = reliability([{ p: 1, y: 1 }, { p: 0.95, y: 0 }], POINTS_EDGES);
    expect(bins).toHaveLength(10);
    expect(bins.at(-1)!.n).toBe(2);
  });

  test("the score keeps the reliability table of the points chance, bin by bin the same as `reliability`", () => {
    const rs = walkForward(season, { nSims: 400 });
    const s = scoreMethod(rs, "model");
    expect(s.pointsReliability).toEqual(reliability(pairsOf(rs, "model", "top10"), POINTS_EDGES));
    expect(sum(s.pointsReliability.map((b) => b.n))).toBe(sum(rs.map((r) => r.outcome.field.length)));
  });
});

describe("the points section of the report", () => {
  test("bands with no pairs are skipped, never divided by zero", () => {
    const field = ["A", "B", "C", "D"];
    // every forecast sits in the top band, so nine of ten bands are empty
    const r = handMade(field, (d) => field.indexOf(d) + 1, { top10: { A: 0.99, B: 0.97, C: 0.95, D: 0.93 }, meanPosition: { A: 1, B: 2, C: 3, D: 4 } });
    const lines = formatPointsSection([r]);
    const text = lines.join("\n");
    expect(text).not.toMatch(/NaN|undefined|Infinity/);
    expect(text).toContain("90-100%");
    expect(text).not.toContain("0-10%");
    expect(text).not.toContain("50-60%");
  });

  test("names the baseline the way the docs do and prints both scores for both methods", () => {
    const lines = formatPointsSection(walkForward(season, { nSims: 300 }));
    const text = lines.join("\n");
    expect(text).toContain("10/n for everyone");
    expect(text).toContain("Model (defaults)");
    expect(text).toMatch(/points Brier/);
    expect(text).toMatch(/finish MAE/);
    expect(lines.every((l) => l.length <= 110)).toBe(true);
  });

  test("is part of the full report, which stays readable", () => {
    const records = walkForward(real, { nSims: 300 });
    const cells = runGrid(real, { recencyHalfLife: [8], priorStrength: [1] }, { nSims: 300 });
    const text = formatReport({ state: real, nSims: 300, cells, records });
    expect(text).toContain("Points chance and expected finish");
    expect(text).not.toMatch(/NaN|undefined|Infinity\)/);
    expect(text.split("\n").every((line) => line.length <= 110)).toBe(true);
  });
});

// ---------- walking forward ----------

describe("walkForward carries the points forecast", () => {
  const records = walkForward(season, { nSims: 1200 });

  test("every method has a points chance and an expected finish for every starter", () => {
    expect(records.length).toBe(season.asOfRound - FIRST_TEST_ROUND + 1);
    for (const r of records) {
      for (const method of ["model", "uniform", "points"] as const) {
        expect(Object.keys(r.forecasts[method].top10).sort()).toEqual([...r.outcome.field].sort());
        expect(Object.keys(r.forecasts[method].meanPosition).sort()).toEqual([...r.outcome.field].sort());
      }
    }
  });

  test("the model's numbers are forecastRace's, and win and podium are the ones they were", () => {
    const r = records.find((x) => x.round === 9)!;
    const before = stateBefore(season, 9);
    const direct = forecastRace(before, { nSims: 1200, seed: r.seed }, r.outcome.field, gridOf(season, 9));
    expect(r.forecasts.model.win).toEqual(direct.win);
    expect(r.forecasts.model.podium).toEqual(direct.podium);
    expect(r.forecasts.model.top10).toEqual(direct.top10);
    expect(r.forecasts.model.meanPosition).toEqual(direct.meanPosition);
  });

  test("is reproducible", () => {
    expect(walkForward(season, { nSims: 1200 })).toEqual(records);
  });

  test("never uses the future: changing a later race changes neither the points chance nor the expected finish", () => {
    const round = 10;
    const tampered: SeasonState = {
      ...season,
      results: season.results.map((x) => (x.round >= round ? { ...x, position: 15 - x.position, classified: !x.classified } : x)),
    };
    const a = records.find((x) => x.round === round)!;
    const b = walkForward(tampered, { nSims: 1200 }).find((x) => x.round === round)!;
    expect(b.forecasts.model.top10).toEqual(a.forecasts.model.top10);
    expect(b.forecasts.model.meanPosition).toEqual(a.forecasts.model.meanPosition);
  });
});

describe("the model against the flat baseline", () => {
  test("on a synthetic season from known strengths the true-strength model beats 10/n for everyone on points Brier", () => {
    const records = walkForward(season, { nSims: 2000 });
    const model = scoreMethod(records, "model");
    const flat = scoreMethod(records, "uniform");
    expect(model.pointsBrier).toBeLessThan(flat.pointsBrier);
    expect(flat.pointsBrier).toBeGreaterThan(0.2); // 10/14 for everyone is a poor forecast when the order is clear
  });

  test("and on the finish error", () => {
    const records = walkForward(season, { nSims: 2000 });
    expect(scoreMethod(records, "model").finishMae).toBeLessThan(scoreMethod(records, "uniform").finishMae);
  });

  test("on the 2026 fixture (Round 16) the model beats the flat baseline on both scores", () => {
    const records = walkForward(real, { nSims: 1500 });
    const model = scoreMethod(records, "model");
    const flat = scoreMethod(records, "uniform");
    expect(model.pointsBrier).toBeLessThan(flat.pointsBrier);
    expect(model.finishMae).toBeLessThan(flat.finishMae);
    expect(Number.isFinite(model.pointsBrier)).toBe(true);
    expect(Number.isFinite(model.finishMae)).toBe(true);
  });
});
