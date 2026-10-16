import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRng } from "../engine/rng";
import { defaultStrengthParams, fitStrengths as fitRaw, type StrengthFit, type StrengthParams } from "../engine/strength";
import type { SeasonState } from "../engine/types";
import { makeState } from "./helpers";

// ---------- helpers ----------

type Names = Record<"AAA" | "BBB" | "CCC" | "DDD" | "XXX" | "NEW", number>;
type NamedFit = Omit<StrengthFit, "theta" | "effectiveRaces" | "dnfRate"> & { theta: Names; effectiveRaces: Names; dnfRate: Names };
/** The fit, with the hand-made drivers' names (AAA, BBB, ...) known to the type checker. */
const fitStrengths = (state: SeasonState, params: Partial<StrengthParams> = {}): NamedFit => fitRaw(state, params) as unknown as NamedFit;
const val = (rec: Record<string, number>, key: string): number => rec[key] as number;
const at0 = (xs: number[], i: number): number => xs[i] as number;

const N_DRIVERS = 20;
const codes = Array.from({ length: N_DRIVERS }, (_, i) => `D${String(i + 1).padStart(2, "0")}`);
const teams = Object.fromEntries(Array.from({ length: N_DRIVERS / 2 }, (_, t) => [`t${t + 1}`, [codes[2 * t]!, codes[2 * t + 1]!]]));
/** True strengths: D01 is the fastest, D20 the slowest, spread over +-1.2. */
const trueTheta = codes.map((_, i) => 1.2 - (2.4 * i) / (N_DRIVERS - 1));

/** A season of Plackett-Luce races from the true strengths (Gumbel noise, sort descending), reproducible by seed. */
function simulated(nRaces: number, seed = 11, from = 0): SeasonState {
  const rng = createRng(seed);
  const results: Record<string, string[]> = {};
  for (let r = 1; r <= from + nRaces; r++) {
    const order = codes
      .map((c, i) => ({ c, score: trueTheta[i]! + rng.gumbel() }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.c);
    if (r > from) results[`${r - from}:race`] = order;
  }
  return makeState({ rounds: nRaces, completed: nRaces, teams, results });
}

const ranks = (xs: number[]) => {
  const idx = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  idx.forEach(([, i], r) => {
    out[i] = r;
  });
  return out;
};
const pearson = (a: number[], b: number[]) => {
  const ma = a.reduce((s, x) => s + x, 0) / a.length;
  const mb = b.reduce((s, x) => s + x, 0) / b.length;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < a.length; i++) {
    sab += (a[i]! - ma) * (b[i]! - mb);
    saa += (a[i]! - ma) ** 2;
    sbb += (b[i]! - mb) ** 2;
  }
  return sab / Math.sqrt(saa * sbb);
};
const spearman = (a: number[], b: number[]) => pearson(ranks(a), ranks(b));
const spread = (xs: number[]) => {
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
};
/** The v1 settings (no decay, prior 3, every place). The pace-math tests below check the full-order Plackett-Luce fit. */
const V1 = { recencyHalfLife: Infinity, priorStrength: 3, paceStages: 0 };
const thetaOf = (state: SeasonState, params = {}) => {
  const fit = fitRaw(state, { ...V1, ...params });
  return codes.map((c) => val(fit.theta, c));
};

// ---------- pace ----------

