/**
 * Monte Carlo simulation of the rest of the season (Phase 3, Step 5). Pure: the same inputs and seed give the same answer.
 *
 * Each simulated season draws a strength for every active driver, then runs every remaining session:
 * - open session: each driver retires with their own probability, finishers are ordered by Plackett-Luce
 *   (strength plus Gumbel noise, best first), retirees go to the back in random order and score nothing;
 * - locked session (decision D20): fixed drivers take their places, "out" drivers go to the back without points,
 *   everyone else races as in an open session and fills the free places in order.
 * The champion is the driver (and the team) with the most points; a tie goes through the same countback as the
 * standings (`compareStanding`), then the id. Only active drivers can win the drivers' title, as in `driverStatus`.
 */
import { compareStanding, type Rankable } from "./countback";
import { gpPoints, sprintPoints } from "./points";
import { createRng, hashSeed, type Rng } from "./rng";
import { validateScenario } from "./scenario";
import { parseSessionKey, remainingSessions } from "./sessions";
import { computeConstructorStandings, computeDriverStandings } from "./standings";
import { defaultStrengthParams, fitStrengths, type StrengthFit, type StrengthParams } from "./strength";
import type { Scenario, SeasonState } from "./types";

export interface OddsParams extends StrengthParams {
  nSims: number;
  /** default: `deriveSeed(state, scenario, params)` */
  seed?: number;
  /** 0..1: strengths are multiplied by this, so 0 makes every driver equal */
  formWeight: number;
  /** per-driver sigma = strengthSigma * sqrt(K / (K + effectiveRaces)), K = 6 */
  strengthSigma: number;
  /** a sprint retirement chance is the race chance times this */
  sprintDnfFactor: number;
  includeDnf: boolean;
  /**
   * Phase 4, Step 7: weight of the starting grid in a race forecast. A driver's finishing key gets
   * `gridWeight * (-ln(grid position))` added. 0 ignores the grid (the v2 behavior). Used by `forecastRace` when
   * it is given a grid; the season simulation does not use it yet (Step 8).
   */
  gridWeight: number;
  /**
   * Phase 4, Step 8: how noisy the simulated qualifying is. For a race with no known grid, each driver's qualifying
   * key is the simulated strength plus `qualifyingNoise` times Gumbel noise, and the order of those keys is the grid
   * the grid term sees. 0 simulates no grid (later races then ignore the grid). Only used when `gridWeight` is above 0.
   */
  qualifyingNoise: number;
}

export const defaultOddsParams: OddsParams = {
  nSims: 10_000,
  formWeight: 1,
  ...defaultStrengthParams,
  strengthSigma: 0.25,
  sprintDnfFactor: 0.5,
  includeDnf: true,
  // Step 7 (D30 protocol): grid weight 1. Beat v2 without the grid on every history season (4/4), on validation (2025)
  // by 0.073 per race (3.2 SE) and on 2026 by 0.084 per race (3.8 SE). 1 is the top of the coarse grid tried.
  gridWeight: 1,
  // Step 8: qualifying noise 2, the value that makes the real grids of 2022-2024 most likely (Plackett-Luce likelihood
  // on strengths fitted before each race). Used only for races with no real grid.
  qualifyingNoise: 2,
};

export interface SimulationResult {
  nSims: number;
  /** the seed actually used */
  seed: number;
  /** the parameters actually used, defaults filled in */
  params: OddsParams;
  /** simulated seasons won, for every driver and team in the state */
  driverWins: Record<string, number>;
  teamWins: Record<string, number>;
  /** final points added up over all simulations (divide by nSims for the average) */
  driverPointSums: Record<string, number>;
  teamPointSums: Record<string, number>;
  /** the round whose real grid (`SeasonState.upcomingGrid`) the simulation used, or null when it used none */
  gridKnownRound: number | null;
}

const STRENGTH_SIGMA_K = 6;
/** Retirements are drawn in this range; a retiree's sort key sits far below any finisher's. */
const RETIRED_KEY = -1e6;
const isFinisher = (key: number): boolean => key > RETIRED_KEY / 2;

