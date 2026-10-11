/** Plain data shapes shared by the engine, the loader and the tests. No logic here. */
import type { DistanceTier, SessionKind } from "./points";

export type { DistanceTier, SessionKind };

/** `${round}:${kind}`, e.g. "17:race" or "17:sprint". */
export type SessionKey = `${number}:${SessionKind}`;

export interface ResultRow {
  round: number;
  kind: SessionKind;
  /** driver_abbr */
  driver: string;
  /** constructor_id */
  team: string;
  position: number;
  points: number;
}

export interface QualiRow {
  round: number;
  driver: string;
  position: number;
}

export interface RoundInfo {
  round: number;
  name: string;
  hasSprint: boolean;
  status: "completed" | "scheduled";
}

export interface SeasonState {
  season: number;
  /** latest completed round (0 if none) */
  asOfRound: number;
  rounds: RoundInfo[];
  results: ResultRow[];
  qualifying: QualiRow[];
  drivers: { code: string; name: string; active: boolean }[];
  teams: { id: string; name: string }[];
  health: { status: "ok" | "warn" | "fail"; checkedAt: string };
  schemaVersion?: number;
}

export interface SessionLock {
  /** driver -> position inside the points zone (race 1-10, sprint 1-8), or "out" */
  fixed: Record<string, number | "out">;
  /** shortened race; default "full". A sprint lock means a completed sprint. */
  tier?: DistanceTier;
}

export interface Scenario {
  locks: Record<SessionKey, SessionLock>;
}