describe("fitStrengths: pace", () => {
  test("synthetic recovery: 20 races from known strengths, rank correlation >= 0.9", () => {
    const rho = spearman(thetaOf(simulated(20)), trueTheta);
    expect(rho).toBeGreaterThanOrEqual(0.9);
  });

  test("synthetic recovery holds across seeds: on average >= 0.9 and never poor (20 races is a small sample)", () => {
    const rhos = Array.from({ length: 10 }, (_, k) => spearman(thetaOf(simulated(20, k + 1)), trueTheta));
    expect(rhos.reduce((s, x) => s + x, 0) / rhos.length).toBeGreaterThanOrEqual(0.9);
    expect(Math.min(...rhos)).toBeGreaterThanOrEqual(0.85);
  });

  test("with a lot of data the fit approaches the truth in size, not just in order (checks the Plackett-Luce maths)", () => {
    const state = simulated(400, 7);
    const theta = thetaOf(state, { recencyHalfLife: Infinity, priorStrength: 0.01 });
    const mean = trueTheta.reduce((s, x) => s + x, 0) / N_DRIVERS;
    const truth = trueTheta.map((t) => t - mean);
    expect(pearson(theta, truth)).toBeGreaterThan(0.995);
    theta.forEach((t, i) => expect(Math.abs(t - truth[i]!)).toBeLessThan(0.2));
  });

  test("the result is a stationary point of the regularised Plackett-Luce likelihood (independent check)", () => {
    const state = simulated(6, 21);
    const params = { recencyHalfLife: 8, sprintWeight: 0.5, priorStrength: 1, dnfPriorSessions: 4, paceStages: 0 };
    const fit = fitRaw(state, params);
    const theta = codes.map((c) => val(fit.theta, c));
    const asOf = state.asOfRound;
    const weightOf = (round: number) => 0.5 ** (Math.max(0, asOf - round) / params.recencyHalfLife);
    const sessions = [...new Set(state.results.map((r) => r.round))].map((round) => ({
      w: weightOf(round),
      order: state.results.filter((r) => r.round === round && r.kind === "race").sort((a, b) => a.position - b.position).map((r) => codes.indexOf(r.driver)),
    }));
    // penalised log-likelihood; the dummy item has log strength 0, so the level (shift) matters and is optimised below
    const logLik = (th: number[]) => {
      let ll = 0;
      for (const s of sessions) {
        for (let j = 0; j < s.order.length - 1; j++) {
          let denom = 0;
          for (let k = j; k < s.order.length; k++) denom += Math.exp(th[s.order[k]!]!);
          ll += s.w * (th[s.order[j]!]! - Math.log(denom));
        }
      }
      for (const t of th) ll += params.priorStrength * (t - 2 * Math.log(1 + Math.exp(t)));
      return ll;
    };
    let lo = -5, hi = 5;
    for (let i = 0; i < 200; i++) {
      const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3;
      if (logLik(theta.map((t) => t + a)) < logLik(theta.map((t) => t + b))) lo = a;
      else hi = b;
    }
    const level = (lo + hi) / 2;
    const at = theta.map((t) => t + level);
    for (let i = 0; i < N_DRIVERS; i++) {
      const up = at.slice(), down = at.slice();
      up[i] = at0(up, i) + 1e-5;
      down[i] = at0(down, i) - 1e-5;
      const grad = (logLik(up) - logLik(down)) / 2e-5;
      expect(Math.abs(grad)).toBeLessThan(1e-4);
    }
  });

  test("the best driver gets the highest strength and the order of dominance is kept", () => {
    const state = makeState({
      rounds: 6, completed: 6,
      teams: { red: ["AAA", "BBB"], blue: ["CCC", "DDD"] },
      results: Object.fromEntries([1, 2, 3, 4, 5, 6].map((r) => [`${r}:race`, ["AAA", "BBB", "CCC", "DDD"]])),
    });
    const { theta } = fitStrengths(state);
    expect(theta.AAA).toBeGreaterThan(theta.BBB);
    expect(theta.BBB).toBeGreaterThan(theta.CCC);
    expect(theta.CCC).toBeGreaterThan(theta.DDD);
  });

  test("perfect results stay finite (the prior keeps the fit bounded)", () => {
    const state = makeState({
      rounds: 5, completed: 5,
      teams: { red: ["AAA", "BBB"] },
      results: Object.fromEntries([1, 2, 3, 4, 5].map((r) => [`${r}:race`, ["AAA", "BBB"]])),
    });
    const { theta } = fitStrengths(state);
    expect(Number.isFinite(theta.AAA)).toBe(true);
    expect(Number.isFinite(theta.BBB)).toBe(true);
    expect(theta.AAA).toBeGreaterThan(0);
  });

  test("mean log strength is 0 over the drivers that have data", () => {
    const { theta } = fitRaw(simulated(10, 3));
    const mean = codes.reduce((s, c) => s + val(theta, c), 0) / N_DRIVERS;
    expect(Math.abs(mean)).toBeLessThan(1e-9);
  });

  test("shrinkage: with 1 race the strengths are less spread out than with 16", () => {
    const one = spread(thetaOf(simulated(1, 5)));
    const sixteen = spread(thetaOf(simulated(16, 5)));
    expect(one).toBeLessThan(sixteen);
  });

  test("shrinkage holds on average, grows steadily with data, and ends close to the true spread", () => {
    const meanSpread = (nRaces: number) => {
      const xs = Array.from({ length: 10 }, (_, k) => spread(thetaOf(simulated(nRaces, 100 + k))));
      return xs.reduce((s, x) => s + x, 0) / xs.length;
    };
    const [s1, s3, s8, s16] = [1, 3, 8, 16].map(meanSpread) as [number, number, number, number];
    expect(s1).toBeLessThan(0.8 * s16);
    expect(s1).toBeLessThan(s3);
    expect(s3).toBeLessThan(s8);
    expect(s8).toBeLessThan(s16);
    // with no decay 16 races say almost everything there is to say: within 10% of the truth, not wildly over it
    expect(Math.abs(s16 - spread(trueTheta))).toBeLessThan(0.1 * spread(trueTheta));
  });

  test("a stronger prior shrinks more", () => {
    const state = simulated(10, 9);
    expect(spread(thetaOf(state, { priorStrength: 4 }))).toBeLessThan(spread(thetaOf(state, { priorStrength: 0.5 })));
  });

  test("a DNF does not lower pace: same strengths as when the DNF rows are removed", () => {
    // XXX is quick whenever he finishes (wins), and retires in rounds 2, 4 and 6.
    const others = ["AAA", "BBB", "CCC", "DDD"];
    const teamsX = { red: ["XXX", "AAA"], blue: ["BBB", "CCC"], green: ["DDD"] };
    const withDnf: Record<string, { order: string[]; dnf?: string[] }> = {};
    const without: Record<string, string[]> = {};
    for (let r = 1; r <= 8; r++) {
      const rotated = others.slice(r % 4).concat(others.slice(0, r % 4));
      if (r % 2 === 0) {
        withDnf[`${r}:race`] = { order: [...rotated, "XXX"], dnf: ["XXX"] };
        without[`${r}:race`] = rotated;
      } else {
        withDnf[`${r}:race`] = { order: ["XXX", ...rotated] };
        without[`${r}:race`] = ["XXX", ...rotated];
      }
    }
    const a = fitStrengths(makeState({ rounds: 8, completed: 8, teams: teamsX, results: withDnf }));
    const b = fitStrengths(makeState({ rounds: 8, completed: 8, teams: teamsX, results: without }));
    for (const c of [...others, "XXX"]) expect(val(a.theta, c)).toBeCloseTo(val(b.theta, c), 12);
    expect(a.theta.XXX).toBeGreaterThan(Math.max(...others.map((c) => val(a.theta, c))));
  });

  test("a non-classified driver listed first or in the middle still counts nothing", () => {
    const base = makeState({
      rounds: 3, completed: 3,
      teams: { red: ["AAA", "BBB"], blue: ["CCC"] },
      results: { "1:race": ["AAA", "BBB", "CCC"], "2:race": ["AAA", "BBB", "CCC"], "3:race": ["AAA", "BBB", "CCC"] },
    });
    const dnfBeforeBBB = makeState({
      rounds: 3, completed: 3,
      teams: { red: ["AAA", "BBB"], blue: ["CCC"] },
      results: {
        "1:race": ["AAA", "BBB", "CCC"], "2:race": ["AAA", "BBB", "CCC"],
        "3:race": { order: ["AAA", "CCC", "BBB"], dnf: ["CCC"] },
      },
    });
    const a = fitStrengths(base);
    const b = fitStrengths(dnfBeforeBBB);
    expect(b.effectiveRaces.CCC).toBeLessThan(a.effectiveRaces.CCC);
    expect(Number.isFinite(b.theta.CCC)).toBe(true);
  });

  test("recency: the same results in another order give the later ones more weight", () => {
    const teamsAB = { red: ["AAA", "BBB"] };
    const aThenB = makeState({
      rounds: 4, completed: 4, teams: teamsAB,
      results: { "1:race": ["AAA", "BBB"], "2:race": ["AAA", "BBB"], "3:race": ["BBB", "AAA"], "4:race": ["BBB", "AAA"] },
    });
    const bThenA = makeState({
      rounds: 4, completed: 4, teams: teamsAB,
      results: { "1:race": ["BBB", "AAA"], "2:race": ["BBB", "AAA"], "3:race": ["AAA", "BBB"], "4:race": ["AAA", "BBB"] },
    });
    const x = fitStrengths(aThenB, { recencyHalfLife: 2 });
    const y = fitStrengths(bThenA, { recencyHalfLife: 2 });
    expect(x.theta.BBB).toBeGreaterThan(x.theta.AAA);
    expect(y.theta.AAA).toBeGreaterThan(y.theta.BBB);
    expect(x.theta.BBB).toBeCloseTo(y.theta.AAA, 10);
    // without any decay the order of the rounds makes no difference
    const flat = fitStrengths(aThenB, { recencyHalfLife: Infinity });
    expect(flat.theta.AAA).toBeCloseTo(flat.theta.BBB, 10);
  });

  test("a shorter half-life leans harder on recent rounds", () => {
    const state = makeState({
      rounds: 4, completed: 4, teams: { red: ["AAA", "BBB"] },
      results: { "1:race": ["AAA", "BBB"], "2:race": ["AAA", "BBB"], "3:race": ["BBB", "AAA"], "4:race": ["BBB", "AAA"] },
    });
    const gap = (hl: number) => {
      const t = fitStrengths(state, { recencyHalfLife: hl }).theta;
      return t.BBB - t.AAA;
    };
    expect(gap(1)).toBeGreaterThan(gap(4));
    expect(gap(4)).toBeGreaterThan(gap(Infinity));
  });

  test("sprints count for sprintWeight of a race", () => {
    const state = makeState({
      rounds: 3, sprints: [3], completed: 3, teams: { red: ["AAA", "BBB"] },
      results: { "1:race": ["AAA", "BBB"], "2:race": ["AAA", "BBB"], "3:race": ["AAA", "BBB"], "3:sprint": ["BBB", "AAA"] },
    });
    const gap = (sprintWeight: number) => {
      const t = fitStrengths(state, { sprintWeight, recencyHalfLife: Infinity }).theta;
      return t.AAA! - t.BBB!;
    };
    expect(gap(0)).toBeGreaterThan(gap(0.5));
    expect(gap(0.5)).toBeGreaterThan(gap(1));
    // weight 0 equals leaving the sprint out
    const noSprint = makeState({
      rounds: 3, completed: 3, teams: { red: ["AAA", "BBB"] },
      results: { "1:race": ["AAA", "BBB"], "2:race": ["AAA", "BBB"], "3:race": ["AAA", "BBB"] },
    });
    const t0 = fitStrengths(state, { sprintWeight: 0, recencyHalfLife: Infinity }).theta;
    const tn = fitStrengths(noSprint, { recencyHalfLife: Infinity }).theta;
    expect(t0.AAA).toBeCloseTo(tn.AAA!, 10);
  });
});