function checkParams(p: OddsParams): void {
  if (!Number.isInteger(p.nSims) || p.nSims < 1) throw new RangeError(`nSims must be a whole number of 1 or more, got ${p.nSims}`);
  if (!(p.formWeight >= 0 && p.formWeight <= 1)) throw new RangeError(`formWeight must be between 0 and 1, got ${p.formWeight}`);
  if (!(p.strengthSigma >= 0)) throw new RangeError(`strengthSigma must be 0 or more, got ${p.strengthSigma}`);
  if (!(p.sprintDnfFactor >= 0)) throw new RangeError(`sprintDnfFactor must be 0 or more, got ${p.sprintDnfFactor}`);
  if (!Number.isInteger(p.paceStages) || p.paceStages < 0) {
    throw new RangeError(`paceStages must be an integer of 0 or more, got ${p.paceStages}`);
  }
  if (!(Number.isFinite(p.gridWeight) && p.gridWeight >= 0)) {
    throw new RangeError(`gridWeight must be a finite number of 0 or more, got ${p.gridWeight}`);
  }
  if (!(Number.isFinite(p.qualifyingNoise) && p.qualifyingNoise >= 0)) {
    throw new RangeError(`qualifyingNoise must be a finite number of 0 or more, got ${p.qualifyingNoise}`);
  }
}

/**
 * The grid term of a finishing key: -ln(grid position), so pole adds 0 and every place further back subtracts more.
 * A pit-lane start (stored as the field size, or a raw 0), a driver with no grid place, or a nonsense place counts as
 * last on the grid; a place beyond the field is clamped to last.
 */
export function gridTerm(position: number | undefined, fieldSize: number): number {
  const last = Math.max(1, fieldSize);
  const place = position === undefined || !(position >= 1) ? last : Math.min(position, last);
  return -Math.log(place);
}

/** JSON with object keys sorted at every level, so equal data always gives equal text. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** The default seed: a stable hash of the season, the round, the scenario's locks and the model parameters (not the seed). */
export function deriveSeed(state: SeasonState, scenario: Scenario | undefined, params: OddsParams): number {
  const { seed: _ignored, ...modelParams } = params;
  if (modelParams.paceStages === 0) {
    delete (modelParams as Partial<OddsParams>).paceStages;
  }
  // gridWeight 0 (ignore the grid) must hash exactly as before the parameter existed, so v2 seeds and snapshots hold
  if (modelParams.gridWeight === 0) {
    delete (modelParams as Partial<OddsParams>).gridWeight;
  }
  if (modelParams.qualifyingNoise === 0) {
    delete (modelParams as Partial<OddsParams>).qualifyingNoise;
  }
  return hashSeed(String(state.season), String(state.asOfRound), canonicalJson(scenario?.locks ?? {}), canonicalJson(modelParams));
}

/** The model's per-driver inputs for the drivers in `codes` (same order). */
function modelInputs(fit: StrengthFit, codes: readonly string[], params: OddsParams) {
  const form = Float64Array.from(codes, (c) => params.formWeight * (fit.theta[c] ?? 0));
  const sigma = Float64Array.from(
    codes,
    (c) => params.strengthSigma * Math.sqrt(STRENGTH_SIGMA_K / (STRENGTH_SIGMA_K + (fit.effectiveRaces[c] ?? 0))),
  );
  const raceRetire = Float64Array.from(codes, (c) => (params.includeDnf ? (fit.dnfRate[c] ?? 0) : 0));
  const sprintRetire = raceRetire.map((p) => Math.min(1, p * params.sprintDnfFactor));
  return { form, sigma, raceRetire, sprintRetire };
}

/**
 * Draws one open session for the drivers in `racers`: each retires with its own chance, the others get a key of
 * strength plus Gumbel noise. Leaves the drivers in `order[0 .. racers.length)`, best first, retirees at the back in
 * random order, and each driver's key in `sortKey` (`isFinisher` tells a retiree from a finisher).
 * The season simulation and the single-race forecast both use this, so they cannot drift apart.
 */
