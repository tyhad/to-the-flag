/**
 * Pure report formatting helpers.
 * Used by CLI scripts (check.ts) and API endpoints. Pure logic only.
 */
import { solveWdc, type PathResult } from "./solver";
import { remainingSessions } from "./sessions";
import { driverStatus, type TitleStatus } from "./status";
import { solveWcc, type TeamPathResult } from "./teamSolver";
import { teamStatus } from "./teamStatus";
import type { SeasonState, SessionKey } from "./types";

export interface WdcRow {
  rank: number;
  driver: string;
  name: string;
  status: TitleStatus;
  points: number;
  maxPossible: number;
  gapToLeader: number;
  pointsToClinch: number | null;
}

export interface WccRow {
  rank: number;
  team: string;
  name: string;
  status: TitleStatus;
  points: number;
  maxPossible: number;
  gapToLeader: number;
  pointsToClinch: number | null;
}

export interface CheckReport {
  season: number;
  asOfRound: number;
  /** rounds in the calendar */
  rounds: number;
  health: SeasonState["health"];
  remaining: { sessions: SessionKey[]; races: number; sprints: number };
  drivers: { active: number; inactive: number; inactiveCodes: string[] };
  wdc: WdcRow[];
  /** one per contender (not eliminated), or just the requested driver */
  paths: PathResult[];
  /** the constructors' table with title status (Phase 5) */
  wcc: WccRow[];
  /** one per contender team (not eliminated), or just the requested team */
  teamPaths: TeamPathResult[];
  /** the real grid of the next race when the data has one (Phase 4, Step 8); null otherwise */
  upcomingGrid: { round: number; source: string; drivers: number } | null;
}

