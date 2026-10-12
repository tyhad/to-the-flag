import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { InvalidScenarioError } from "../engine/scenario";
import { LOW_CONFIDENCE_ROUNDS, computeOdds, formatProbability } from "../engine/odds";
import { defaultOddsParams, deriveSeed } from "../engine/simulate";
import { driverStatus } from "../engine/status";
import type { Scenario, SeasonState, SessionKey } from "../engine/types";
import { makeState } from "./helpers";

const teams4 = { red: ["AAA", "BBB"], blue: ["CCC", "DDD"] };
const order4 = ["AAA", "BBB", "CCC", "DDD"];
const races = (rounds: number[]) => Object.fromEntries(rounds.map((r) => [`${r}:race`, order4])) as Record<SessionKey, string[]>;
const sum = (xs: Iterable<number>) => [...xs].reduce((a, b) => a + b, 0);

// ---------- formatProbability ----------

describe("formatProbability", () => {
  const table: [number, string][] = [
    [0, "<1%"],
    [0.0049, "<1%"],
    [0.0099, "<1%"],
    [0.01, "1.0%"],
    [0.034, "3.4%"],
    [0.0949, "9.5%"],
    [0.0951, "9.5%"],
    [0.0996, "10%"], // one-decimal rounding reaches 10.0, so it shows as a whole percent
    [0.0999, "10%"],
    [0.1, "10%"],
    [0.4749, "47%"],
    [0.47, "47%"],
    [0.4751, "48%"],
    [0.9899, "99%"],
    [0.99, "99%"],
    [0.9901, ">99%"],
    [0.9999, ">99%"],
    [1, ">99%"],
  ];
  for (const [p, expected] of table) {
    test(`${p} -> ${expected}`, () => expect(formatProbability(p)).toBe(expected));
  }

  test("never shows 0% or 100%, anywhere between 0 and 1", () => {
    for (let k = 0; k <= 10_000; k++) {
      const text = formatProbability(k / 10_000);
      expect(["0%", "0.0%", "100%", "100.0%"]).not.toContain(text);
      expect(text).toMatch(/^(<1%|>99%|\d\.\d%|\d{2}%)$/);
    }
  });

  test("never goes down when the probability goes up", () => {
    const value = (text: string) => (text === "<1%" ? 0.5 : text === ">99%" ? 99.5 : Number.parseFloat(text));
    let previous = -1;
    for (let k = 0; k <= 10_000; k++) {
      const v = value(formatProbability(k / 10_000));
      expect(v).toBeGreaterThanOrEqual(previous);
      previous = v;
    }
  });

  test("a probability outside 0..1, or not a number, is refused", () => {
    for (const bad of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => formatProbability(bad)).toThrow(RangeError);
    }
  });
});

// ---------- computeOdds ----------

