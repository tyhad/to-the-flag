import { afterAll, describe, expect, test } from "bun:test";
import { loadSeason } from "../data/loadSeason";
import { buildCheckReport, formatCheckReport, runCheck } from "../scripts/check";
import { buildDb, cleanupDbs } from "./dbHelpers";
import { makeState } from "./helpers";

afterAll(cleanupDbs);

// Mini season: R1-R2 done, remaining 3:race, 4:sprint, 4:race. AAA 57, BBB 41, CCC 39, DDD 12 (inactive).
const dbPath = buildDb();
const state = loadSeason(dbPath);

describe("buildCheckReport", () => {
  const report = buildCheckReport(state);

  test("season facts", () => {
    expect(report.season).toBe(2026);
    expect(report.asOfRound).toBe(2);
    expect(report.rounds).toBe(4);
    expect(report.health).toEqual({ status: "ok", checkedAt: "2026-03-08T10:00:00Z" });
  });

  test("remaining sessions", () => {
    expect(report.remaining).toEqual({ sessions: ["3:race", "4:sprint", "4:race"], races: 2, sprints: 1 });
  });

  test("driver counts", () => {
    expect(report.drivers).toEqual({ active: 3, inactive: 1, inactiveCodes: ["DDD"] });
  });

  test("WDC table: rank, name, points, status", () => {
    expect(report.wdc.map((r) => [r.rank, r.driver, r.name, r.points, r.status])).toEqual([
      [1, "AAA", "Driver AAA", 57, "alive"],
      [2, "BBB", "Driver BBB", 41, "alive"],
      [3, "CCC", "Driver CCC", 39, "alive"],
      [4, "DDD", "Driver DDD", 12, "eliminated"],
    ]);
    expect(report.wdc[0]).toMatchObject({ maxPossible: 115, gapToLeader: 0 });
    expect(report.wdc[3]).toMatchObject({ maxPossible: 12, gapToLeader: 45, pointsToClinch: null });
  });

  test("paths: one PathResult per contender, in table order", () => {
    expect(report.paths.map((p) => [p.driver, p.verdict])).toEqual([
      ["AAA", "alive"], ["BBB", "alive"], ["CCC", "alive"],
    ]);
  });

  test("--driver limits the paths to that driver, case-insensitively", () => {
    const one = buildCheckReport(state, "bbb");
    expect(one.paths).toHaveLength(1);
    expect(one.paths[0]?.driver).toBe("BBB");
    expect(one.wdc).toHaveLength(4); // the table is always complete
  });

  test("--driver also works for an eliminated driver", () => {
    const one = buildCheckReport(state, "DDD");
    expect(one.paths[0]).toMatchObject({ driver: "DDD", verdict: "eliminated", minWins: null, easiest: null });
  });

  test("an unknown driver throws RangeError", () => {
    expect(() => buildCheckReport(state, "ZZZ")).toThrow(RangeError);
  });

  test("the report is plain JSON (round-trips unchanged)", () => {
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  test("the input state is not modified", () => {
    const before = JSON.stringify(state);
    buildCheckReport(state);
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("formatCheckReport", () => {
  const text = formatCheckReport(buildCheckReport(state), "some/path.sqlite");

  test("header lines", () => {
    expect(text).toContain("Database: some/path.sqlite");
    expect(text).toContain("Data health: ok");
    expect(text).toContain("as of round 2 of 4");
    expect(text).toContain("Remaining: 2 races + 1 sprint (3 sessions)");
    expect(text).toContain("3:race, 4:sprint, 4:race");
    expect(text).toContain("Drivers: 3 active, 1 inactive (DDD)");
  });

  test("WDC table with status", () => {
    const line = text.split("\n").find((l) => l.includes("Driver AAA") && l.includes("alive"));
    expect(line).toBeDefined();
    expect(line).toContain("57");
    expect(text.split("\n").some((l) => l.includes("DDD") && l.includes("eliminated"))).toBe(true);
  });

  test("path section covers each contender", () => {
    expect(text).toContain("Paths to the title");
    for (const d of ["AAA", "BBB", "CCC"]) expect(text).toContain(`${d} (Driver ${d}): alive`);
    expect(text).toContain("rivals may score at most");
    expect(text).toContain("fewer than 9");
  });

  /** The lines of one driver's path section, found by its heading, e.g. "AAA (Driver AAA):". */
  const block = (text: string, heading: string) => {
    const start = text.indexOf(heading);
    const end = text.indexOf("\n\n", start);
    return text.slice(start, end === -1 ? undefined : end);
  };

  test("the table leader sees what it takes to clinch (ToClinch), not 'needs 0'", () => {
    // AAA leads on 57. Highest rival ceiling is BBB's 99 (41 + 58), so 99 - 57 + 1 = 43.
    const aaa = block(text, "AAA (Driver AAA):");
    expect(aaa).toContain("to clinch the title: 43 more points");
    expect(aaa).toContain("conservative");
    expect(aaa).not.toContain("needs");
    expect(text.split("\n").find((l) => l.includes("Driver AAA") && l.includes("alive"))).toContain("43");
  });

  test("a driver behind the leader still sees how much is needed to overtake", () => {
    expect(block(text, "BBB (Driver BBB):")).toContain("needs 17 of the 58 still to score");
    expect(block(text, "BBB (Driver BBB):")).not.toContain("to clinch");
  });

  test("a clinched leader just says so", () => {
    const done = makeState({
      rounds: 2, completed: 2, teams: { t: ["AAA", "BBB"] },
      results: { "1:race": ["AAA", "BBB"], "2:race": ["AAA", "BBB"] },
    });
    const t = formatCheckReport(buildCheckReport(done), "x");
    expect(block(t, "AAA (AAA):")).toContain("title clinched");
    expect(block(t, "AAA (AAA):")).not.toContain("needs");
  });

  test("an eliminated driver's path says so", () => {
    const t = formatCheckReport(buildCheckReport(state, "DDD"), "x");
    expect(t).toContain("DDD (Driver DDD): eliminated");
    expect(t).toContain("cannot be champion");
  });
});

describe("runCheck", () => {
  test("text output, exit code 0", () => {
    const r = runCheck(["--db", dbPath], "unused");
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain(`Database: ${dbPath}`);
    expect(r.stdout).toContain("WDC table");
  });

  test("uses the default database when --db is absent", () => {
    const r = runCheck([], dbPath);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`Database: ${dbPath}`);
  });

  test("--json prints the report as JSON", () => {
    const r = runCheck(["--db", dbPath, "--json"], "unused");
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual(buildCheckReport(state));
  });

  test("--driver restricts the path section", () => {
    const r = runCheck(["--db", dbPath, "--driver", "ccc"], "unused");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("CCC (Driver CCC)");
    expect(r.stdout).not.toContain("AAA (Driver AAA):");
  });

  test("an unknown driver is an error", () => {
    const r = runCheck(["--db", dbPath, "--driver", "ZZZ"], "unused");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("ZZZ");
  });

  test("unknown option prints usage and exits 1", () => {
    const r = runCheck(["--nope"], dbPath);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("Usage");
  });

  test("--help prints usage and exits 0", () => {
    const r = runCheck(["--help"], dbPath);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Usage");
    expect(r.stdout).toContain("--driver");
  });

  test("a missing database file is an error", () => {
    const r = runCheck(["--db", "/nonexistent/f1gstats.sqlite"], "unused");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("not found");
  });

  test("schema_version 1 is refused", () => {
    const r = runCheck(["--db", buildDb((s) => (s.schemaVersion = 1))], "unused");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("SchemaVersionError");
  });

  test("inconsistent data is refused", () => {
    const bad = buildDb((s) => {
      s.results = s.results.filter((x) => !(x.round === 2 && x.session === "Sprint"));
    });
    const r = runCheck(["--db", bad], "unused");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("DataInconsistentError");
  });

  test("health warn: output with a warning, exit 0", () => {
    const r = runCheck(["--db", buildDb((s) => (s.health = [{ status: "warn", checkedAt: "t" }]))], "unused");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("WARNING");
  });

  test("health fail: output with a warning, exit 2", () => {
    const r = runCheck(["--db", buildDb((s) => (s.health = [{ status: "fail", checkedAt: "t" }]))], "unused");
    expect(r.code).toBe(2);
    expect(r.stdout).toContain("WARNING");
    expect(r.stdout).toContain("WDC table");
  });

  test("health ok has no warning", () => {
    expect(runCheck(["--db", dbPath], "unused").stdout).not.toContain("WARNING");
  });
});
