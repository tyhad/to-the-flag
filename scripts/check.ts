/**
 * Usage: bun scripts/check.ts [--db path] [--driver CODE] [--team ID] [--json]
 * Loads the real season (read-only) and prints data health, remaining sessions, the WDC table with
 * title status, the Path Solver summary per contender, and the same for the constructors (WCC table and
 * team paths). --json prints the same data as JSON
 * (the shape Phase 2 will serve). Exit code: 0 ok, 1 error, 2 data_health is "fail".
 */
import { parseArgs } from "node:util";
import { config } from "../config";
import { loadSeason } from "../data/loadSeason";
import { buildCheckReport, formatCheckReport, type CheckReport, type WccRow, type WdcRow } from "../engine/index";

export { buildCheckReport, formatCheckReport, type CheckReport, type WccRow, type WdcRow };

const USAGE = `Usage: bun scripts/check.ts [--db path] [--driver CODE] [--team ID] [--json]

  --db path      path to f1gstats.sqlite (default: F1GSTATS_DB or ../F1GStats/f1gstats.sqlite)
  --driver CODE  show the path summary for this driver only (any driver, also eliminated)
  --team ID      show the constructors' path summary for this team only (any team id, also eliminated)
  --json         print the report as JSON
  --help         show this text

Exit code: 0 ok, 1 error, 2 when data_health is "fail".
`;

export interface CheckRun {
  code: number;
  stdout: string;
  stderr: string;
}

/** The whole CLI as a function: no process access, so tests can call it. */
export function runCheck(argv: string[], defaultDb: string): CheckRun {
  let values: { db?: string; driver?: string; team?: string; json?: boolean; help?: boolean };
  try {
    values = parseArgs({
      args: argv,
      options: {
        db: { type: "string" },
        driver: { type: "string" },
        team: { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean" },
      },
      allowPositionals: false,
      strict: true,
    }).values;
  } catch (err) {
    return { code: 1, stdout: "", stderr: `${err instanceof Error ? err.message : String(err)}\n\n${USAGE}` };
  }
  if (values.help) return { code: 0, stdout: USAGE, stderr: "" };

  const dbPath = values.db ?? defaultDb;
  try {
    const report = buildCheckReport(loadSeason(dbPath), values.driver, values.team);
    const stdout = values.json ? `${JSON.stringify(report, null, 2)}\n` : formatCheckReport(report, dbPath);
    return { code: report.health.status === "fail" ? 2 : 0, stdout, stderr: "" };
  } catch (err) {
    const name = err instanceof Error ? err.name : "Error";
    const message = err instanceof Error ? err.message : String(err);
    return { code: 1, stdout: "", stderr: `${name}: ${message}\n` };
  }
}

if (import.meta.main) {
  const result = runCheck(process.argv.slice(2), config.f1gstatsDb);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.code);
}
