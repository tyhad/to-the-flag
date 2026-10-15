/**
 * Driver strengths and retirement rates, fitted from this season only (Phase 3, Step 4).
 *
 * Pace: a regularised Plackett-Luce fit on every race and sprint with results. Only classified finishers take part,
 * in finishing order, so a retirement never makes a driver look slow (decision D21). Each session is weighted by how
 * recent it is. A dummy driver of strength 1 that every driver beats once and loses to once, with weight
 * `priorStrength`, keeps the fit finite and pulls a driver with little data towards the average.
 *
 * Retirements: a driver's own record in races, blended with the field's rate (the field counts as `dnfPriorSessions`
 * virtual races).
 */
import type { ResultRow, SeasonState } from "./types";

/** The parameters the fit needs. The simulation's `OddsParams` extends this. */
export interface StrengthParams {
  /** rounds after which a session counts half as much; Infinity means every session counts the same */
  recencyHalfLife: number;
  /** extra weight factor of a sprint, next to a race */
  sprintWeight: number;
  /** weight of the dummy driver's comparisons with each driver */
  priorStrength: number;
  /** how many virtual races the field's retirement rate counts for */
  dnfPriorSessions: number;
  /** number of finishing stages used in the pace fit (0 = all places, v1 behavior) */
  paceStages: number;
}

export const defaultStrengthParams: StrengthParams = {
  // No decay. The Step 10 backtest (docs/MODEL.md) found any decay clearly worse on the 2026 season, whose pace order
  // barely moved. A season with big mid-season shifts may want a finite half-life (8 to 16 rounds): revisit with more seasons.
  recencyHalfLife: Number.POSITIVE_INFINITY,
  sprintWeight: 0.5,
  // 1 (the weight first sketched in docs/PHASE_3.md) leaves one race of a 20-car field over-dispersed: its strengths
  // spread wider than a full season's. 3 shrinks small samples and still lets 16 rounds speak. Revisit in the Step 10 backtest.
  priorStrength: 3,
  dnfPriorSessions: 4,
  paceStages: 0,
};

export interface StrengthFit {
  /** log strength, mean 0 over the drivers with pace data; 0 for a driver without any */
  theta: Record<string, number>;
  /** sum of the session weights in which the driver was classified */
  effectiveRaces: Record<string, number>;
  /** chance of retiring in a race, in (0, 1) */
  dnfRate: Record<string, number>;
  /** the latest completed round */
  roundsCompleted: number;
}

/** Used for the field's retirement rate when the season has no race results yet (roughly an F1 average). */
export const DEFAULT_FIELD_DNF_RATE = 0.05;
const MIN_DNF_RATE = 0.001;
const MAX_DNF_RATE = 0.999;
const CONVERGED = 1e-10;
const MAX_ITERATIONS = 10_000;

function checkParams(p: StrengthParams): void {
  if (!(p.priorStrength > 0)) throw new RangeError(`priorStrength must be positive, got ${p.priorStrength}`);
  if (!(p.recencyHalfLife > 0)) throw new RangeError(`recencyHalfLife must be positive, got ${p.recencyHalfLife}`);
  if (!(p.sprintWeight >= 0)) throw new RangeError(`sprintWeight must be 0 or more, got ${p.sprintWeight}`);
  if (!(p.dnfPriorSessions >= 0)) throw new RangeError(`dnfPriorSessions must be 0 or more, got ${p.dnfPriorSessions}`);
  if (!Number.isInteger(p.paceStages) || p.paceStages < 0) {
    throw new RangeError(`paceStages must be an integer of 0 or more, got ${p.paceStages}`);
  }
}

interface Ranking {
  weight: number;
  /** driver indexes, best first */
  order: number[];
}

