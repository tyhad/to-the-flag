/**
 * scripts/refresh.ts - CLI command to refresh F1 data using F1GStats.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Database } from "bun:sqlite";
import { config } from "../config";

export interface RefreshCommandOptions {
  py?: string;
  f1gstatsDir?: string;
  season: number;
  outputDb: string;
  platform?: NodeJS.Platform;
}

export interface SpawnCommand {
  cmd: string;
  args: string[];
  cwd: string;
}

export function buildRefreshCommand(options: RefreshCommandOptions): SpawnCommand {
  const platform = options.platform ?? process.platform;
  const defaultPy = platform === "win32" ? "py" : "python3";
  const cmd = options.py || defaultPy;
  const f1gstatsDir = options.f1gstatsDir || "../F1GStats";

  return {
    cmd,
    args: ["fetch_f1_data.py", "--season", String(options.season), "--output", options.outputDb],
    cwd: f1gstatsDir,
  };
}

export function resolveSeason(options: {
  seasonArg?: number | string | null;
  dbPath?: string;
  readMetaSeason?: (path: string) => number | null;
  currentYear?: number;
}): number {
  if (options.seasonArg !== undefined && options.seasonArg !== null && String(options.seasonArg).trim() !== "") {
    const parsed = Number(options.seasonArg);
    if (!Number.isNaN(parsed) && parsed > 1950) {
      return parsed;
    }
  }

  if (options.dbPath && options.readMetaSeason) {
    const metaSeason = options.readMetaSeason(options.dbPath);
    if (metaSeason && metaSeason > 1950) {
      return metaSeason;
    }
  }

  return options.currentYear ?? new Date().getFullYear();
}

export interface RefreshOutcome {
  exitCode: number;
  message: string;
}

export function interpretExitCode(code: number, stdout?: string, stderr?: string): RefreshOutcome {
  if (code === 0) {
    const combined = `${stdout ?? ""} ${stderr ?? ""}`;
    const hasWarnings = combined.includes("[WARN]") || /warning/i.test(combined);
    return {
      exitCode: 0,
      message: hasWarnings
        ? "Refresh ok with warnings. Standings updated."
        : "Refresh ok. Standings updated.",
    };
  }

  if (code === 2) {
    return {
      exitCode: 2,
      message:
        "Data check failed. The last valid data stays. Try again in a few minutes, because the API often lags after a race.",
    };
  }

  return {
    exitCode: 1,
    message: "An unexpected error occurred during refresh. Check terminal output for details.",
  };
}

function defaultReadMetaSeason(dbPath: string): number | null {
  try {
    if (!existsSync(dbPath)) return null;
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db.query("SELECT season FROM meta LIMIT 1").get() as { season?: number } | null;
      return typeof row?.season === "number" ? row.season : null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

function defaultSpawnRunner(
  cmd: string,
  args: string[],
  cwd: string,
): { exitCode: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync([cmd, ...args], {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  return {
    exitCode: proc.exitCode,
    stdout: "",
    stderr: "",
  };
}

export function parseSeasonArg(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (!item) continue;
    if (item === "--season" && i + 1 < argv.length) {
      return argv[i + 1];
    }
    if (item.startsWith("--season=")) {
      return item.split("=")[1];
    }
  }
  return undefined;
}

export interface RunRefreshOptions {
  env?: Record<string, string | undefined>;
  argv?: string[];
  dirExists?: (path: string) => boolean;
  spawnRunner?: (
    cmd: string,
    args: string[],
    cwd: string,
  ) => { exitCode: number; stdout?: string; stderr?: string };
  readMetaSeason?: (path: string) => number | null;
  log?: (message: string) => void;
}

export function runRefresh(options: RunRefreshOptions = {}): number {
  const env = options.env ?? process.env;
  const argv = options.argv ?? process.argv.slice(2);
  const dirExists = options.dirExists ?? existsSync;
  const spawnRunner = options.spawnRunner ?? defaultSpawnRunner;
  const readMeta = options.readMetaSeason ?? defaultReadMetaSeason;
  const log = options.log ?? console.log;

  const f1gstatsDir = env.F1GSTATS_DIR || "../F1GStats";
  const outputDb = env.F1GSTATS_DB || config.f1gstatsDb;
  const py = env.F1GSTATS_PY;

  if (!dirExists(f1gstatsDir)) {
    log(
      `F1GStats directory not found at "${f1gstatsDir}". Set F1GSTATS_DIR in .env or ensure the sibling folder exists.`,
    );
    return 1;
  }

  const seasonArg = parseSeasonArg(argv);
  const season = resolveSeason({
    seasonArg,
    dbPath: outputDb,
    readMetaSeason: readMeta,
  });

  const cmd = buildRefreshCommand({
    py,
    f1gstatsDir,
    season,
    outputDb,
  });

  log(`Refreshing season ${season} via ${f1gstatsDir}...`);
  const result = spawnRunner(cmd.cmd, cmd.args, cmd.cwd);
  const outcome = interpretExitCode(result.exitCode, result.stdout, result.stderr);

  log(outcome.message);
  return outcome.exitCode;
}

if (import.meta.main) {
  const exitCode = runRefresh();
  process.exit(exitCode);
}