// ---------- effective races ----------

describe("fitStrengths: effectiveRaces", () => {
  const teamsXY = { red: ["XXX", "AAA"], blue: ["BBB"] };

  test("is the sum of the session weights in which the driver was classified", () => {
    const state = makeState({
      rounds: 4, sprints: [3], completed: 3, teams: teamsXY,
      results: {
        "1:race": ["XXX", "AAA", "BBB"],
        "2:race": ["AAA", "BBB"],
        "3:race": { order: ["AAA", "BBB", "XXX"], dnf: ["XXX"] },
        "3:sprint": ["AAA", "XXX", "BBB"],
      },
    });
    const fit = fitStrengths(state, { recencyHalfLife: 8, sprintWeight: 0.5 });
    // XXX: round 1 race (age 2) + round 3 sprint (age 0, weight 0.5); the round 3 DNF counts for nothing
    expect(fit.effectiveRaces.XXX).toBeCloseTo(0.5 ** (2 / 8) + 0.5, 12);
    // AAA: races of rounds 1, 2, 3 and the sprint
    expect(fit.effectiveRaces.AAA).toBeCloseTo(0.5 ** (2 / 8) + 0.5 ** (1 / 8) + 1 + 0.5, 12);
  });

  test("the age of a session is never negative (a sprint of the next round weighs at most a race)", () => {
    const state = makeState({
      rounds: 3, sprints: [3], completed: 2, teams: teamsXY,
      results: { "1:race": ["AAA", "BBB"], "2:race": ["AAA", "BBB"] },
    });
    state.results.push({ round: 3, kind: "sprint", driver: "XXX", team: "red", position: 1, grid: 1, points: 8, classified: true });
    state.results.push({ round: 3, kind: "sprint", driver: "AAA", team: "red", position: 2, grid: 2, points: 7, classified: true });
    const fit = fitStrengths(state, { sprintWeight: 0.5 });
    expect(fit.effectiveRaces.XXX).toBeCloseTo(0.5, 12);
  });

  test("a driver with no sessions: strength 0 and effectiveRaces 0", () => {
    const state = makeState({
      rounds: 3, completed: 3, teams: { red: ["AAA", "BBB"], blue: ["CCC", "DDD"] },
      results: { "1:race": ["AAA", "BBB", "CCC"], "2:race": ["BBB", "AAA", "CCC"], "3:race": ["AAA", "CCC", "BBB"] },
    });
    const fit = fitStrengths(state);
    expect(fit.theta.DDD).toBe(0);
    expect(fit.effectiveRaces.DDD).toBe(0);
    expect(Object.keys(fit.theta).sort()).toEqual(["AAA", "BBB", "CCC", "DDD"]);
    expect(Object.keys(fit.effectiveRaces).sort()).toEqual(["AAA", "BBB", "CCC", "DDD"]);
    expect(Object.keys(fit.dnfRate).sort()).toEqual(["AAA", "BBB", "CCC", "DDD"]);
  });

  test("a driver who only ever retired has no pace data: strength 0 and effectiveRaces 0", () => {
    const state = makeState({
      rounds: 3, completed: 3, teams: { red: ["AAA", "BBB"], blue: ["CCC"] },
      results: Object.fromEntries([1, 2, 3].map((r) => [`${r}:race`, { order: ["AAA", "BBB", "CCC"], dnf: ["CCC"] }])),
    });
    const fit = fitStrengths(state);
    expect(fit.theta.CCC).toBe(0);
    expect(fit.effectiveRaces.CCC).toBe(0);
    // the others are centred among themselves
    expect(fit.theta.AAA! + fit.theta.BBB!).toBeCloseTo(0, 10);
  });

  test("roundsCompleted is the latest completed round", () => {
    expect(fitStrengths(simulated(7, 2)).roundsCompleted).toBe(7);
    expect(fitStrengths(makeState({ rounds: 3, teams: { red: ["AAA", "BBB"] } })).roundsCompleted).toBe(0);
  });

  test("a season with no results at all gives zeros and the default field rate", () => {
    const fit = fitRaw(makeState({ rounds: 3, teams: { red: ["AAA", "BBB"] } }));
    expect(fit.theta).toEqual({ AAA: 0, BBB: 0 });
    expect(fit.effectiveRaces).toEqual({ AAA: 0, BBB: 0 });
    expect(fit.dnfRate.AAA).toBeGreaterThan(0);
    expect(fit.dnfRate.AAA).toBe(fit.dnfRate.BBB);
  });
});

