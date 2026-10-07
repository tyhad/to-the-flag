/**
 * Usage: bun scripts/statusReport.ts [path-to-f1gstats.sqlite]
 * Prints the title status table from the real data (no locks). Read-only.
 * Defaults to F1GSTATS_DB from config.
 */
import { config } from "../config";
import { loadSeason } from "../data/loadSeason";
import { remainingSessions } from "../engine/sessions";
import { driverStatus } from "../engine/status";
import type { Scenario, SeasonState } from "../engine/types";

export function statusReport(state: SeasonState, scenario?: Scenario): string {
  const remaining = remainingSessions(state);
  const races = remaining.filter((k) => k.endsWith(":race")).length;
  const sprints = remaining.length - races;
  const names = new Map(state.drivers.map((d) => [d.code, d.name]));
  const rows = driverStatus(state, scenario);

  const head =
    `Season ${state.season}, as of round ${state.asOfRound}. ` +
    `Remaining: ${races} race${races === 1 ? "" : "s"} + ${sprints} sprint${sprints === 1 ? "" : "s"} ` +
    `(${remaining.length} sessions).`;
  const header = ["#", "Driver", "Name", "Status", "Points", "Max", "Gap", "ToClinch"];
  const widths = [3, 6, 24, 11, 7, 6, 5, 8];
  const fmt = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join(" ");
  const lines = rows.map((r, i) =>
    fmt([
      String(i + 1),
      r.driver,
      names.get(r.driver) ?? r.driver,
      r.status,
      String(r.points),
      String(r.maxPossible),
      String(r.gapToLeader),
      r.pointsToClinch === null ? "-" : String(r.pointsToClinch),
    ]).trimEnd(),
  );
  return [head, "", fmt(header).trimEnd(), ...lines].join("\n");
}

if (import.meta.main) {
  const dbPath = process.argv[2] ?? config.f1gstatsDb;
  try {
    console.log(statusReport(loadSeason(dbPath)));
  } catch (err) {
    console.error(`${err instanceof Error ? err.name : "Error"}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