function rankRacers(
  rng: Rng,
  racers: Int32Array,
  strength: Float64Array,
  retire: Float64Array,
  sortKey: Float64Array,
  order: Int32Array,
): void {
  const u = racers.length;
  for (let k = 0; k < u; k++) {
    const d = racers[k]!;
    sortKey[d] = rng.next() < retire[d]! ? RETIRED_KEY + rng.next() : strength[d]! + rng.gumbel();
    order[k] = d;
  }
  // best key first (insertion sort: a field is at most about 22 drivers)
  for (let a = 1; a < u; a++) {
    const d = order[a]!;
    const key = sortKey[d]!;
    let b = a - 1;
    while (b >= 0 && sortKey[order[b]!]! < key) {
      order[b + 1] = order[b]!;
      b--;
    }
    order[b + 1] = d;
  }
}

/** What one remaining session needs, worked out once before the simulations start. */
interface CompiledSession {
  isRace: boolean;
  /** points by finishing position; index 0 is unused */
  table: Int32Array;
  /** active drivers (by index) with no lock: they race */
  racers: Int32Array;
  /** the places they fill, in order (at least as many as racers) */
  free: Int32Array;
  fixedDrivers: Int32Array;
  fixedPositions: Int32Array;
  outDrivers: Int32Array;
  /** places after the field, for the drivers that are out */
  outPositions: Int32Array;
  /** retirement chance per active driver in this kind of session */
  retire: Float64Array;
  /** slot in the race-position matrix, or -1 for a sprint */
  raceSlot: number;
  /** grid term per active driver from the real grid of this race, or null when there is none (or the grid is ignored) */
  knownGrid: Float64Array | null;
  /** simulate the qualifying order for this race (a race with no real grid, `gridWeight` and `qualifyingNoise` above 0) */
  simulateGrid: boolean;
  /** grid term by place (index 0 = pole) among the racers, for a simulated grid */
  placeTerm: Float64Array;
}

/**
 * Win counts per driver and per team over `params.nSims` simulated seasons, plus summed final points.
 * Throws InvalidScenarioError for a bad scenario and RangeError for nonsense parameters.
 */