describe("computeOdds", () => {
  const state = makeState({ rounds: 6, completed: 4, teams: teams4, results: races([1, 2, 3, 4]) });
  // after four races AAA 100, BBB 72, CCC 60, DDD 48, two races to go: DDD is eliminated, the others are alive
  const quick = { nSims: 2000, seed: 5 };

  test("the result carries the round, the sample size, the seed and the parameters", () => {
    const odds = computeOdds(state, undefined, quick);
    expect(odds.asOfRound).toBe(4);
    expect(odds.roundsCompleted).toBe(4);
    expect(odds.nSims).toBe(2000);
    expect(odds.seed).toBe(5);
    expect(odds.params).toEqual({ ...defaultOddsParams, ...quick });
  });

  test("rows have a probability that matches wins / nSims and a display string", () => {
    const odds = computeOdds(state, undefined, quick);
    for (const row of [...odds.wdc, ...odds.wcc]) {
      expect(row.probability).toBe(row.wins / odds.nSims);
      expect(row.display).toBe(formatProbability(row.probability));
    }
    expect(sum(odds.wdc.map((r) => r.wins))).toBe(2000);
    expect(sum(odds.wcc.map((r) => r.wins))).toBe(2000);
    expect(sum(odds.wdc.map((r) => r.probability))).toBeCloseTo(1, 12);
  });

  test("rows are sorted by probability, best first", () => {
    for (const rows of [computeOdds(state, undefined, quick).wdc, computeOdds(state, undefined, quick).wcc]) {
      for (let i = 1; i < rows.length; i++) expect(rows[i - 1]!.probability).toBeGreaterThanOrEqual(rows[i]!.probability);
    }
  });

  test("equal probabilities are ordered by average points, then by id", () => {
    // with one simulation most alive drivers tie at 0 wins, so the tie-break is what orders them
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      for (const rows of [computeOdds(state, undefined, { nSims: 1, seed }).wdc, computeOdds(state, undefined, { nSims: 1, seed }).wcc]) {
        for (let i = 1; i < rows.length; i++) {
          const a = rows[i - 1]!;
          const b = rows[i]!;
          if (a.probability !== b.probability) continue;
          expect(a.avgPoints).toBeGreaterThanOrEqual(b.avgPoints);
          if (a.avgPoints === b.avgPoints) expect(a.id < b.id).toBe(true);
        }
      }
    }
  });

  test("the driver table has drivers with wins, or that are alive or clinched; the eliminated with no wins are left out", () => {
    const odds = computeOdds(state, undefined, quick);
    const ids = odds.wdc.map((r) => r.id);
    expect(ids).not.toContain("DDD"); // eliminated, never wins
    for (const row of driverStatus(state)) {
      if (row.status !== "eliminated") expect(ids).toContain(row.driver);
    }
    for (const row of odds.wdc) expect(row.status).toBe(driverStatus(state).find((r) => r.driver === row.id)!.status);
  });

  test("an alive driver with no wins in the sample still has a row, shown as <1%", () => {
    const odds = computeOdds(state, undefined, { nSims: 1, seed: 3 });
    const zero = odds.wdc.filter((r) => r.wins === 0);
    expect(zero.length).toBeGreaterThanOrEqual(1);
    for (const row of zero) {
      expect(row.status).toBe("alive");
      expect(row.display).toBe("<1%");
    }
  });

  test("a clinched driver has probability 1 and shows >99%, not 100%", () => {
    const done = makeState({ rounds: 6, completed: 5, teams: teams4, results: races([1, 2, 3, 4, 5]) });
    const odds = computeOdds(done, undefined, quick);
    expect(odds.wdc).toHaveLength(1);
    expect(odds.wdc[0]).toMatchObject({ id: "AAA", wins: 2000, probability: 1, display: ">99%", status: "clinched" });
    expect(odds.maxStdError).toBe(0);
  });

  test("team rows have no status and only teams with wins", () => {
    const odds = computeOdds(state, undefined, quick);
    expect(odds.wcc.length).toBeGreaterThan(0);
    for (const row of odds.wcc) {
      expect(row.wins).toBeGreaterThan(0);
      expect("status" in row).toBe(false);
    }
    expect(odds.wcc[0]!.id).toBe("red");
  });

  test("avgPoints is the mean final points", () => {
    const done = makeState({ rounds: 5, completed: 5, teams: teams4, results: races([1, 2, 3, 4, 5]) });
    const odds = computeOdds(done, undefined, { nSims: 7, seed: 1 });
    expect(odds.wdc[0]!.avgPoints).toBe(125);
    expect(odds.wcc.find((r) => r.id === "red")!.avgPoints).toBe(125 + 90);
  });

  test("maxStdError is the largest sqrt(p (1 - p) / nSims) over the table", () => {
    const odds = computeOdds(state, undefined, quick);
    const expected = Math.max(...[...odds.wdc, ...odds.wcc].map((r) => Math.sqrt((r.probability * (1 - r.probability)) / odds.nSims)));
    expect(odds.maxStdError).toBeCloseTo(expected, 12);
    expect(odds.maxStdError).toBeLessThanOrEqual(0.5 / Math.sqrt(odds.nSims) + 1e-12);
    // two equal drivers: about the worst case, p = 0.5
    const level = makeState({
      rounds: 5, completed: 2, teams: { red: ["AAA"], blue: ["BBB"] },
      results: { "1:race": ["AAA", "BBB"], "2:race": ["BBB", "AAA"] },
    });
    const worst = computeOdds(level, undefined, { nSims: 5000, seed: 1, includeDnf: false, recencyHalfLife: Infinity });
    expect(worst.maxStdError).toBeGreaterThan(0.45 / Math.sqrt(5000));
  });

  describe("lowConfidence", () => {
    const at = (completed: number) =>
      makeState({ rounds: 8, completed, teams: teams4, results: races(Array.from({ length: completed }, (_, i) => i + 1)) });

    test("is true with fewer than 5 rounds complete", () => {
      expect(LOW_CONFIDENCE_ROUNDS).toBe(5);
      expect(computeOdds(at(3), undefined, { nSims: 50, seed: 1 }).lowConfidence).toBe(true);
      expect(computeOdds(at(4), undefined, { nSims: 50, seed: 1 }).lowConfidence).toBe(true);
    });

    test("is false from 5 rounds on", () => {
      expect(computeOdds(at(5), undefined, { nSims: 50, seed: 1 }).lowConfidence).toBe(false);
      expect(computeOdds(at(7), undefined, { nSims: 50, seed: 1 }).lowConfidence).toBe(false);
    });

    test("roundsCompleted counts the completed rounds", () => {
      expect(computeOdds(at(3), undefined, { nSims: 50, seed: 1 }).roundsCompleted).toBe(3);
    });
  });

  describe("the seed", () => {
    const scenario: Scenario = { locks: { "5:race": { fixed: { AAA: 1 } } } };

    test("is stable for the same inputs, and so is everything else", () => {
      const a = computeOdds(state, scenario, { nSims: 500 });
      const b = computeOdds(state, scenario, { nSims: 500 });
      expect(a.seed).toBe(b.seed);
      expect(a).toEqual(b);
      expect(a.seed).toBe(deriveSeed(state, scenario, { ...defaultOddsParams, nSims: 500 }));
    });

    test("changes with the scenario", () => {
      expect(computeOdds(state, scenario, { nSims: 500 }).seed).not.toBe(computeOdds(state, undefined, { nSims: 500 }).seed);
    });

    test("an explicit seed wins", () => {
      expect(computeOdds(state, scenario, { nSims: 500, seed: 123 }).seed).toBe(123);
    });
  });

  test("a bad scenario throws like the other engine functions", () => {
    expect(() => computeOdds(state, { locks: { "1:race": { fixed: { AAA: 1 } } } }, quick)).toThrow(InvalidScenarioError);
  });

  test("golden win counts on a tiny hand-made state (a regression snapshot: change it only when the model changes on purpose)", () => {
    const tiny = makeState({
      rounds: 4, completed: 2, teams: { red: ["AAA", "BBB"], blue: ["CCC"] },
      results: { "1:race": ["AAA", "BBB", "CCC"], "2:race": ["BBB", "AAA", "CCC"] },
    });
    const odds = computeOdds(tiny, undefined, { nSims: 1000, seed: 42 });
    expect({
      wdc: Object.fromEntries(odds.wdc.map((r) => [r.id, r.wins])),
      wcc: Object.fromEntries(odds.wcc.map((r) => [r.id, r.wins])),
      points: Object.fromEntries(odds.wdc.map((r) => [r.id, Math.round(r.avgPoints * 100) / 100])),
    }).toEqual(GOLDEN_TINY);
  });
});

