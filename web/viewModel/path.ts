/**
 * "Possible?" panel view-model (DESIGN.md section 6, section 8 copy rules). Pure.
 * Turns the engine's PathResult into the sentences and meter the panel shows. Math only: no model,
 * no probabilities. The panel never shows what is likely, only what is possible.
 */
import {
  computeDriverStandings,
  driverStatus,
  remainingSessions,
  solveWdc,
  type PathResult,
  type Scenario,
  type SeasonState,
  type TitleStatus,
} from "../../engine";
import { DIFFICULTY_BANDS, type DifficultyBands } from "../config";

export type DifficultyBand = "green" | "yellow" | "orange";

export interface DifficultyMeter {
  /** Points needed, never more than what is left to win. */
  needed: number;
  /** The most the driver can still score. */
  total: number;
  /** needed / total, 0..1. */
  share: number;
  /** share as a whole percent, for display. */
  percent: number;
  band: DifficultyBand;
  /** "85 of 183 points (46%)" */
  label: string;
  caption: string;
}

export interface PathView {
  driver: string;
  name: string;
  verdict: TitleStatus;
  /** Alive and first in the projected table. The leader sees the clinch copy, never "needs 0". */
  isLeader: boolean;
  headline: string;
  meter: DifficultyMeter | null;
  /** What the driver has to do, if every rival scores nothing. */
  conditions: string[];
  /** What each other contender may still score if this driver wins everything. */
  rivals: string[];
  /** Set when the result rests on an assumption that may not hold. */
  estimateNote: string | null;
  /** The easiest winning path, ready to load into the sandbox. Null when there is none. */
  easiest: Scenario | null;
}

export function difficultyBand(share: number, bands: DifficultyBands = DIFFICULTY_BANDS): DifficultyBand {
  if (share <= bands.green) return "green";
  if (share <= bands.yellow) return "yellow";
  return "orange";
}

export function buildMeter(
  needed: number,
  total: number,
  toClinch: boolean,
  bands: DifficultyBands = DIFFICULTY_BANDS,
): DifficultyMeter {
  // A tie that only countback settles can need one point more than exists. Show it as everything.
  const shown = Math.min(needed, total);
  const share = total === 0 ? 0 : shown / total;
  const percent = Math.round(share * 100);
  return {
    needed: shown,
    total,
    share,
    percent,
    band: difficultyBand(share, bands),
    label: `${shown} of ${total} points (${percent}%)`,
    caption: `Share of the remaining points needed ${toClinch ? "to clinch" : "to take the lead"}. Not a probability.`,
  };
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function describeMinWins(minWins: { total: number; races: number; sprints: number }): string {
  if (minWins.total === 0) return "No wins needed: P2 in every session is enough if every rival scores nothing.";
  const parts: string[] = [];
  if (minWins.races > 0) parts.push(plural(minWins.races, "race", "races"));
  if (minWins.sprints > 0) parts.push(plural(minWins.sprints, "sprint", "sprints"));
  return `Needs at least ${plural(minWins.total, "win", "wins")} (${parts.join(", ")}) if every rival scores nothing.`;
}

/**
 * `paceLimit`: best position the rival may take in every session. 1 means no limit at all (even winning
 * every session is not enough to catch up), 2 to 10 is a real limit, 11 means outside the points,
 * null means the rival cannot be beaten this way.
 */
export function describeRivalBudget(winner: string, rival: string, budget: number, paceLimit: number | null): string {
  const lead = `If ${winner} wins every remaining session, ${rival}`;
  if (paceLimit === null) return `${lead} cannot be beaten this way.`;
  if (paceLimit === 1) return `${lead} cannot catch ${winner} however they finish.`;
  const tail = paceLimit === 11 ? "outside the points" : `P${paceLimit} or worse`;
  return `${lead} can score at most ${plural(budget, "more point", "more points")}, and only if they finish ${tail} in every session.`;
}

/** True when two scenarios lock the same sessions with the same choices. */
export function sameScenario(a: Scenario, b: Scenario): boolean {
  const normal = (s: Scenario) =>
    JSON.stringify(
      Object.keys(s.locks)
        .sort()
        .map((key) => {
          const lock = s.locks[key as keyof typeof s.locks];
          const fixed = Object.entries(lock?.fixed ?? {}).sort(([x], [y]) => x.localeCompare(y));
          return [key, fixed, lock?.tier ?? null];
        }),
    );
  return normal(a) === normal(b);
}

function headlineFor(name: string, verdict: TitleStatus, isLeader: boolean, toClinch: number | null): string {
  if (verdict === "eliminated") return `${name} cannot win the title any more.`;
  if (verdict === "clinched") return `${name} has clinched the title.`;
  if (isLeader && toClinch !== null) {
    return `${name} leads. ${plural(toClinch, "more point clinches", "more points clinch")} the title, if every rival scores the maximum.`;
  }
  return `${name} can still win the title.`;
}

/** Everything the "Possible?" panel shows for one driver, with the owner's locks taken into account. */
export function buildPathView(
  state: SeasonState,
  scenario: Scenario | undefined,
  driver: string,
  bands: DifficultyBands = DIFFICULTY_BANDS,
): PathView {
  const result: PathResult = solveWdc(state, driver, scenario);
  const row = driverStatus(state, scenario).find((r) => r.driver === driver);
  const names = new Map(state.drivers.map((d) => [d.code, d.name]));
  const nameOf = (code: string) => names.get(code) ?? code;
  const name = nameOf(driver);

  const alive = result.verdict === "alive";
  const isLeader = alive && computeDriverStandings(state, scenario)[0]?.id === driver;
  const toClinch = row?.pointsToClinch ?? null;
  const remainingMax = result.maxPossible - result.points;

  const needed = isLeader ? toClinch : result.pointsNeeded;
  const meter = alive && needed !== null && remainingMax > 0 ? buildMeter(needed, remainingMax, isLeader, bands) : null;

  const open = remainingSessions(state).filter((key) => !(scenario && key in scenario.locks));
  const conditions = alive && result.minWins ? [describeMinWins(result.minWins)] : [];
  const rivals =
    alive && open.length > 0
      ? result.rivalBudgets.map((b) => describeRivalBudget(name, nameOf(b.driver), b.budget, b.paceLimit))
      : [];

  return {
    driver,
    name,
    verdict: result.verdict,
    isLeader,
    headline: headlineFor(name, result.verdict, isLeader, toClinch),
    meter,
    conditions,
    rivals,
    estimateNote: alive && !result.exact ? "Estimate: too few other drivers are left to fill the points positions." : null,
    easiest: alive ? result.easiest : null,
  };
}
