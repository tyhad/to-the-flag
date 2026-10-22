import { describe, expect, test } from "bun:test";
import {
  buildRefreshCommand,
  resolveSeason,
  interpretExitCode,
  runRefresh,
} from "../scripts/refresh";

describe("scripts/refresh", () => {
  describe("buildRefreshCommand", () => {
    test("uses 'py' by default on Windows", () => {
      const cmd = buildRefreshCommand({
        platform: "win32",
        season: 2026,
        outputDb: "./f1gstats.sqlite",
        f1gstatsDir: "../F1GStats",
      });

      expect(cmd.cmd).toBe("py");
      expect(cmd.args).toEqual([
        "fetch_f1_data.py",
        "--season",
        "2026",
        "--output",
        "./f1gstats.sqlite",
      ]);
      expect(cmd.cwd).toBe("../F1GStats");
    });

    test("uses 'python3' by default on Linux and macOS", () => {
      const cmdLinux = buildRefreshCommand({
        platform: "linux",
        season: 2026,
        outputDb: "./f1gstats.sqlite",
      });
      expect(cmdLinux.cmd).toBe("python3");

      const cmdMac = buildRefreshCommand({
        platform: "darwin",
        season: 2026,
        outputDb: "./f1gstats.sqlite",
      });
      expect(cmdMac.cmd).toBe("python3");
    });

    test("uses custom py from options or env if set", () => {
      const cmd = buildRefreshCommand({
        platform: "win32",
        py: "/custom/bin/python",
        season: 2026,
        outputDb: "./f1gstats.sqlite",
      });
      expect(cmd.cmd).toBe("/custom/bin/python");
    });
  });

  describe("resolveSeason", () => {
    test("prefers explicit season argument", () => {
      const season = resolveSeason({
        seasonArg: "2024",
        dbPath: "f1gstats.sqlite",
        readMetaSeason: () => 2026,
        currentYear: 2025,
      });
      expect(season).toBe(2024);
    });

    test("falls back to meta.season in existing database", () => {
      const season = resolveSeason({
        seasonArg: undefined,
        dbPath: "f1gstats.sqlite",
        readMetaSeason: () => 2026,
        currentYear: 2025,
      });
      expect(season).toBe(2026);
    });

    test("falls back to current year when no argument and no database meta", () => {
      const season = resolveSeason({
        seasonArg: undefined,
        dbPath: "missing.sqlite",
        readMetaSeason: () => null,
        currentYear: 2026,
      });
      expect(season).toBe(2026);
    });
  });

  describe("interpretExitCode", () => {
    test("code 0 without warnings reports ok", () => {
      const outcome = interpretExitCode(0, "Fetch completed successfully", "");
      expect(outcome.exitCode).toBe(0);
      expect(outcome.message.toLowerCase()).toContain("ok");
      expect(outcome.message).not.toContain("warnings");
    });

    test("code 0 with [WARN] reports ok with warnings", () => {
      const outcome = interpretExitCode(
        0,
        "Fetch completed [WARN] grid missing fallback to qualifying",
        ""
      );
      expect(outcome.exitCode).toBe(0);
      expect(outcome.message.toLowerCase()).toContain("ok with warnings");
    });

    test("code 2 reports data check failure, last valid data stays, suggests retry", () => {
      const outcome = interpretExitCode(2, "", "Validation failed");
      expect(outcome.exitCode).toBe(2);
      expect(outcome.message).toMatch(/data check failed/i);
      expect(outcome.message).toMatch(/last valid data/i);
      expect(outcome.message).toMatch(/try again/i);
    });

    test("code 1 reports unexpected error", () => {
      const outcome = interpretExitCode(1, "", "Connection refused");
      expect(outcome.exitCode).toBe(1);
      expect(outcome.message).toMatch(/unexpected error/i);
    });
  });

  describe("runRefresh with injected runner", () => {
    test("missing F1GStats directory reports clear message and exits with code 1", () => {
      const logs: string[] = [];
      const code = runRefresh({
        env: { F1GSTATS_DIR: "/nonexistent/f1gstats" },
        argv: [],
        dirExists: () => false,
        spawnRunner: () => ({ exitCode: 0, stdout: "", stderr: "" }),
        log: (msg) => logs.push(msg),
      });

      expect(code).toBe(1);
      expect(logs.join(" ")).toMatch(/directory not found|make sure/i);
    });

    test("executes runner and outputs interpreted message", () => {
      const logs: string[] = [];
      let executedWith: any = null;

      const code = runRefresh({
        env: { F1GSTATS_DIR: "../F1GStats", F1GSTATS_DB: "./f1gstats.sqlite" },
        argv: ["--season", "2026"],
        dirExists: () => true,
        spawnRunner: (cmd, args, cwd) => {
          executedWith = { cmd, args, cwd };
          return { exitCode: 0, stdout: "Done", stderr: "" };
        },
        log: (msg) => logs.push(msg),
      });

      expect(code).toBe(0);
      expect(executedWith.args).toContain("2026");
      expect(logs.join(" ").toLowerCase()).toContain("ok");
    });

    test("handles code 2 from runner and exits with code 2", () => {
      const logs: string[] = [];
      const code = runRefresh({
        env: { F1GSTATS_DIR: "../F1GStats" },
        argv: [],
        dirExists: () => true,
        readMetaSeason: () => 2026,
        spawnRunner: () => ({ exitCode: 2, stdout: "", stderr: "check failed" }),
        log: (msg) => logs.push(msg),
      });

      expect(code).toBe(2);
      expect(logs.join(" ")).toMatch(/data check failed/i);
    });
  });
});
