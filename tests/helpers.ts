/**
 * Test-only builder for small, readable hand-made seasons.
 *
 *   const state = makeState({
 *     rounds: 4, sprints: [2], completed: 2,
 *     teams: { red: ["AAA", "BBB"], blue: ["CCC", "DDD"] },
 *     results: {
 *       "1:race": ["AAA", "BBB", "CCC"],            // listed drivers get P1, P2, ... (FIA full points)
 *       "2:race": { order: ["BBB", "AAA"], tier: "ge50" },
 *       "2:sprint": ["AAA", "CCC"],
 *     },
 *     quali: { 1: ["AAA", "BBB"] },
 *   });
 *
 * Rules: rounds 1..completed are "completed" and must have a race (and sprint, if any) result.
 * A driver is active if listed in the results of round `completed` (decision a).
 * Driver name = code, team name = id. Unlisted drivers get no result row.
 */
import { gpPoints, sprintPoints, type DistanceTier } from "../engine/points";
import { parseSessionKey } from "../engine/sessions";
import type { ResultRow, RoundInfo, SeasonState, SessionKey } from "../engine/types";

export type SessionSpec = string[] | { order: string[]; tier?: DistanceTier };

export interface MakeStateOptions {
  season?: number;
  /** total number of rounds in the calendar */
  rounds: number;
  /** rounds that have a sprint */
  sprints?: number[];
  /** rounds 1..completed are completed (default 0) */
  completed?: number;
  /** team id -> driver codes */
  teams: Record<string, string[]>;
  results?: Partial<Record<SessionKey, SessionSpec>>;
  /** round -> driver codes in qualifying order */
  quali?: Record<number, string[]>;
  /** a driver drives for another team from this round on (decision d) */
  teamChanges?: { driver: string; team: string; fromRound: number }[];
  health?: SeasonState["health"];
  schemaVersion?: number;
}

export function makeState(opts: MakeStateOptions): SeasonState {
  const completed = opts.completed ?? 0;
  if (completed > opts.rounds) throw new Error("makeState: completed > rounds");
  const sprintRounds = new Set(opts.sprints ?? []);

  const rounds: RoundInfo[] = Array.from({ length: opts.rounds }, (_, i) => {
    const round = i + 1;
    return {
      round,
      name: `Round ${round}`,
      hasSprint: sprintRounds.has(round),
      status: round <= completed ? "completed" : "scheduled",
    };
  });
  const roundInfo = new Map(rounds.map((r) => [r.round, r]));

  const baseTeam = new Map<string, string>();
  for (const [team, drivers] of Object.entries(opts.teams)) {
    for (const d of drivers) baseTeam.set(d, team);
  }
  const changes = [...(opts.teamChanges ?? [])].sort((a, b) => a.fromRound - b.fromRound);
  const teamAt = (driver: string, round: number): string => {
    let team = baseTeam.get(driver);
    for (const c of changes) if (c.driver === driver && c.fromRound <= round) team = c.team;
    if (team === undefined) throw new Error(`makeState: driver ${driver} is not in any team`);
    return team;
  };

  const results: ResultRow[] = [];
  for (const [key, spec] of Object.entries(opts.results ?? {})) {
    if (spec === undefined) continue;
    const { round, kind } = parseSessionKey(key);
    const info = roundInfo.get(round);
    if (!info) throw new Error(`makeState: ${key} is outside the ${opts.rounds}-round calendar`);
    if (kind === "sprint" && !info.hasSprint) throw new Error(`makeState: round ${round} has no sprint`);
    const order = Array.isArray(spec) ? spec : spec.order;
    const tier: DistanceTier = Array.isArray(spec) ? "full" : (spec.tier ?? "full");
    if (new Set(order).size !== order.length) throw new Error(`makeState: duplicate driver in ${key}`);
    order.forEach((driver, i) => {
      results.push({
        round,
        kind,
        driver,
        team: teamAt(driver, round),
        position: i + 1,
        points: kind === "race" ? gpPoints(i + 1, tier) : sprintPoints(i + 1),
      });
    });
  }
  results.sort(
    (a, b) => a.round - b.round || (a.kind === b.kind ? 0 : a.kind === "race" ? -1 : 1) || a.position - b.position,
  );

  const have = new Set(results.map((r) => `${r.round}:${r.kind}`));
  for (const r of rounds) {
    if (r.status !== "completed") continue;
    if (!have.has(`${r.round}:race`)) throw new Error(`makeState: completed round ${r.round} has no race result`);
    if (r.hasSprint && !have.has(`${r.round}:sprint`)) {
      throw new Error(`makeState: completed round ${r.round} has no sprint result`);
    }
  }

  const driverCodes = new Set<string>([...baseTeam.keys(), ...results.map((r) => r.driver)]);
  const activeCodes = new Set(results.filter((r) => r.round === completed).map((r) => r.driver));
  const drivers = [...driverCodes]
    .sort()
    .map((code) => ({ code, name: code, active: activeCodes.has(code) }));

  const teamIds = new Set<string>([...Object.keys(opts.teams), ...changes.map((c) => c.team)]);
  const teams = [...teamIds].sort().map((id) => ({ id, name: id }));

  const qualifying = Object.entries(opts.quali ?? {}).flatMap(([round, order]) =>
    order.map((driver, i) => ({ round: Number(round), driver, position: i + 1 })),
  );

  return {
    season: opts.season ?? 2026,
    asOfRound: completed,
    rounds,
    results,
    qualifying,
    drivers,
    teams,
    health: opts.health ?? { status: "ok", checkedAt: "2026-01-01T00:00:00Z" },
    schemaVersion: opts.schemaVersion ?? 2,
  };
}
