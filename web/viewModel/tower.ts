/**
 * Standings tower view-model (DESIGN.md section 6). Pure: no DOM, no fetch.
 * Turns the engine's tables into plain rows the components draw as they are.
 */
import {
  computeConstructorStandings,
  computeDriverStandings,
  driverStatus,
  parseSessionKey,
  remainingSessions,
  sessionMaxPoints,
  type Scenario,
  type SeasonState,
  type TitleStatus,
} from "../../engine";

export type TowerTab = "wdc" | "wcc";

/** The engine's title status, plus "longShot" for an alive driver who is far behind. */
export type TowerStatus = TitleStatus | "longShot";

export interface TowerRow {
  /** Driver code, or constructor id. Stable key for the row. */
  id: string;
  /** What the row shows: the driver code, or the constructor's name. */
  label: string;
  /** Full driver or constructor name, for tooltips and screen readers. */
  name: string;
  /** Constructor id behind the 3px color strip (`teamColor`). Empty if a driver has no result yet. */
  teamId: string;
  /** Position in the projected table (1-based). */
  rank: number;
  /** Position in the table without locks. */
  baseRank: number;
  /** Places gained (positive) or lost (negative) because of the locks: baseRank - rank. */
  rankChange: number;
  /** Points from real results only. */
  basePoints: number;
  /** Points including the locked sessions. */
  points: number;
  /** Points the locks added: points - basePoints. */
  pointsAdded: number;
  /** Title status for a driver who is racing; null for constructors and for inactive drivers. */
  status: TowerStatus | null;
  /** The driver is not in the latest round's results. */
  inactive: boolean;
  /** An active driver who can no longer win the title. */
  eliminated: boolean;
}

/**
 * An alive driver is a "long shot" when the gap to the leader is at least this share of the points
 * still on offer in unlocked sessions. Two thirds: they would need to take two thirds of everything
 * left just to draw level, before the leader scores again. This is plain arithmetic, not a model.
 */
export const LONG_SHOT_GAP_SHARE = 2 / 3;

export interface Delta {
  text: string;
  tone: "up" | "down" | "none";
  /** The same change in words, for screen readers. */
  description: string;
}

const places = (n: number): string => `${n} ${n === 1 ? "place" : "places"}`;

/** `▲ 12` for 12 places gained, `▼ 8` for 8 lost, `●` for no change. */
export function formatDelta(rankChange: number): Delta {
  if (rankChange > 0) return { text: `▲ ${rankChange}`, tone: "up", description: `Up ${places(rankChange)}` };
  if (rankChange < 0) return { text: `▼ ${-rankChange}`, tone: "down", description: `Down ${places(-rankChange)}` };
  return { text: "●", tone: "none", description: "No change in position" };
}

/** Points as integers; half points keep one decimal. */
export function formatPoints(points: number): string {
  return Number.isInteger(points) ? String(points) : points.toFixed(1);
}

export interface StatusTagView {
  label: string;
  tone: TowerStatus | "inactive";
}

const STATUS_LABELS: Record<TowerStatus, string> = {
  clinched: "Clinched",
  alive: "Alive",
  longShot: "Long shot",
  eliminated: "Eliminated",
};

/** The tag for a row, or null when the row has none (constructors). */
export function statusTag(row: Pick<TowerRow, "status" | "inactive">): StatusTagView | null {
  if (row.inactive) return { label: "not racing", tone: "inactive" };
  if (row.status === null) return null;
  return { label: STATUS_LABELS[row.status], tone: row.status };
}

/** Most points still available: every remaining session the scenario has not locked, at its maximum. */
function pointsOnOffer(state: SeasonState, scenario: Scenario | undefined): number {
  const locked = scenario?.locks ?? {};
  let total = 0;
  for (const key of remainingSessions(state)) {
    if (key in locked) continue;
    total += sessionMaxPoints(parseSessionKey(key).kind);
  }
  return total;
}

/** The constructor each driver last scored for (their current team). */
function currentTeams(state: SeasonState): Map<string, string> {
  const latest = new Map<string, { round: number; team: string }>();
  for (const r of state.results) {
    const seen = latest.get(r.driver);
    if (!seen || r.round >= seen.round) latest.set(r.driver, { round: r.round, team: r.team });
  }
  return new Map([...latest].map(([driver, v]) => [driver, v.team]));
}

/**
 * Rows for the tower, in projected order. Throws InvalidScenarioError for a bad scenario;
 * validate first (or catch) when the scenario comes from the user.
 */
export function buildTowerRows(state: SeasonState, scenario: Scenario | undefined, tab: TowerTab): TowerRow[] {
  return tab === "wdc" ? driverRows(state, scenario) : constructorRows(state, scenario);
}

function driverRows(state: SeasonState, scenario: Scenario | undefined): TowerRow[] {
  const table = computeDriverStandings(state, scenario);
  const statuses = new Map(driverStatus(state, scenario).map((s) => [s.driver, s]));
  const drivers = new Map(state.drivers.map((d) => [d.code, d]));
  const teams = currentTeams(state);
  const remaining = pointsOnOffer(state, scenario);

  return table.map((row) => {
    const driver = drivers.get(row.id);
    const inactive = driver ? !driver.active : false;
    const gap = statuses.get(row.id)?.gapToLeader ?? 0;
    let status: TowerStatus | null = null;
    if (!inactive) {
      const title = statuses.get(row.id)?.status ?? "eliminated";
      const longShot = title === "alive" && remaining > 0 && gap / remaining >= LONG_SHOT_GAP_SHARE - 1e-9;
      status = longShot ? "longShot" : title;
    }
    return {
      id: row.id,
      label: row.id,
      name: driver?.name ?? row.id,
      teamId: teams.get(row.id) ?? "",
      rank: row.rank,
      baseRank: row.baseRank,
      rankChange: row.baseRank - row.rank,
      basePoints: row.basePoints,
      points: row.points,
      pointsAdded: row.delta,
      status,
      inactive,
      eliminated: status === "eliminated",
    };
  });
}

function constructorRows(state: SeasonState, scenario: Scenario | undefined): TowerRow[] {
  const names = new Map(state.teams.map((t) => [t.id, t.name]));
  return computeConstructorStandings(state, scenario).map((row) => {
    const name = names.get(row.id) ?? row.id;
    return {
      id: row.id,
      label: name,
      name,
      teamId: row.id,
      rank: row.rank,
      baseRank: row.baseRank,
      rankChange: row.baseRank - row.rank,
      basePoints: row.basePoints,
      points: row.points,
      pointsAdded: row.delta,
      status: null,
      inactive: false,
      eliminated: false,
    };
  });
}
