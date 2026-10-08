/**
 * Projected driver and constructor tables: real results + scenario locks, ranked with countback.
 * Locked sessions add points per decision g. Unspecified drivers add 0 (decision b). Pure.
 */
import {
  DEFAULT_COUNTBACK,
  addPosition,
  compareStanding,
  emptyCounts,
  type CountbackOptions,
  type PositionCounts,
} from "./countback";
import { gpPoints, sprintPoints } from "./points";
import { validateScenario } from "./scenario";
import { parseSessionKey } from "./sessions";
import type { Scenario, SeasonState } from "./types";

export interface StandingRow {
  /** driver code, or constructor id */
  id: string;
  /** points including the scenario's locked sessions */
  points: number;
  /** points from real results only */
  basePoints: number;
  /** points - basePoints: what the locks added */
  delta: number;
  /** 1-based position in the projected table */
  rank: number;
  /** 1-based position in the table without locks (rank change = baseRank - rank) */
  baseRank: number;
  counts: PositionCounts;
}

export interface StandingsOptions {
  countback?: Partial<CountbackOptions>;
}

interface Acc {
  id: string;
  points: number;
  counts: PositionCounts;
}

type Entity = "driver" | "team";

/** driver -> [{ round, team }] ascending by round, built from result rows (decision d). */
function teamHistory(state: SeasonState): Map<string, { round: number; team: string }[]> {
  const history = new Map<string, { round: number; team: string }[]>();
  for (const r of state.results) {
    const list = history.get(r.driver) ?? [];
    list.push({ round: r.round, team: r.team });
    history.set(r.driver, list);
  }
  for (const list of history.values()) list.sort((a, b) => a.round - b.round);
  return history;
}

/** Team a driver drove for at `round`: latest result at or before it, else the earliest known. */
function teamAt(history: Map<string, { round: number; team: string }[]>, driver: string, round: number): string | undefined {
  const list = history.get(driver);
  if (!list || list.length === 0) return undefined;
  let found = list[0];
  for (const entry of list) {
    if (entry.round <= round) found = entry;
    else break;
  }
  return found?.team;
}

function accumulate(
  state: SeasonState,
  entity: Entity,
  scenario: Scenario | undefined,
  countback: CountbackOptions,
): Map<string, Acc> {
  const accs = new Map<string, Acc>();
  const get = (id: string): Acc => {
    let acc = accs.get(id);
    if (!acc) {
      acc = { id, points: 0, counts: emptyCounts() };
      accs.set(id, acc);
    }
    return acc;
  };
  if (entity === "driver") for (const d of state.drivers) get(d.code);
  else for (const t of state.teams) get(t.id);

  const history = teamHistory(state);
  const countsAsRace = (kind: "race" | "sprint") => kind === "race" || countback.includeSprint;

  for (const r of state.results) {
    const acc = get(entity === "driver" ? r.driver : r.team);
    acc.points += r.points;
    if (countsAsRace(r.kind)) addPosition(acc.counts.race, r.position);
  }

  for (const q of state.qualifying) {
    const id = entity === "driver" ? q.driver : teamAt(history, q.driver, q.round);
    if (id !== undefined) addPosition(get(id).counts.quali, q.position);
  }

  if (scenario) {
    for (const [key, lock] of Object.entries(scenario.locks)) {
      const { kind } = parseSessionKey(key);
      for (const [driver, fixed] of Object.entries(lock.fixed)) {
        if (fixed === "out") continue;
        // A tier only shortens a race; a sprint has a single scale.
        const points = kind === "race" ? gpPoints(fixed, lock.tier ?? "full") : sprintPoints(fixed);
        // Locked rounds are in the future, so the driver's current (latest known) team gets the points.
        const id = entity === "driver" ? driver : teamAt(history, driver, Number.POSITIVE_INFINITY);
        if (id === undefined) continue;
        const acc = get(id);
        acc.points += points;
        if (countsAsRace(kind)) addPosition(acc.counts.race, fixed);
      }
    }
  }
  return accs;
}

function ranked(accs: Map<string, Acc>): Acc[] {
  return [...accs.values()].sort(
    (a, b) => compareStanding(a, b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

function build(
  state: SeasonState,
  entity: Entity,
  scenario: Scenario | undefined,
  options: StandingsOptions | undefined,
): StandingRow[] {
  const countback: CountbackOptions = { ...DEFAULT_COUNTBACK, ...options?.countback };
  if (scenario) validateScenario(state, scenario);

  const base = ranked(accumulate(state, entity, undefined, countback));
  const baseRank = new Map(base.map((a, i) => [a.id, i + 1]));
  const basePoints = new Map(base.map((a) => [a.id, a.points]));
  const projected = scenario ? ranked(accumulate(state, entity, scenario, countback)) : base;

  return projected.map((a, i) => {
    const before = basePoints.get(a.id) ?? 0;
    return {
      id: a.id,
      points: a.points,
      basePoints: before,
      delta: a.points - before,
      rank: i + 1,
      baseRank: baseRank.get(a.id) ?? i + 1,
      counts: a.counts,
    };
  });
}

/** Ties on points follow countback; a full tie falls back to the driver code. Throws InvalidScenarioError. */
export function computeDriverStandings(
  state: SeasonState,
  scenario?: Scenario,
  options?: StandingsOptions,
): StandingRow[] {
  return build(state, "driver", scenario, options);
}

/** Same rules; points follow constructor_id on each result row (decision d). */
export function computeConstructorStandings(
  state: SeasonState,
  scenario?: Scenario,
  options?: StandingsOptions,
): StandingRow[] {
  return build(state, "team", scenario, options);
}
