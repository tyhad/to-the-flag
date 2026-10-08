/** Helpers for session keys and "what is left to run". Pure. */
import type { SeasonState, SessionKey, SessionKind } from "./types";

export function sessionKey(round: number, kind: SessionKind): SessionKey {
  return `${round}:${kind}`;
}

export function parseSessionKey(key: string): { round: number; kind: SessionKind } {
  const m = /^(\d+):(race|sprint)$/.exec(key);
  const round = Number(m?.[1]);
  if (!m || !Number.isInteger(round) || round < 1) {
    throw new RangeError(`invalid session key: "${key}" (expected "<round>:race" or "<round>:sprint")`);
  }
  return { round, kind: m[2] as SessionKind };
}

/** Codes of drivers who can still score (decision a). */
export function activeDrivers(state: SeasonState): string[] {
  return state.drivers.filter((d) => d.active).map((d) => d.code);
}

/**
 * Decision e: every race, and every sprint of a sprint weekend, that has no result rows.
 * Calendar order: by round, sprint before race within a weekend.
 */
export function remainingSessions(state: SeasonState): SessionKey[] {
  const done = new Set<string>(state.results.map((r) => sessionKey(r.round, r.kind)));
  const out: SessionKey[] = [];
  for (const round of [...state.rounds].sort((a, b) => a.round - b.round)) {
    const sprint = sessionKey(round.round, "sprint");
    const race = sessionKey(round.round, "race");
    if (round.hasSprint && !done.has(sprint)) out.push(sprint);
    if (!done.has(race)) out.push(race);
  }
  return out;
}
