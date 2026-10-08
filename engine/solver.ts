/**
 * Path Solver (WDC): "what has to happen for driver X to be champion?" No simulation, no probabilities.
 * Built on driverStatus and computeDriverStandings, so ties follow the countback rules. Pure.
 *
 * Decision b: a driver left unspecified scores 0 and counts as outside the points zone. That equals
 * "harmless fillers take the other positions" and is exact when at least 9 active non-contenders exist.
 * Known limits: rival budgets are independent (joint feasibility of several rivals is not checked), and
 * minWins assumes every other contender scores nothing from here.
 */
import { gpPoints, sprintPoints } from "./points";
import { activeDrivers, remainingSessions } from "./sessions";
import { driverStatus, type TitleStatus } from "./status";
import { computeDriverStandings } from "./standings";
import type { Scenario, SeasonState, SessionKey } from "./types";

/** Fillers needed to occupy P2..P10 of a race. */
const FILLERS_NEEDED = 9;

export interface PathResult {
  driver: string;
  /** same as driverStatus */
  verdict: TitleStatus;
  /** true when the "unspecified = harmless filler" assumption provably holds (>= 9 active eliminated drivers) */
  exact: boolean;
  points: number;
  maxPossible: number;
  /**
   * Strict: highest other driver's points - this driver's points + 1, at least 0.
   * null when eliminated. Ignores what rivals score from here; see rivalBudgets for that.
   */
  pointsNeeded: number | null;
  /** pointsNeeded / what this driver can still score, 0..1. null when pointsNeeded is null. */
  difficulty: number | null;
  /**
   * Fewest wins in the remaining sessions such that: X wins that many (races first, then sprints, in
   * calendar order), finishes P2 in the rest, everyone else unspecified, and X ranks first.
   * null when X cannot be champion.
   */
  minWins: { total: number; races: number; sprints: number } | null;
  /**
   * If X wins every remaining session: for each other contender, how many points that rival may still
   * score without passing X, and the best position they may finish in every session to stay within that
   * (1-10, 11 = outside the points zone, null = the budget is negative, so X cannot get ahead of them).
   * Conservative: a tie settled by countback is not relied on.
   */
  rivalBudgets: { driver: string; budget: number; paceLimit: number | null }[];
  /** The minWins witness, merged with the given scenario, ready for the sandbox. null if minWins is null. */
  easiest: Scenario | null;
}

/**
 * Smallest position p (1-10) such that finishing p in every one of `races` races and `sprints` sprints
 * scores at most `budget` points. 11 means outside the points zone (scores 0). null if budget < 0.
 */
export function paceLimit(budget: number, races: number, sprints: number): number | null {
  if (budget < 0) return null;
  for (let p = 1; p <= 10; p++) {
    if (races * gpPoints(p) + sprints * sprintPoints(p) <= budget) return p;
  }
  return 11;
}

export function solveWdc(state: SeasonState, driver: string, scenario?: Scenario): PathResult {
  const rows = driverStatus(state, scenario); // validates the scenario
  const me = rows.find((r) => r.driver === driver);
  if (!me) throw new RangeError(`unknown driver: ${driver}`);

  const active = new Set(activeDrivers(state));
  const contenders = rows.filter((r) => r.status !== "eliminated");
  const fillers = rows.filter((r) => active.has(r.driver) && r.status === "eliminated").length;

  // Remaining sessions that are not locked: races first, then sprints, each in calendar order.
  const open = remainingSessions(state).filter((key) => !(scenario && key in scenario.locks));
  const races = open.filter((key) => key.endsWith(":race"));
  const sprints = open.filter((key) => key.endsWith(":sprint"));
  const winOrder: SessionKey[] = [...races, ...sprints];

  // pointsNeeded and difficulty
  const others = rows.filter((r) => r.driver !== driver);
  const biggestRival = others.length > 0 ? Math.max(...others.map((r) => r.points)) : Number.NEGATIVE_INFINITY;
  const pointsNeeded = me.status === "eliminated" ? null : Math.max(0, biggestRival - me.points + 1);
  const remainingMax = me.maxPossible - me.points;
  const difficulty =
    pointsNeeded === null ? null : remainingMax === 0 ? 0 : Math.min(1, pointsNeeded / remainingMax);

  // minWins and easiest: scan upward, X wins the first w sessions of winOrder and is P2 in the rest.
  let minWins: PathResult["minWins"] = null;
  let easiest: Scenario | null = null;
  if (active.has(driver)) {
    for (let w = 0; w <= winOrder.length; w++) {
      const locks: Scenario["locks"] = { ...(scenario?.locks ?? {}) };
      winOrder.forEach((key, i) => {
        locks[key] = { fixed: { [driver]: i < w ? 1 : 2 } };
      });
      const candidate: Scenario = { locks };
      if (computeDriverStandings(state, candidate)[0]?.id === driver) {
        minWins = { total: w, races: Math.min(w, races.length), sprints: Math.max(0, w - races.length) };
        easiest = candidate;
        break;
      }
    }
  }

  // rivalBudgets: X wins every remaining session; only other contenders can threaten
  const rivalBudgets = contenders
    .filter((r) => r.driver !== driver)
    .map((r) => {
      const budget = me.maxPossible - r.points - 1;
      return { driver: r.driver, budget, paceLimit: paceLimit(budget, races.length, sprints.length) };
    });

  return {
    driver,
    verdict: me.status,
    exact: fillers >= FILLERS_NEEDED,
    points: me.points,
    maxPossible: me.maxPossible,
    pointsNeeded,
    difficulty,
    minWins,
    rivalBudgets,
    easiest,
  };
}