// ---------- DNF rates ----------

describe("fitStrengths: DNF rate", () => {
  const teamsABCD = { red: ["AAA", "BBB"], blue: ["CCC", "DDD"] };
  const flat = { recencyHalfLife: Infinity, dnfPriorSessions: 4 };

  test("equals (retirements + alpha * field rate) / (appearances + alpha), hand-computed", () => {
    // round 1: D retires. round 2: C and D retire. 3 retirements in 8 appearances -> field rate 0.375
    const state = makeState({
      rounds: 2, completed: 2, teams: teamsABCD,
      results: {
        "1:race": { order: ["AAA", "BBB", "CCC", "DDD"], dnf: ["DDD"] },
        "2:race": { order: ["AAA", "BBB", "CCC", "DDD"], dnf: ["CCC", "DDD"] },
      },
    });
    const { dnfRate } = fitStrengths(state, flat);
    expect(dnfRate.AAA).toBeCloseTo((0 + 4 * 0.375) / (2 + 4), 12);
    expect(dnfRate.BBB).toBeCloseTo((0 + 4 * 0.375) / (2 + 4), 12);
    expect(dnfRate.CCC).toBeCloseTo((1 + 4 * 0.375) / (2 + 4), 12);
    expect(dnfRate.DDD).toBeCloseTo((2 + 4 * 0.375) / (2 + 4), 12);
  });

  test("rates lie strictly between 0 and 1, even when nobody ever retired", () => {
    const clean = fitRaw(simulated(5, 4));
    for (const c of codes) {
      expect(val(clean.dnfRate, c)).toBeGreaterThan(0);
      expect(val(clean.dnfRate, c)).toBeLessThan(1);
    }
  });

  test("rates lie strictly between 0 and 1 for a driver who retired every time", () => {
    const state = makeState({
      rounds: 6, completed: 6, teams: teamsABCD,
      results: Object.fromEntries([1, 2, 3, 4, 5, 6].map((r) => [`${r}:race`, { order: ["AAA", "BBB", "CCC", "DDD"], dnf: ["DDD"] }])),
    });
    const { dnfRate } = fitStrengths(state);
    expect(dnfRate.DDD).toBeGreaterThan(0);
    expect(dnfRate.DDD).toBeLessThan(1);
    expect(dnfRate.DDD).toBeGreaterThan(dnfRate.AAA!);
  });

  test("a driver with few sessions sits near the field average", () => {
    // a long season where about 1 in 10 retire, plus a newcomer who raced once and retired
    const rows: Record<string, { order: string[]; dnf?: string[] }> = {};
    for (let r = 1; r <= 10; r++) {
      rows[`${r}:race`] = r === 10
        ? { order: ["AAA", "BBB", "CCC", "NEW"], dnf: ["NEW"] }
        : { order: ["AAA", "BBB", "CCC", "DDD"], dnf: r % 3 === 0 ? ["DDD"] : [] };
    }
    const state = makeState({ rounds: 10, completed: 10, teams: { red: ["AAA", "BBB"], blue: ["CCC", "DDD"], green: ["NEW"] }, results: rows });
    const { dnfRate } = fitStrengths(state, flat);
    const field = (3 + 1) / 40;
    // NEW retired in 1 of 1 starts; the blend keeps him far below 100% and close to the field rate
    expect(dnfRate.NEW).toBeLessThan(0.5);
    expect(Math.abs(dnfRate.NEW! - field)).toBeLessThan(Math.abs(1 - field) / 2);
    // a driver with nine starts and three retirements is pulled towards the field, but stays above it
    expect(dnfRate.DDD!).toBeGreaterThan(field);
    expect(dnfRate.DDD!).toBeLessThan(3 / 9);
  });

  test("a driver who never started gets the field rate", () => {
    const state = makeState({
      rounds: 2, completed: 2, teams: { red: ["AAA", "BBB"], blue: ["CCC"] },
      results: { "1:race": { order: ["AAA", "BBB"], dnf: ["BBB"] }, "2:race": ["AAA", "BBB"] },
    });
    const { dnfRate } = fitStrengths(state, flat);
    expect(dnfRate.CCC).toBeCloseTo(1 / 4, 12);
  });

  test("only race sessions count: sprint retirements change nothing", () => {
    const results = { "1:race": ["AAA", "BBB", "CCC", "DDD"], "2:race": ["AAA", "BBB", "CCC", "DDD"] };
    const plain = makeState({ rounds: 2, completed: 2, teams: teamsABCD, results });
    const withSprint = makeState({
      rounds: 2, sprints: [2], completed: 2, teams: teamsABCD,
      results: { ...results, "2:sprint": { order: ["AAA", "BBB", "CCC", "DDD"], dnf: ["AAA", "DDD"] } },
    });
    expect(fitStrengths(withSprint, flat).dnfRate).toEqual(fitStrengths(plain, flat).dnfRate);
  });

  test("a recent retirement weighs more than an old one", () => {
    const build = (dnfRound: number) =>
      makeState({
        rounds: 4, completed: 4, teams: teamsABCD,
        results: Object.fromEntries(
          [1, 2, 3, 4].map((r) => [`${r}:race`, { order: ["AAA", "BBB", "CCC", "DDD"], dnf: r === dnfRound ? ["DDD"] : [] }]),
        ),
      });
    const old = fitStrengths(build(1), { recencyHalfLife: 2 }).dnfRate.DDD!;
    const recent = fitStrengths(build(4), { recencyHalfLife: 2 }).dnfRate.DDD!;
    expect(recent).toBeGreaterThan(old);
  });

  test("a larger dnfPriorSessions pulls a driver closer to the field", () => {
    const state = makeState({
      rounds: 4, completed: 4, teams: teamsABCD,
      results: Object.fromEntries([1, 2, 3, 4].map((r) => [`${r}:race`, { order: ["AAA", "BBB", "CCC", "DDD"], dnf: ["DDD"] }])),
    });
    const loose = fitStrengths(state, { ...flat, dnfPriorSessions: 1 }).dnfRate.DDD!;
    const tight = fitStrengths(state, { ...flat, dnfPriorSessions: 20 }).dnfRate.DDD!;
    const field = 4 / 16;
    expect(Math.abs(tight - field)).toBeLessThan(Math.abs(loose - field));
  });
});

