/**
 * Championship odds: one function the API and the UI both call (Phase 3, Step 6).
 * Runs the season simulation, adds the exact title status, and formats probabilities so that a sample never claims
 * a certainty it cannot have. Pure.
 */
import { simulateSeason, type OddsParams } from "./simulate";
import { driverStatus, type TitleStatus } from "./status";
import type { Scenario, SeasonState } from "./types";

/** Odds are marked low confidence while fewer rounds than this are complete. */
export const LOW_CONFIDENCE_ROUNDS = 5;

export interface OddsRow {
  /** driver code, or constructor id */
  id: string;
  /** simulated seasons won */
  wins: number;
  /** wins / nSims */
  probability: number;
  /** `formatProbability(probability)` */
  display: string;
  /** mean final points over the simulations */
  avgPoints: number;
  /** exact title status (drivers only) */
  status?: TitleStatus;
}

export interface OddsResult {
  asOfRound: number;
  /** rounds with status "completed" */
  roundsCompleted: number;
  /** true when fewer than 5 rounds are complete */
  lowConfidence: boolean;
  nSims: number;
  seed: number;
  params: OddsParams;
  /** drivers with wins > 0, or alive or clinched; best first */
  wdc: OddsRow[];
  /** teams with wins > 0; best first */
  wcc: OddsRow[];
  /** largest sqrt(p (1 - p) / nSims) over all drivers and teams */
  maxStdError: number;
}

/**
 * "<1%" below 1%, one decimal from 1% to under 10% ("3.4%"), a whole percent from 10% to 99% ("47%"), ">99%" above.
 * Never "0%" or "100%": a simulation cannot prove either. Throws RangeError for a value outside 0..1.
 */
export function formatProbability(p: number): string {
  if (!(p >= 0 && p <= 1)) throw new RangeError(`probability must be between 0 and 1, got ${p}`);
  if (p < 0.01) return "<1%";
  if (p > 0.99) return ">99%";
  if (p < 0.1) {
    const tenths = Math.round(p * 1000); // tenths of a percent; 100 means rounding reached 10.0
    if (tenths < 100) return `${Math.floor(tenths / 10)}.${tenths % 10}%`;
    return "10%";
  }
  return `${Math.round(p * 100)}%`;
}

function table(
  wins: Record<string, number>,
  pointSums: Record<string, number>,
  nSims: number,
  keep: (id: string) => boolean,
  statusOf?: (id: string) => TitleStatus | undefined,
): OddsRow[] {
  const rows: OddsRow[] = [];
  for (const [id, w] of Object.entries(wins)) {
    if (w <= 0 && !keep(id)) continue;
    const probability = w / nSims;
    const row: OddsRow = {
      id,
      wins: w,
      probability,
      display: formatProbability(probability),
      avgPoints: (pointSums[id] ?? 0) / nSims,
    };
    const status = statusOf?.(id);
    if (status !== undefined) row.status = status;
    rows.push(row);
  }
  return rows.sort((a, b) => b.wins - a.wins || b.avgPoints - a.avgPoints || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Throws InvalidScenarioError for a bad scenario and RangeError for nonsense parameters. */
export function computeOdds(state: SeasonState, scenario?: Scenario, params: Partial<OddsParams> = {}): OddsResult {
  const sim = simulateSeason(state, scenario, params);
  const status = new Map(driverStatus(state, scenario).map((r) => [r.driver, r.status]));
  const { nSims } = sim;

  const wdc = table(
    sim.driverWins,
    sim.driverPointSums,
    nSims,
    (id) => status.get(id) !== undefined && status.get(id) !== "eliminated",
    (id) => status.get(id),
  );
  const wcc = table(sim.teamWins, sim.teamPointSums, nSims, () => false);

  const everyone = [...Object.values(sim.driverWins), ...Object.values(sim.teamWins)];
  const maxStdError = Math.max(0, ...everyone.map((w) => Math.sqrt(((w / nSims) * (1 - w / nSims)) / nSims)));
  const roundsCompleted = state.rounds.filter((r) => r.status === "completed").length;

  return {
    asOfRound: state.asOfRound,
    roundsCompleted,
    lowConfidence: roundsCompleted < LOW_CONFIDENCE_ROUNDS,
    nSims,
    seed: sim.seed,
    params: sim.params,
    wdc,
    wcc,
    maxStdError,
  };
}