// Computed by running the model once and reviewed by hand: AAA and BBB are level (43 points, one win and one second each),
// so a tie at the top goes to AAA by id, while BBB, who won the latest round, scores slightly more on average.
const GOLDEN_TINY = {
  wdc: { AAA: 557, BBB: 409, CCC: 34 },
  wcc: { red: 1000 },
  points: { AAA: 83.25, BBB: 83.6, CCC: 65.13 },
};

// ---------- the real fixture ----------

describe("computeOdds: the Round 16 fixture", () => {
  const state = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "season-2026-r16.json"), "utf8")) as SeasonState;

  test("has a full table, is not low confidence, and runs quickly", () => {
    const t0 = performance.now();
    const odds = computeOdds(state);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(3000);
    expect(odds.nSims).toBe(10_000);
    expect(odds.lowConfidence).toBe(false);
    expect(odds.roundsCompleted).toBe(16);
    expect(odds.wdc[0]!.id).toBe("ANT");
    expect(odds.wdc[0]!.display).toBe(">99%");
    // everyone still alive has a row
    for (const row of driverStatus(state)) {
      if (row.status !== "eliminated") expect(odds.wdc.map((r) => r.id)).toContain(row.driver);
    }
    expect(odds.wdc.map((r) => r.id)).not.toContain("TSU");
  });
});