// ---------- general ----------

describe("fitStrengths: general", () => {
  test("is deterministic and does not change the state", () => {
    const state = simulated(8, 13);
    const frozen = JSON.stringify(state);
    const a = fitStrengths(state);
    const b = fitStrengths(state);
    expect(a).toEqual(b);
    expect(JSON.stringify(state)).toBe(frozen);
    expect(Object.keys(a.theta)).toEqual(Object.keys(b.theta));
  });

  test("the default parameters are the documented ones", () => {
    expect(defaultStrengthParams).toEqual({ recencyHalfLife: 8, sprintWeight: 0.5, priorStrength: 1, dnfPriorSessions: 4, paceStages: 5 });
    expect(fitStrengths(simulated(5, 2))).toEqual(fitStrengths(simulated(5, 2), defaultStrengthParams));
  });

  test("nonsense parameters are refused", () => {
    const state = simulated(2, 1);
    expect(() => fitStrengths(state, { priorStrength: 0 })).toThrow(RangeError);
    expect(() => fitStrengths(state, { priorStrength: -1 })).toThrow(RangeError);
    expect(() => fitStrengths(state, { recencyHalfLife: 0 })).toThrow(RangeError);
    expect(() => fitStrengths(state, { recencyHalfLife: Number.NaN })).toThrow(RangeError);
    expect(() => fitStrengths(state, { sprintWeight: -0.1 })).toThrow(RangeError);
    expect(() => fitStrengths(state, { dnfPriorSessions: -1 })).toThrow(RangeError);
    expect(() => fitStrengths(state, { paceStages: -1 })).toThrow(RangeError);
    expect(() => fitStrengths(state, { paceStages: 1.5 })).toThrow(RangeError);
  });

  describe("top-heavy pace fit (paceStages)", () => {
    test("omitting paceStages is the same as the v2 default of 5", () => {
      const s = simulated(10, 42);
      const fitDefault = fitRaw(s);
      const fitFive = fitRaw(s, { paceStages: 5 });
      expect(fitFive.theta).toEqual(fitDefault.theta);
      expect(fitFive.effectiveRaces).toEqual(fitDefault.effectiveRaces);
      expect(fitFive.dnfRate).toEqual(fitDefault.dnfRate);
    });

    test("v1 stays reproducible: paceStages 0 with no decay and prior 3 is the full-order fit", () => {
      const s = simulated(10, 42);
      const v1 = fitRaw(s, V1);
      const explicit = fitRaw(s, { recencyHalfLife: Infinity, priorStrength: 3, paceStages: 0 });
      expect(v1.theta).toEqual(explicit.theta);
      expect(fitRaw(s, { paceStages: 0 }).theta).not.toEqual(fitRaw(s).theta);
    });

    test("a value of at least the field size equals paceStages: 0", () => {
      const s = simulated(10, 42); // 20 drivers
      const fitZero = fitRaw(s, { paceStages: 0 });
      const fit20 = fitRaw(s, { paceStages: 20 });
      const fit25 = fitRaw(s, { paceStages: 25 });
      expect(fit20.theta).toEqual(fitZero.theta);
      expect(fit25.theta).toEqual(fitZero.theta);
    });

    test("on synthetic data with a heavy-tailed truth, top-K fit recovers top three strengths with lower error", () => {
      const nDrivers = 20;
      const testCodes = Array.from({ length: nDrivers }, (_, i) => `D${String(i + 1).padStart(2, "0")}`);
      const testTeams = Object.fromEntries(
        Array.from({ length: nDrivers / 2 }, (_, t) => [`t${t + 1}`, [testCodes[2 * t]!, testCodes[2 * t + 1]!]]),
      );
      // Heavy-tailed: top 3 are strong, 17 tail drivers have low ability and heavy-tailed noise
      const truth = testCodes.map((_, i) => (i === 0 ? 3.0 : i === 1 ? 2.0 : i === 2 ? 1.0 : -1.5));
      const meanTop3True = (truth[0]! + truth[1]! + truth[2]!) / 3;

      let errAllTotal = 0;
      let errTopKTotal = 0;
      const reps = 25;

      for (let rep = 1; rep <= reps; rep++) {
        const rng = createRng(rep * 101);
        const results: Record<string, string[]> = {};
        for (let r = 1; r <= 15; r++) {
          const scored = testCodes.map((c, i) => {
            const u1 = rng.normal();
            const u2 = rng.normal();
            const u3 = rng.normal();
            const chi2 = (u1 * u1 + u2 * u2 + u3 * u3) / 3;
            const t3 = rng.normal() / Math.sqrt(chi2);
            return { c, score: truth[i]! + t3 };
          });
          scored.sort((a, b) => b.score - a.score);
          results[`${r}:race`] = scored.map((s) => s.c);
        }
        const state = makeState({ rounds: 15, completed: 15, teams: testTeams, results });
        const fAll = fitRaw(state, { paceStages: 0, priorStrength: 1 });
        const fTopK = fitRaw(state, { paceStages: 5, priorStrength: 1 });

        const meanTop3All = (fAll.theta[testCodes[0]!]! + fAll.theta[testCodes[1]!]! + fAll.theta[testCodes[2]!]!) / 3;
        const meanTop3K = (fTopK.theta[testCodes[0]!]! + fTopK.theta[testCodes[1]!]! + fTopK.theta[testCodes[2]!]!) / 3;

        const errAll = [0, 1, 2].reduce(
          (s, i) => s + Math.abs(fAll.theta[testCodes[i]!]! - meanTop3All - (truth[i]! - meanTop3True)),
          0,
        );
        const errTopK = [0, 1, 2].reduce(
          (s, i) => s + Math.abs(fTopK.theta[testCodes[i]!]! - meanTop3K - (truth[i]! - meanTop3True)),
          0,
        );

        errAllTotal += errAll;
        errTopKTotal += errTopK;
      }

      const avgErrAll = errAllTotal / reps;
      const avgErrTopK = errTopKTotal / reps;
      expect(avgErrTopK).toBeLessThan(avgErrAll);
    });
  });

  describe("the Round 16 fixture", () => {
    const state = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "season-2026-r16.json"), "utf8")) as SeasonState;
    const rankOf = (fit: StrengthFit, code: string) =>
      state.drivers.map((d) => d.code).sort((a, b) => val(fit.theta, b) - val(fit.theta, a)).indexOf(code) + 1;

    test("every number is finite, rates are in (0, 1) and the strengths are centred", () => {
      const fit = fitRaw(state);
      expect(fit.roundsCompleted).toBe(16);
      for (const d of state.drivers) {
        expect(Number.isFinite(val(fit.theta, d.code))).toBe(true);
        expect(val(fit.effectiveRaces, d.code)).toBeGreaterThanOrEqual(0);
        expect(val(fit.dnfRate, d.code)).toBeGreaterThan(0);
        expect(val(fit.dnfRate, d.code)).toBeLessThan(1);
      }
      const withData = state.drivers.filter((d) => val(fit.effectiveRaces, d.code) > 0);
      expect(Math.abs(withData.reduce((s, d) => s + val(fit.theta, d.code), 0))).toBeLessThan(1e-8);
    });

    test("RUS, second in the standings, stays in the top eight by pace", () => {
      // How a retirement is handled is proved exactly by "a DNF does not lower pace" above; this only checks the real data is sensible.
      expect(rankOf(fitRaw(state), "RUS")).toBeLessThanOrEqual(8);
    });

    test("the inactive driver TSU still has a strength of his own, from the rounds he raced", () => {
      const fit = fitRaw(state);
      expect(val(fit.effectiveRaces, "TSU")).toBeGreaterThan(0);
      expect(val(fit.theta, "TSU")).not.toBe(0);
    });
  });
});