export function fitStrengths(state: SeasonState, partial: Partial<StrengthParams> = {}): StrengthFit {
  const params: StrengthParams = { ...defaultStrengthParams, ...partial };
  checkParams(params);

  const codes = [...new Set([...state.drivers.map((d) => d.code), ...state.results.map((r) => r.driver)])];
  const index = new Map(codes.map((c, i) => [c, i]));
  const n = codes.length;

  // A session that is 0 rounds old counts fully; a sprint of the next round (already in) is treated as 0 rounds old too.
  const recency = (round: number) => 0.5 ** (Math.max(0, state.asOfRound - round) / params.recencyHalfLife);

  // ---- group the rows by session
  const sessions = new Map<string, ResultRow[]>();
  for (const row of state.results) {
    const key = `${row.round}:${row.kind}`;
    const rows = sessions.get(key);
    if (rows) rows.push(row);
    else sessions.set(key, [row]);
  }

  // ---- pace data: classified finishers in finishing order
  const effective = new Float64Array(n);
  const rankings: Ranking[] = [];
  for (const rows of sessions.values()) {
    const first = rows[0]!; // a session only exists because it has a row
    const weight = recency(first.round) * (first.kind === "sprint" ? params.sprintWeight : 1);
    const finishers = rows.filter((r) => r.classified).sort((a, b) => a.position - b.position);
    for (const r of finishers) effective[index.get(r.driver)!]! += weight;
    if (finishers.length >= 2 && weight > 0) {
      rankings.push({ weight, order: finishers.map((r) => index.get(r.driver)!) });
    }
  }

  const theta: Record<string, number> = {};
  for (const c of codes) theta[c] = 0;

  const inFit = new Uint8Array(n);
  for (const rk of rankings) for (const i of rk.order) inFit[i] = 1;

  if (rankings.length > 0) {
    // MM algorithm for Plackett-Luce (Hunter 2004). gamma = exp(theta); the dummy driver has gamma 1 and is not updated.
    // When paceStages > 0, only the first K stages of each finishing order are used.
    const stagesFor = (m: number) => (params.paceStages > 0 ? Math.min(params.paceStages, m - 1) : m - 1);

    // wins[i]: weight of the stages i wins, plus one prior win against the dummy.
    const wins = new Float64Array(n);
    for (const rk of rankings) {
      const S = stagesFor(rk.order.length);
      for (let j = 0; j < S; j++) wins[rk.order[j]!]! += rk.weight;
    }
    for (let i = 0; i < n; i++) if (inFit[i]) wins[i]! += params.priorStrength;

    const gamma = new Float64Array(n).fill(1);
    const denom = new Float64Array(n);
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      denom.fill(0);
      for (const rk of rankings) {
        const { order, weight } = rk;
        const m = order.length;
        const S = stagesFor(m);
        const suffix = new Float64Array(m + 1);
        for (let j = m - 1; j >= 0; j--) suffix[j] = suffix[j + 1]! + gamma[order[j]!]!;
        // the driver at place j is in the choice set of stages 0..min(j, S - 1)
        let running = 0;
        for (let j = 0; j < m; j++) {
          if (j <= S - 1) running += weight / suffix[j]!;
          denom[order[j]!]! += running;
        }
      }
      let change = 0;
      for (let i = 0; i < n; i++) {
        if (!inFit[i]) continue;
        // against the dummy: one stage where i wins and one where i loses, so i is in both choice sets
        const g = gamma[i]!;
        const total = denom[i]! + (2 * params.priorStrength) / (g + 1);
        const next = wins[i]! / total;
        change = Math.max(change, Math.abs(Math.log(next / g)));
        gamma[i] = next;
      }
      if (change < CONVERGED) break;
    }

    let sum = 0;
    let count = 0;
    for (let i = 0; i < n; i++) {
      if (!inFit[i]) continue;
      sum += Math.log(gamma[i]!);
      count++;
    }
    const mean = sum / count;
    for (let i = 0; i < n; i++) if (inFit[i]) theta[codes[i]!] = Math.log(gamma[i]!) - mean;
  }

  // ---- retirement rates: races only
  const starts = new Float64Array(n);
  const retired = new Float64Array(n);
  let fieldStarts = 0;
  let fieldRetired = 0;
  for (const row of state.results) {
    if (row.kind !== "race") continue;
    const w = recency(row.round);
    const i = index.get(row.driver)!;
    starts[i]! += w;
    fieldStarts += w;
    if (!row.classified) {
      retired[i]! += w;
      fieldRetired += w;
    }
  }
  const fieldRate = fieldStarts > 0 ? fieldRetired / fieldStarts : DEFAULT_FIELD_DNF_RATE;
  const alpha = params.dnfPriorSessions;

  const effectiveRaces: Record<string, number> = {};
  const dnfRate: Record<string, number> = {};
  codes.forEach((c, i) => {
    effectiveRaces[c] = effective[i]!;
    const denominator = starts[i]! + alpha;
    const rate = denominator > 0 ? (retired[i]! + alpha * fieldRate) / denominator : fieldRate;
    dnfRate[c] = Math.min(MAX_DNF_RATE, Math.max(MIN_DNF_RATE, rate));
  });

  return { theta, effectiveRaces, dnfRate, roundsCompleted: state.asOfRound };
}
