/**
 * Standings tower view-model (DESIGN.md section 6). Pure: no DOM, no fetch.
 * Turns the engine's tables into plain rows the components draw as they are.
 */
import {
  bestPositions,
  computeConstructorStandings,
  computeDriverStandings,
  driverPositionEntries,
  driverStatus,
  parseSessionKey,
  remainingSessions,
  sessionMaxPoints,
  teamCars,
  teamPositionEntries,
  teamSessionMaxPoints,
  teamStatus,
  type Scenario,
  type SeasonState,
  type SessionKind,
  type TitleStatus,
} from "../../engine";

export type TowerTab = "wdc" | "wcc";

/** The engine's title status, plus "longShot" for an alive driver or team who is far behind. */
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
  /** Title status for a driver who is racing or a team with an active car; null for inactive drivers and for teams with no active car. */
  status: TowerStatus | null;
  /** The driver is not in the latest round's results. */
  inactive: boolean;
  /**
   * The highest place still possible on points alone (D43), from the projected table of the scenario.
   * A floor, not a promise. 1 means the entry can still win the title (ties aside).
   */
  best: number;
  /** `best` as shown: "P2". */
  bestText: string;
}

/**
 * An alive driver or team is a "long shot" when the gap to the leader is at least this share of the points
 * still on offer in unlocked sessions (for a team: the most a team can take, P1 + P2). Two thirds: they would
 * need to take two thirds of everything left just to draw level, before the leader scores again. This is plain
 * arithmetic, not a model.
 */
export const LONG_SHOT_GAP_SHARE = 2 / 3;

export interface Delta {
  text: string;
  tone: "up" | "down" | "none";
  /** The same change in words, for screen readers. */
  description: string;
}

/** The Best column: header, what a screen reader hears, and the one hint line under the table (D43). */
export const BEST_COLUMN_LABEL = "Best";
export const BEST_ACCESSIBLE_NAME = "Highest place still possible on points alone";
export const BEST_HINT = "Best = the highest place still possible on points alone.";

/** 2 -> "P2". */
export function formatBest(best: number): string {
  return `P${best}`;
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
  /** A small icon drawn before the label. Only the no-title tag has one. */
  icon?: "cross";
  /** What a screen reader says instead of the label, when the label alone is not enough. */
  accessibleName?: string;
}

/**
 * The mark for a driver or team that can no longer win the title (D42): the tag `✕ No title`.
 * No strike-through anywhere; the meaning is in the icon plus the text, never in color alone.
 */
export const NO_TITLE_LABEL = "No title";
export const NO_TITLE_MARK = "✕";
export const NO_TITLE_ACCESSIBLE_NAME = "Cannot win the title";
/** The same mark as one line of text, for the PNG card. */
export const NO_TITLE_TEXT = `${NO_TITLE_MARK} ${NO_TITLE_LABEL}`;

const STATUS_LABELS: Record<TowerStatus, string> = {
  clinched: "Clinched",
  alive: "Alive",
  longShot: "Long shot",
  eliminated: NO_TITLE_LABEL,
};

/** The tag for a row, or null when the row has none (a team with no active car). */
export function statusTag(row: Pick<TowerRow, "status" | "inactive">): StatusTagView | null {
  if (row.inactive) return { label: "not racing", tone: "inactive" };
  if (row.status === null) return null;
  if (row.status === "eliminated") {
    return { label: NO_TITLE_LABEL, tone: "eliminated", icon: "cross", accessibleName: NO_TITLE_ACCESSIBLE_NAME };
  }
  return { label: STATUS_LABELS[row.status], tone: row.status };
}

/**
 * The text tone of a row: `normal` for every driver and team that is racing, including one that cannot win
 * the title (that is said by the tag); `muted` (text-3) only for a driver who is not racing.
 */
export function rowTextTone(row: Pick<TowerRow, "inactive">): "normal" | "muted" {
  return row.inactive ? "muted" : "normal";
}

/**
 * Most points still available: every remaining session the scenario has not locked, at its maximum.
 * `maxFor` is the most one driver (default) or one team can take in a session.
 */
function pointsOnOffer(
  state: SeasonState,
  scenario: Scenario | undefined,
  maxFor: (kind: SessionKind) => number = sessionMaxPoints,
): number {
  const locked = scenario?.locks ?? {};
  let total = 0;
  for (const key of remainingSessions(state)) {
    if (key in locked) continue;
    total += maxFor(parseSessionKey(key).kind);
  }
  return total;
}

/** The tower status of a row that is racing: the engine's status, or "longShot" for an alive row far behind. */
function towerStatus(title: TitleStatus, gapToLeader: number, remaining: number): TowerStatus {
  const longShot = title === "alive" && remaining > 0 && gapToLeader / remaining >= LONG_SHOT_GAP_SHARE - 1e-9;
  return longShot ? "longShot" : title;
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
  const statusRows = driverStatus(state, scenario);
  const statuses = new Map(statusRows.map((s) => [s.driver, s]));
  const best = bestPositions(driverPositionEntries(statusRows));
  const drivers = new Map(state.drivers.map((d) => [d.code, d]));
  const teams = currentTeams(state);
  const remaining = pointsOnOffer(state, scenario);

  return table.map((row) => {
    const driver = drivers.get(row.id);
    const inactive = driver ? !driver.active : false;
    const gap = statuses.get(row.id)?.gapToLeader ?? 0;
    let status: TowerStatus | null = null;
    if (!inactive) status = towerStatus(statuses.get(row.id)?.status ?? "eliminated", gap, remaining);
    const bestPlace = best.get(row.id) ?? row.rank;
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
      best: bestPlace,
      bestText: formatBest(bestPlace),
    };
  });
}

function constructorRows(state: SeasonState, scenario: Scenario | undefined): TowerRow[] {
  const names = new Map(state.teams.map((t) => [t.id, t.name]));
  const table = computeConstructorStandings(state, scenario);
  const statusRows = teamStatus(state, scenario);
  const statuses = new Map(statusRows.map((s) => [s.team, s]));
  const best = bestPositions(teamPositionEntries(statusRows));
  const cars = teamCars(state);
  const remaining = pointsOnOffer(state, scenario, teamSessionMaxPoints);

  return table.map((row) => {
    const name = names.get(row.id) ?? row.id;
    // A team with no active car gets no tag (the engine always counts it as eliminated).
    let status: TowerStatus | null = null;
    if ((cars.get(row.id)?.length ?? 0) > 0) {
      const found = statuses.get(row.id);
      status = towerStatus(found?.status ?? "eliminated", found?.gapToLeader ?? 0, remaining);
    }
    const bestPlace = best.get(row.id) ?? row.rank;
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
      status,
      inactive: false,
      best: bestPlace,
      bestText: formatBest(bestPlace),
    };
  });
}