export function simulateSeason(
  state: SeasonState,
  scenario: Scenario | undefined,
  partial: Partial<OddsParams> = {},
): SimulationResult {
  const params: OddsParams = { ...defaultOddsParams, ...partial };
  checkParams(params);
  if (scenario) validateScenario(state, scenario);
  const seed = params.seed ?? deriveSeed(state, scenario, params);
  const { nSims } = params;

  // ---- who races
  const active = state.drivers.filter((d) => d.active).map((d) => d.code);
  const A = active.length;
  const driverIndex = new Map(active.map((c, i) => [c, i]));

  // ---- where everyone starts: the same tables the exact engine uses
  const baseDrivers = new Map(computeDriverStandings(state).map((r) => [r.id, r]));
  const constructorRows = computeConstructorStandings(state);
  const teamIds = constructorRows.map((r) => r.id);
  const T = teamIds.length;
  const teamIndex = new Map(teamIds.map((id, i) => [id, i]));
  const baseTeams = constructorRows;

  const baseDriverPoints = Float64Array.from(active, (c) => baseDrivers.get(c)?.points ?? 0);
  const baseTeamPoints = Float64Array.from(baseTeams, (r) => r.points);

  // each driver's latest team (decision d); the latest row wins, later rows win ties
  const latest = new Map<string, { round: number; team: string }>();
  for (const r of state.results) {
    const seen = latest.get(r.driver);
    if (!seen || r.round >= seen.round) latest.set(r.driver, { round: r.round, team: r.team });
  }
  const teamOf = Int32Array.from(active, (c) => {
    const team = latest.get(c)?.team;
    return team === undefined ? -1 : (teamIndex.get(team) ?? -1);
  });
  const membersOfTeam: number[][] = Array.from({ length: T }, () => []);
  teamOf.forEach((t, i) => {
    if (t >= 0) membersOfTeam[t]!.push(i);
  });

  // ---- the model inputs
  const { form, sigma, raceRetire, sprintRetire } = modelInputs(fitStrengths(state, params), active, params);

  // ---- the sessions left to run
  const upcoming = state.upcomingGrid;
  let gridKnownRound: number | null = null;
  const sessions: CompiledSession[] = [];
  let raceSlots = 0;
  let maxPosition = 0;
  for (const key of remainingSessions(state)) {
    const { kind } = parseSessionKey(key);
    const lock = scenario?.locks[key];
    const racers: number[] = [];
    const fixedDrivers: number[] = [];
    const fixedPositions: number[] = [];
    const outDrivers: number[] = [];
    for (let i = 0; i < A; i++) {
      const fixed = lock?.fixed[active[i]!];
      if (fixed === undefined) racers.push(i);
      else if (fixed === "out") outDrivers.push(i);
      else {
        fixedDrivers.push(i);
        fixedPositions.push(fixed);
      }
    }
    const fieldSize = Math.max(racers.length + fixedDrivers.length, ...fixedPositions, 0);
    const taken = new Set(fixedPositions);
    const free: number[] = [];
    for (let p = 1; p <= fieldSize; p++) if (!taken.has(p)) free.push(p);
    const outPositions = outDrivers.map((_, k) => fieldSize + 1 + k);
    const top = fieldSize + outDrivers.length;
    maxPosition = Math.max(maxPosition, top);

    const tier = kind === "race" ? (lock?.tier ?? "full") : "full";
    const table = new Int32Array(top + 1);
    for (let p = 1; p <= top; p++) table[p] = kind === "race" ? gpPoints(p, tier) : sprintPoints(p);

    // the grid term of this race (Step 8): the real grid when we have it, else a simulated qualifying
    const isRace = kind === "race";
    let knownGrid: Float64Array | null = null;
    if (isRace && params.gridWeight > 0 && upcoming !== undefined && upcoming.round === parseSessionKey(key).round) {
      const fieldSize = Math.max(A, ...Object.values(upcoming.grid));
      knownGrid = Float64Array.from(active, (c) => gridTerm(upcoming.grid[c], fieldSize));
      gridKnownRound = upcoming.round;
    }
    const simulateGrid = isRace && knownGrid === null && params.gridWeight > 0 && params.qualifyingNoise > 0;
    const placeTerm = Float64Array.from({ length: racers.length }, (_, k) => gridTerm(k + 1, racers.length));

    sessions.push({
      knownGrid,
      simulateGrid,
      placeTerm,
      isRace: kind === "race",
      table,
      racers: Int32Array.from(racers),
      free: Int32Array.from(free),
      fixedDrivers: Int32Array.from(fixedDrivers),
      fixedPositions: Int32Array.from(fixedPositions),
      outDrivers: Int32Array.from(outDrivers),
      outPositions: Int32Array.from(outPositions),
      retire: kind === "race" ? raceRetire : sprintRetire,
      raceSlot: kind === "race" ? raceSlots++ : -1,
    });
  }

  // ---- working memory, reused by every simulation
  const rng = createRng(seed);
  const strength = new Float64Array(A);
  const simPoints = new Int32Array(A);
  const sortKey = new Float64Array(A);
  const order = new Int32Array(A);
  const raceStrength = new Float64Array(A); // strength plus the grid term, for a race that has a grid
  const qualiKey = new Float64Array(A);
  const qualiOrder = new Int32Array(A);
  const racePosition = new Int32Array(Math.max(1, raceSlots * A));
  const teamTotal = new Float64Array(T);
  const tied: number[] = [];

  const driverWins = new Float64Array(A);
  const teamWins = new Float64Array(T);
  const driverSums = new Float64Array(A);
  const teamSums = new Float64Array(T);

  const baseQuali = (id: string): number[] => baseDrivers.get(id)?.counts.quali ?? [];

  /** Race finishing positions of the given drivers in this simulation, added to `base`. */
  const raceCounts = (members: readonly number[], base: readonly number[]): number[] => {
    const counts = base.slice();
    for (let slot = 0; slot < raceSlots; slot++) {
      for (const m of members) {
        const p = racePosition[slot * A + m]!;
        if (p <= 0) continue;
        while (counts.length < p) counts.push(0);
        counts[p - 1] = (counts[p - 1] ?? 0) + 1;
      }
    }
    return counts;
  };

  const bestOf = (candidates: (Rankable & { id: string })[]): number => {
    let best = 0;
    for (let k = 1; k < candidates.length; k++) {
      const a = candidates[k]!;
      const b = candidates[best]!;
      const cmp = compareStanding(a, b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      if (cmp < 0) best = k;
    }
    return best;
  };

  for (let sim = 0; sim < nSims; sim++) {
    for (let i = 0; i < A; i++) strength[i] = form[i]! + sigma[i]! * rng.normal();
    simPoints.fill(0);

    for (const s of sessions) {
      // the unspecified drivers: retire or draw a finishing key, then order them
      const u = s.racers.length;
      let pace = strength;
      if (s.knownGrid !== null) {
        for (let k = 0; k < u; k++) {
          const d = s.racers[k]!;
          raceStrength[d] = strength[d]! + params.gridWeight * s.knownGrid[d]!;
        }
        pace = raceStrength;
      } else if (s.simulateGrid) {
        // qualifying: the same strengths with their own noise; the order is the grid
        for (let k = 0; k < u; k++) {
          const d = s.racers[k]!;
          qualiKey[d] = strength[d]! + params.qualifyingNoise * rng.gumbel();
          qualiOrder[k] = d;
        }
        for (let a = 1; a < u; a++) {
          const d = qualiOrder[a]!;
          const key = qualiKey[d]!;
          let b = a - 1;
          while (b >= 0 && qualiKey[qualiOrder[b]!]! < key) {
            qualiOrder[b + 1] = qualiOrder[b]!;
            b--;
          }
          qualiOrder[b + 1] = d;
        }
        for (let k = 0; k < u; k++) {
          const d = qualiOrder[k]!;
          raceStrength[d] = strength[d]! + params.gridWeight * s.placeTerm[k]!;
        }
        pace = raceStrength;
      }
      rankRacers(rng, s.racers, pace, s.retire, sortKey, order);
      for (let k = 0; k < u; k++) {
        const d = order[k]!;
        const position = s.free[k]!;
        if (isFinisher(sortKey[d]!)) simPoints[d]! += s.table[position]!;
        if (s.raceSlot >= 0) racePosition[s.raceSlot * A + d] = position;
      }
      for (let k = 0; k < s.fixedDrivers.length; k++) {
        const d = s.fixedDrivers[k]!;
        const position = s.fixedPositions[k]!;
        simPoints[d]! += s.table[position]!;
        if (s.raceSlot >= 0) racePosition[s.raceSlot * A + d] = position;
      }
      if (s.raceSlot >= 0) {
        for (let k = 0; k < s.outDrivers.length; k++) racePosition[s.raceSlot * A + s.outDrivers[k]!] = s.outPositions[k]!;
      }
    }

    // drivers' champion
    let top = -1;
    for (let i = 0; i < A; i++) {
      const total = baseDriverPoints[i]! + simPoints[i]!;
      driverSums[i]! += total;
      if (total > top) top = total;
    }
    tied.length = 0;
    for (let i = 0; i < A; i++) if (baseDriverPoints[i]! + simPoints[i]! === top) tied.push(i);
    if (A > 0) {
      let champion = tied[0]!;
      if (tied.length > 1) {
        const candidates = tied.map((i) => ({
          id: active[i]!,
          points: top,
          counts: { race: raceCounts([i], baseDrivers.get(active[i]!)?.counts.race ?? []), quali: baseQuali(active[i]!) },
        }));
        champion = tied[bestOf(candidates)]!;
      }
      driverWins[champion]! += 1;
    }

    // teams' champion
    for (let t = 0; t < T; t++) teamTotal[t] = baseTeamPoints[t]!;
    for (let i = 0; i < A; i++) if (teamOf[i]! >= 0) teamTotal[teamOf[i]!]! += simPoints[i]!;
    let teamTop = -1;
    for (let t = 0; t < T; t++) {
      teamSums[t]! += teamTotal[t]!;
      if (teamTotal[t]! > teamTop) teamTop = teamTotal[t]!;
    }
    tied.length = 0;
    for (let t = 0; t < T; t++) if (teamTotal[t] === teamTop) tied.push(t);
    if (T > 0) {
      let champion = tied[0]!;
      if (tied.length > 1) {
        const candidates = tied.map((t) => ({
          id: teamIds[t]!,
          points: teamTop,
          counts: { race: raceCounts(membersOfTeam[t]!, baseTeams[t]!.counts.race), quali: baseTeams[t]!.counts.quali },
        }));
        champion = tied[bestOf(candidates)]!;
      }
      teamWins[champion]! += 1;
    }
  }

  // ---- report every driver and team of the state (inactive drivers keep their points and never win)
  const driverWinsOut: Record<string, number> = {};
  const driverSumsOut: Record<string, number> = {};
  for (const d of state.drivers) {
    const i = driverIndex.get(d.code);
    driverWinsOut[d.code] = i === undefined ? 0 : driverWins[i]!;
    driverSumsOut[d.code] = i === undefined ? nSims * (baseDrivers.get(d.code)?.points ?? 0) : driverSums[i]!;
  }
  const teamWinsOut: Record<string, number> = {};
  const teamSumsOut: Record<string, number> = {};
  teamIds.forEach((id, t) => {
    teamWinsOut[id] = teamWins[t]!;
    teamSumsOut[id] = teamSums[t]!;
  });

  return {
    nSims,
    seed,
    params: { ...params, seed },
    driverWins: driverWinsOut,
    teamWins: teamWinsOut,
    driverPointSums: driverSumsOut,
    teamPointSums: teamSumsOut,
    gridKnownRound,
  };
}

export interface RaceForecast {
  nSims: number;
  seed: number;
  /** chance of winning the race, by driver code */
  win: Record<string, number>;
  /** chance of a classified finish in the top three, by driver code */
  podium: Record<string, number>;
}

/**
 * What the model expects of one open race: for each driver in `field`, the chance to win it and to finish on the
 * podium (a retirement is neither). It fits on `state` as it stands and draws the race exactly as `simulateSeason`
 * draws an open session. `field` defaults to the drivers still racing; pass the entry list to forecast a past race
 * (the backtest does). Throws RangeError for nonsense parameters.
 *
 * `grid` (driver code -> starting place) is optional. With `params.gridWeight` above 0, each driver's strength for the
 * race gets `gridWeight * (-ln(place))` added (see `gridTerm`; a driver missing from `grid` starts last). Without a
 * grid, or with `gridWeight` 0, the grid is ignored and the numbers are exactly those of the model without it.
 */
export function forecastRace(
  state: SeasonState,
  partial: Partial<OddsParams> = {},
  field: readonly string[] = state.drivers.filter((d) => d.active).map((d) => d.code),
  grid?: Readonly<Record<string, number>>,
): RaceForecast {
  const params: OddsParams = { ...defaultOddsParams, ...partial };
  checkParams(params);
  const seed = params.seed ?? deriveSeed(state, undefined, params);
  const { nSims } = params;

  const codes = [...field];
  const n = codes.length;
  const { form, sigma, raceRetire } = modelInputs(fitStrengths(state, params), codes, params);

  // the grid term, fixed for the whole race: all zeros when the grid is ignored, so the draws are unchanged
  const gridOffset = new Float64Array(n);
  if (grid !== undefined && params.gridWeight > 0) {
    codes.forEach((c, i) => {
      gridOffset[i] = params.gridWeight * gridTerm(grid[c], n);
    });
  }

  const rng = createRng(seed);
  const racers = Int32Array.from(codes, (_, i) => i);
  const strength = new Float64Array(n);
  const sortKey = new Float64Array(n);
  const order = new Int32Array(n);
  const wins = new Float64Array(n);
  const podiums = new Float64Array(n);

  for (let sim = 0; sim < nSims; sim++) {
    for (let i = 0; i < n; i++) strength[i] = form[i]! + sigma[i]! * rng.normal() + gridOffset[i]!;
    rankRacers(rng, racers, strength, raceRetire, sortKey, order);
    for (let place = 0; place < Math.min(3, n); place++) {
      const d = order[place]!;
      if (!isFinisher(sortKey[d]!)) break; // everyone after a retiree has retired too
      podiums[d]! += 1;
      if (place === 0) wins[d]! += 1;
    }
  }

  const win: Record<string, number> = {};
  const podium: Record<string, number> = {};
  codes.forEach((c, i) => {
    win[c] = wins[i]! / nSims;
    podium[c] = podiums[i]! / nSims;
  });
  return { nSims, seed, win, podium };
}
