/**
 * Path Solver (WCC): "what has to happen for team T to win the constructors' title?"
 * No simulation, no probabilities. The constructors' twin of solver.ts (Phase 5, Step 3). Pure.
 *
 * The extreme case for a team is a one-two (its cars finish P1 and P2). When it does not win a session,
 * the best it can do is P2 and P3 (someone else wins). Built on teamStatus and computeConstructorStandings,
 * so ties follow the countback rules. Both cars' finishes are counted together.
 *
 * Decision b: a driver left unspecified scores 0 and counts as outside the points zone. That equals
 * "harmless fillers take the other positions" and is exact when at least 8 active drivers on eliminated
 * teams exist (a race has eight places behind a one-two).
 * Known limits: rival budgets are independent (two rivals cannot both take P3-P4, and that is not
 * checked), a rival's pace ladder always assumes two cars, and minOneTwos assumes every other team
 * scores nothing from here.
 */
import { gpPoints, sprintPoints } from "./points";
import { remainingSessions } from "./sessions";
import { computeConstructorStandings } from "./standings";
import type { TitleStatus } from "./status";
import { teamCars, teamWitnessScenario } from "./teams";
import { teamStatus } from "./teamStatus";
import type { Scenario, SeasonState, SessionKey } from "./types";

/** Fillers needed to occupy P3..P10 of a race. */
const FILLERS_NEEDED = 8;

/** First places of the pairs a rival may take: P3-P4, P5-P6, P7-P8, P9-P10. 11 = outside the points. */
const PAIR_STARTS = [3, 5, 7, 9] as const;

export interface TeamPathResult {
  team: string;
  /** same as teamStatus */
  verdict: TitleStatus;
  /** true when the "unspecified = harmless filler" assumption provably holds (>= 8 active drivers on eliminated teams) */
  exact: boolean;
  points: number;
  maxPossible: number;
  /**
   * Strict: highest other team's points - this team's points + 1, at least 0.
   * null when eliminated. Ignores what rivals score from here; see rivalBudgets for that.
   */
  pointsNeeded: number | null;
  /** pointsNeeded / what this team can still score, 0..1. null when pointsNeeded is null. */
  difficulty: number | null;
  /**
   * Fewest one-twos in the open sessions such that: the team has that many (races first, then sprints, in
   * calendar order), finishes P2 and P3 in the rest, everyone else unspecified, and ranks first.
   * null when the team cannot be champion.
   */
  minOneTwos: { total: number; races: number; sprints: number } | null;
  /**
   * If the team has the one-two in every open session: for each other team that is not eliminated, how many
   * points that rival may still score without passing, and the first place of the best pair it may take in
   * every session to stay within that (3, 5, 7 or 9; 11 = outside the points; null = the budget is negative,
   * so the team cannot get ahead of that rival). Conservative: a tie settled by countback is not relied on.
   * Empty when the team is eliminated.
   */
  rivalBudgets: { team: string; budget: number; paceLimit: number | null }[];
  /** The minOneTwos witness, merged with the given scenario, ready for the sandbox. null if minOneTwos is null. */
  easiest: Scenario | null;
}

/**
 * First place p of the best pair (P3-P4, P5-P6, P7-P8 or P9-P10) such that taking that pair in every one of
 * `races` races and `sprints` sprints scores at most `budget` points: the smallest of 3, 5, 7, 9 that fits.
 * 11 means outside the points zone (scores 0). null if budget < 0.
 */
export function teamPaceLimit(budget: number, races: number, sprints: number): number | null {
  if (budget < 0) return null;
  for (const p of PAIR_STARTS) {
    const perRace = gpPoints(p) + gpPoints(p + 1);
    const perSprint = sprintPoints(p) + sprintPoints(p + 1);
    if (races * perRace + sprints * perSprint <= budget) return p;
  }
  return 11;
}

/** Throws InvalidScenarioError for a bad scenario and RangeError for an unknown team. */
export function solveWcc(state: SeasonState, team: string, scenario?: Scenario): TeamPathResult {
  const rows = teamStatus(state, scenario); // validates the scenario
  const me = rows.find((r) => r.team === team);
  if (!me) throw new RangeError(`unknown team: ${team}`);

  // Drivers who cannot hurt the team: active drivers on the other teams that are themselves eliminated.
  const cars = teamCars(state);
  const fillers = rows
    .filter((r) => r.team !== team && r.status === "eliminated")
    .reduce((sum, r) => sum + (cars.get(r.team)?.length ?? 0), 0);

  // Open sessions (not locked): races first, then sprints, each in calendar order.
  const open = remainingSessions(state).filter((key) => !(scenario && key in scenario.locks));
  const raceKeys = open.filter((key) => key.endsWith(":race"));
  const sprintKeys = open.filter((key) => key.endsWith(":sprint"));
  const oneTwoOrder: SessionKey[] = [...raceKeys, ...sprintKeys];

  // pointsNeeded and difficulty
  const eliminated = me.status === "eliminated";
  const others = rows.filter((r) => r.team !== team);
  const biggestRival = others.length > 0 ? Math.max(...others.map((r) => r.points)) : Number.NEGATIVE_INFINITY;
  const pointsNeeded = eliminated ? null : Math.max(0, biggestRival - me.points + 1);
  const remainingMax = me.maxPossible - me.points;
  const difficulty =
    pointsNeeded === null ? null : remainingMax === 0 ? 0 : Math.min(1, pointsNeeded / remainingMax);

  // minOneTwos and easiest: scan upward, the team has the one-two in the first w sessions of oneTwoOrder
  // and takes P2 and P3 in the rest.
  let minOneTwos: TeamPathResult["minOneTwos"] = null;
  let easiest: Scenario | null = null;
  if (!eliminated) {
    const oneTwo = teamWitnessScenario(state, scenario, team, 0);
    const behind = teamWitnessScenario(state, scenario, team, 1);
    for (let w = 0; w <= oneTwoOrder.length; w++) {
      const locks: Scenario["locks"] = { ...(scenario?.locks ?? {}) };
      oneTwoOrder.forEach((key, i) => {
        const lock = (i < w ? oneTwo : behind).locks[key];
        if (lock) locks[key] = lock;
      });
      const candidate: Scenario = { locks };
      if (computeConstructorStandings(state, candidate)[0]?.id === team) {
        minOneTwos = { total: w, races: Math.min(w, raceKeys.length), sprints: Math.max(0, w - raceKeys.length) };
        easiest = candidate;
        break;
      }
    }
  }

  // rivalBudgets: the team has the one-two everywhere; only other teams that are not eliminated can threaten
  const rivalBudgets = eliminated
    ? []
    : others
        .filter((r) => r.status !== "eliminated")
        .map((r) => {
          const budget = me.maxPossible - r.points - 1;
          return { team: r.team, budget, paceLimit: teamPaceLimit(budget, raceKeys.length, sprintKeys.length) };
        });

  return {
    team,
    verdict: me.status,
    exact: fillers >= FILLERS_NEEDED,
    points: me.points,
    maxPossible: me.maxPossible,
    pointsNeeded,
    difficulty,
    minOneTwos,
    rivalBudgets,
    easiest,
  };
}
