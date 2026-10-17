/**
 * "Possible?" panel for constructors (Phase 5 Step 7). Pure.
 * Turns the engine's TeamPathResult into the sentences and meter the panel shows. Math only: no model,
 * no probabilities. Mirrors path.ts, which does the same for drivers.
 */
import {
  computeConstructorStandings,
  remainingSessions,
  solveWcc,
  teamStatus,
  type Scenario,
  type SeasonState,
  type TeamPathResult,
  type TitleStatus,
} from "../../engine";
import { DIFFICULTY_BANDS, type DifficultyBands } from "../config";
import { MAX_CONTENDERS, contenderPool } from "./contenders";
import { buildMeter, type DifficultyMeter } from "./path";

export interface TeamPathView {
  team: string;
  name: string;
  verdict: TitleStatus;
  /** Alive and first in the projected table. The leader sees the clinch copy, never "needs 0". */
  isLeader: boolean;
  headline: string;
  meter: DifficultyMeter | null;
  /** What the team has to do, if every rival scores nothing. */
  conditions: string[];
  /** What each other team still in the fight may score if this team finishes 1-2 everywhere. */
  rivals: string[];
  /** Set when the result rests on an assumption that may not hold. */
  estimateNote: string | null;
  /** The easiest winning path, ready to load into the sandbox. Null when there is none. */
  easiest: Scenario | null;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function describeTeamOneTwos(minOneTwos: { total: number; races: number; sprints: number }): string {
  if (minOneTwos.total === 0) {
    return "No one-twos needed: P2 and P3 in every session is enough if every rival scores nothing.";
  }
  const parts: string[] = [];
  if (minOneTwos.races > 0) parts.push(plural(minOneTwos.races, "race", "races"));
  if (minOneTwos.sprints > 0) parts.push(plural(minOneTwos.sprints, "sprint", "sprints"));
  return `Needs at least ${plural(minOneTwos.total, "one-two", "one-twos")} (${parts.join(", ")}) if every rival scores nothing.`;
}

/**
 * `paceLimit`: first place of the best pair the rival may take in every session. 3, 5, 7 or 9 is a real limit
 * (P3 and P4, and so on), 11 means outside the points, null means the rival cannot be beaten this way.
 */
export function describeTeamRivalBudget(winner: string, rival: string, budget: number, paceLimit: number | null): string {
  const lead = `If ${winner} finish 1-2 in every remaining session, ${rival}`;
  if (paceLimit === null) return `${lead} cannot be beaten this way.`;
  const tail =
    paceLimit === 11
      ? "only if they finish outside the points in every session"
      : `never better than P${paceLimit} and P${paceLimit + 1} in every session`;
  return `${lead} can score at most ${plural(budget, "more point", "more points")}, and ${tail}.`;
}

function headlineFor(name: string, verdict: TitleStatus, isLeader: boolean, toClinch: number | null): string {
  if (verdict === "eliminated") return `${name} cannot win the constructors' title any more.`;
  if (verdict === "clinched") return `${name} has clinched the constructors' title.`;
  if (isLeader && toClinch !== null) {
    return `${name} lead. ${plural(toClinch, "more point clinches", "more points clinch")} the constructors' title, if every rival scores the maximum.`;
  }
  return `${name} can still win the constructors' title.`;
}

/** Everything the "Possible?" panel shows for one team, with the owner's locks taken into account. */
export function buildTeamPathView(
  state: SeasonState,
  scenario: Scenario | undefined,
  team: string,
  bands: DifficultyBands = DIFFICULTY_BANDS,
): TeamPathView {
  const result: TeamPathResult = solveWcc(state, team, scenario);
  const row = teamStatus(state, scenario).find((r) => r.team === team);
  const names = new Map(state.teams.map((t) => [t.id, t.name]));
  const nameOf = (id: string) => names.get(id) ?? id;
  const name = nameOf(team);

  const alive = result.verdict === "alive";
  const isLeader = alive && computeConstructorStandings(state, scenario)[0]?.id === team;
  const toClinch = row?.pointsToClinch ?? null;
  const remainingMax = result.maxPossible - result.points;

  const needed = isLeader ? toClinch : result.pointsNeeded;
  const meter = alive && needed !== null && remainingMax > 0 ? buildMeter(needed, remainingMax, isLeader, bands) : null;

  const open = remainingSessions(state).filter((key) => !(scenario && key in scenario.locks));
  const conditions = alive && result.minOneTwos ? [describeTeamOneTwos(result.minOneTwos)] : [];
  const rivals =
    alive && open.length > 0
      ? result.rivalBudgets.map((b) => describeTeamRivalBudget(name, nameOf(b.team), b.budget, b.paceLimit))
      : [];

  return {
    team,
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

export interface TeamOption {
  id: string;
  name: string;
  /** The team can still win the title (real results, not the locks). */
  inFight: boolean;
}

/** Teams for the select: those still in the title fight first, then the rest, each group in table order. */
export function teamOptions(state: SeasonState): TeamOption[] {
  const names = new Map(state.teams.map((t) => [t.id, t.name]));
  const all = teamStatus(state).map((r) => ({
    id: r.team,
    name: names.get(r.team) ?? r.team,
    inFight: r.status !== "eliminated",
  }));
  return [...all.filter((o) => o.inFight), ...all.filter((o) => !o.inFight)];
}

/** The team in second place if it can still win, else the first team that can. Uses the real results. */
export function defaultTeam(state: SeasonState): string | null {
  const rows = teamStatus(state);
  const second = rows[1];
  if (second && second.status !== "eliminated") return second.team;
  return rows.find((r) => r.status !== "eliminated")?.team ?? rows[0]?.team ?? null;
}

export interface TeamLoadPlan {
  /** The contender list to load with the path: what was there, plus the team's cars as far as they fit. */
  contenders: string[];
  /** Plain-words note when a car did not fit, else null. */
  notice: string | null;
}

/**
 * Puts a team's cars into the contender list so the picker shows the locks of its path. Keeps every contender that is
 * already there, adds the cars in order up to the maximum, and says so if one does not fit. A car that can no longer
 * win the drivers' title cannot be a contender; it is left out quietly, because the picker still shows anyone who has
 * a position in a session.
 */
export function planTeamLoad(state: SeasonState, current: readonly string[], cars: readonly string[]): TeamLoadPlan {
  const pool = new Set(contenderPool(state));
  const contenders = [...current];
  const notAdded: string[] = [];
  for (const car of cars) {
    if (contenders.includes(car) || !pool.has(car)) continue;
    if (contenders.length >= MAX_CONTENDERS) notAdded.push(car);
    else contenders.push(car);
  }
  if (notAdded.length === 0) return { contenders, notice: null };
  const names = new Map(state.drivers.map((d) => [d.code, d.name]));
  const who = notAdded.map((c) => names.get(c) ?? c).join(" and ");
  return {
    contenders,
    notice: `You can follow up to ${MAX_CONTENDERS} contenders, so ${who} ${notAdded.length === 1 ? "was" : "were"} not added. Remove one to make room.`,
  };
}