/** `driver` and `team` are independent: each limits its own path section. Both match ids case-insensitively. */
export function buildCheckReport(state: SeasonState, driver?: string, team?: string): CheckReport {
  const rows = driverStatus(state);
  const names = new Map(state.drivers.map((d) => [d.code, d.name]));
  const wdc: WdcRow[] = rows.map((r, i) => ({
    rank: i + 1,
    driver: r.driver,
    name: names.get(r.driver) ?? r.driver,
    status: r.status,
    points: r.points,
    maxPossible: r.maxPossible,
    gapToLeader: r.gapToLeader,
    pointsToClinch: r.pointsToClinch,
  }));

  let targets: string[];
  if (driver !== undefined) {
    const match = state.drivers.find((d) => d.code.toUpperCase() === driver.toUpperCase());
    if (!match) throw new RangeError(`unknown driver: ${driver}`);
    targets = [match.code];
  } else {
    targets = rows.filter((r) => r.status !== "eliminated").map((r) => r.driver);
  }

  const teamRows = teamStatus(state);
  const teamNames = new Map(state.teams.map((t) => [t.id, t.name]));
  const wcc: WccRow[] = teamRows.map((r, i) => ({
    rank: i + 1,
    team: r.team,
    name: teamNames.get(r.team) ?? r.team,
    status: r.status,
    points: r.points,
    maxPossible: r.maxPossible,
    gapToLeader: r.gapToLeader,
    pointsToClinch: r.pointsToClinch,
  }));

  let teamTargets: string[];
  if (team !== undefined) {
    const match = state.teams.find((t) => t.id.toUpperCase() === team.toUpperCase());
    if (!match) {
      throw new RangeError(`unknown team: ${team} (valid ids: ${state.teams.map((t) => t.id).join(", ")})`);
    }
    teamTargets = [match.id];
  } else {
    teamTargets = teamRows.filter((r) => r.status !== "eliminated").map((r) => r.team);
  }

  const sessions = remainingSessions(state);
  const races = sessions.filter((k) => k.endsWith(":race")).length;
  const inactiveCodes = state.drivers.filter((d) => !d.active).map((d) => d.code);
  return {
    season: state.season,
    asOfRound: state.asOfRound,
    rounds: state.rounds.length,
    health: state.health,
    remaining: { sessions, races, sprints: sessions.length - races },
    drivers: { active: state.drivers.length - inactiveCodes.length, inactive: inactiveCodes.length, inactiveCodes },
    wdc,
    paths: targets.map((d) => solveWdc(state, d)),
    wcc,
    teamPaths: teamTargets.map((t) => solveWcc(state, t)),
    upcomingGrid: state.upcomingGrid
      ? { round: state.upcomingGrid.round, source: state.upcomingGrid.source, drivers: Object.keys(state.upcomingGrid.grid).length }
      : null,
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function finish(limit: number | null): string {
  if (limit === null) return "impossible";
  if (limit === 1) return "any finish";
  if (limit === 11) return "outside the points zone";
  return `not better than P${limit}`;
}

/** Pace limit of a rival team: the best pair of places it may take in every session. */
function teamFinish(limit: number | null): string {
  if (limit === null) return "cannot be beaten this way";
  if (limit === 11) return "outside the points zone";
  return `not better than P${limit}-P${limit + 1}`;
}

export function formatCheckReport(report: CheckReport, dbPath: string): string {
  const lines: string[] = [];
  const { health, remaining, drivers } = report;

  lines.push("To the Flag: check", `Database: ${dbPath}`, "");
  lines.push(`Data health: ${health.status} (checked ${health.checkedAt})`);
  if (health.status !== "ok") lines.push(`WARNING: data health is "${health.status}"; numbers may be unreliable.`);
  lines.push(`Season ${report.season}, as of round ${report.asOfRound} of ${report.rounds}`);
  lines.push(
    `Remaining: ${plural(remaining.races, "race")} + ${plural(remaining.sprints, "sprint")} ` +
      `(${plural(remaining.sessions.length, "session")})`,
  );
  if (remaining.sessions.length > 0) lines.push(`  ${remaining.sessions.join(", ")}`);
  const inactive = drivers.inactive > 0 ? ` (${drivers.inactiveCodes.join(", ")})` : "";
  lines.push(`Drivers: ${drivers.active} active, ${drivers.inactive} inactive${inactive}`);
  const grid = report.upcomingGrid;
  lines.push(grid ? `Upcoming grid: Round ${grid.round} (source: ${grid.source}, ${plural(grid.drivers, "driver")})` : "Upcoming grid: none", "");

  const widths = [3, 6, 24, 11, 7, 6, 5, 8];
  const fmt = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join(" ").trimEnd();
  lines.push("WDC table");
  lines.push(fmt(["#", "Driver", "Name", "Status", "Points", "Max", "Gap", "ToClinch"]));
  for (const r of report.wdc) {
    lines.push(
      fmt([
        String(r.rank), r.driver, r.name, r.status, String(r.points), String(r.maxPossible),
        String(r.gapToLeader), r.pointsToClinch === null ? "-" : String(r.pointsToClinch),
      ]),
    );
  }

  lines.push("", "Paths to the title");
  const names = new Map(report.wdc.map((r) => [r.driver, r.name]));
  for (const p of report.paths) {
    lines.push(
      "",
      `${p.driver} (${names.get(p.driver) ?? p.driver}): ${p.verdict}, ${p.points} pts, max ${p.maxPossible}`,
    );
    const row = report.wdc.find((r) => r.driver === p.driver);
    if (p.verdict === "eliminated") {
      lines.push("  cannot be champion");
    } else if (p.verdict === "clinched") {
      lines.push("  title clinched");
    } else {
      if (row?.rank === 1 && row.pointsToClinch !== null) {
        lines.push(
          `  to clinch the title: ${row.pointsToClinch} more points ` +
            "(conservative: assumes rivals still score the maximum)",
        );
      } else {
        const remainingMax = p.maxPossible - p.points;
        const pct = p.difficulty === null ? "n/a" : `${Math.round(p.difficulty * 100)}%`;
        lines.push(`  needs ${p.pointsNeeded} of the ${remainingMax} still to score (difficulty ${pct})`);
      }
      if (p.minWins) {
        lines.push(
          `  at least ${plural(p.minWins.total, "win")} ` +
            `(${plural(p.minWins.races, "race")}, ${plural(p.minWins.sprints, "sprint")}), P2 in the rest`,
        );
      }
    }
    if (p.rivalBudgets.length > 0) {
      lines.push(`  if ${p.driver} wins every remaining session, rivals may score at most:`);
      for (const b of p.rivalBudgets) {
        lines.push(`    ${b.driver} ${b.budget} pts (${finish(b.paceLimit)})`);
      }
    }
    if (!p.exact) {
      lines.push("  note: fewer than 9 harmless fillers exist, so this assumes rivals finish outside the points zone");
    }
  }

  lines.push("", "WCC table");
  const teamWidths = [3, 13, 18, 11, 7, 6, 5, 8];
  const fmtTeam = (cells: string[]) => cells.map((c, i) => c.padEnd(teamWidths[i] ?? 0)).join(" ").trimEnd();
  lines.push(fmtTeam(["#", "Team", "Name", "Status", "Points", "Max", "Gap", "ToClinch"]));
  for (const r of report.wcc) {
    lines.push(
      fmtTeam([
        String(r.rank), r.team, r.name, r.status, String(r.points), String(r.maxPossible),
        String(r.gapToLeader), r.pointsToClinch === null ? "-" : String(r.pointsToClinch),
      ]),
    );
  }

  lines.push("", "Paths to the constructors' title");
  for (const p of report.teamPaths) {
    const row = report.wcc.find((r) => r.team === p.team);
    lines.push(
      "",
      `${p.team} (${row?.name ?? p.team}): ${p.verdict}, ${p.points} pts, max ${p.maxPossible}`,
    );
    if (p.verdict === "eliminated") {
      lines.push("  cannot win the constructors' title");
    } else if (p.verdict === "clinched") {
      lines.push("  constructors' title clinched");
    } else {
      if (row?.rank === 1 && row.pointsToClinch !== null) {
        lines.push(
          `  to clinch the constructors' title: ${row.pointsToClinch} more points ` +
            "(conservative: assumes rivals still score the maximum)",
        );
      } else {
        const remainingMax = p.maxPossible - p.points;
        const pct = p.difficulty === null ? "n/a" : `${Math.round(p.difficulty * 100)}%`;
        lines.push(`  needs ${p.pointsNeeded} of the ${remainingMax} still to score (difficulty ${pct})`);
      }
      if (p.minOneTwos) {
        if (p.minOneTwos.total === 0) {
          lines.push(
            "  no one-twos needed: P2 and P3 in every session is enough if every rival scores nothing",
          );
        } else {
          lines.push(
            `  at least ${plural(p.minOneTwos.total, "one-two")} ` +
              `(${plural(p.minOneTwos.races, "race")}, ${plural(p.minOneTwos.sprints, "sprint")}), ` +
              "P2 and P3 in the rest, if every rival scores nothing",
          );
        }
      }
    }
    if (p.rivalBudgets.length > 0) {
      lines.push(`  if ${p.team} finish 1-2 in every remaining session, rivals may score at most:`);
      for (const b of p.rivalBudgets) {
        lines.push(`    ${b.team} ${b.budget} pts (${teamFinish(b.paceLimit)})`);
      }
    }
    if (!p.exact) {
      lines.push("  note: fewer than 8 harmless fillers exist, so this is an estimate");
    }
  }
  return lines.join("\n") + "\n";
}
