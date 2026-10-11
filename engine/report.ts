/**
 * Pure report formatting helpers.
 * Used by CLI scripts (check.ts) and API endpoints. Pure logic only.
 */
import { solveWdc, type PathResult } from "./solver";
import { remainingSessions } from "./sessions";
import { driverStatus, type TitleStatus } from "./status";
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
}

export function buildCheckReport(state: SeasonState, driver?: string): CheckReport {
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
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function finish(limit: number | null): string {
  if (limit === null) return "impossible";
  if (limit === 1) return "any finish";
  if (limit === 11) return "outside the points zone";
  return `not better than P${limit}`;
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
  lines.push(`Drivers: ${drivers.active} active, ${drivers.inactive} inactive${inactive}`, "");

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
  return lines.join("\n") + "\n";
}
