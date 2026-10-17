import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSeason } from "../data/loadSeason";
import { buildCheckReport, formatCheckReport, runCheck } from "../scripts/check";
import type { SeasonState } from "../engine/types";
import { buildDb, cleanupDbs } from "./dbHelpers";
import { makeState } from "./helpers";

afterAll(cleanupDbs);

// Mini season: R1-R2 done, remaining 3:race, 4:sprint, 4:race.
// alpha (AAA, BBB) 98 points, beta 51 points with ONE active car (CCC; DDD is inactive). Both are alive.
const dbPath = buildDb();
const state = loadSeason(dbPath);

/** The lines of one section, found by its heading, e.g. "alpha (Alpha):". */
const block = (text: string, heading: string) => {
  const start = text.indexOf(heading);
  const end = text.indexOf("\n\n", start);
  return text.slice(start, end === -1 ? undefined : end);
};

describe("buildCheckReport: constructors", () => {
  const report = buildCheckReport(state);

  test("WCC table: rank, team, name, points, status", () => {
    expect(report.wcc.map((r) => [r.rank, r.team, r.name, r.points, r.status])).toEqual([
      [1, "alpha", "Alpha", 98, "alive"],
      [2, "beta", "Beta", 51, "alive"],
    ]);
  });

  test("WCC table: max, gap and points to clinch", () => {
    // alpha max 98 + 43 + 15 + 43 = 199; beta has one car, so 51 + 25 + 8 + 25 = 109
    expect(report.wcc[0]).toMatchObject({ maxPossible: 199, gapToLeader: 0, pointsToClinch: 12 });
    expect(report.wcc[1]).toMatchObject({ maxPossible: 109, gapToLeader: 47, pointsToClinch: 149 });
  });

  test("teamPaths: one TeamPathResult per contender, in table order", () => {
    expect(report.teamPaths.map((p) => [p.team, p.verdict])).toEqual([
      ["alpha", "alive"],
      ["beta", "alive"],
    ]);
  });

  test("the path numbers", () => {
    const beta = report.teamPaths[1];
    expect(beta).toMatchObject({ pointsNeeded: 48, minOneTwos: { total: 1, races: 1, sprints: 0 } });
    expect(beta?.rivalBudgets).toEqual([{ team: "alpha", budget: 10, paceLimit: 9 }]);
    expect(report.teamPaths[0]?.minOneTwos).toEqual({ total: 0, races: 0, sprints: 0 });
  });

  test("--team limits the team paths to that team, case-insensitively", () => {
    const one = buildCheckReport(state, undefined, "BETA");
    expect(one.teamPaths).toHaveLength(1);
    expect(one.teamPaths[0]?.team).toBe("beta");
    expect(one.wcc).toHaveLength(2); // the table is always complete
  });

  test("--team also works for an eliminated team", () => {
    const three = makeState({
      rounds: 4, completed: 3,
      teams: { red: ["AAA", "BBB"], blue: ["CCC", "DDD"], green: ["EEE", "FFF"] },
      results: Object.fromEntries(
        [1, 2, 3].map((r) => [`${r}:race`, ["AAA", "CCC", "BBB", "DDD", "EEE", "FFF"]]),
      ),
    });
    const one = buildCheckReport(three, undefined, "Green");
    expect(one.teamPaths[0]).toMatchObject({ team: "green", verdict: "eliminated", minOneTwos: null, easiest: null });
  });

  test("an unknown team throws RangeError and lists the valid ids", () => {
    expect(() => buildCheckReport(state, undefined, "zzz")).toThrow(RangeError);
    expect(() => buildCheckReport(state, undefined, "zzz")).toThrow(/alpha, beta/);
  });

  test("--driver and --team are independent", () => {
    const r = buildCheckReport(state, "bbb");
    expect(r.paths).toHaveLength(1);
    expect(r.teamPaths).toHaveLength(2);
    const t = buildCheckReport(state, undefined, "beta");
    expect(t.paths.length).toBe(buildCheckReport(state).paths.length);
  });

  test("the driver part of the report does not change", () => {
    const { wcc, teamPaths, ...rest } = buildCheckReport(state);
    expect(wcc.length).toBeGreaterThan(0);
    expect(teamPaths.length).toBeGreaterThan(0);
    expect(Object.keys(rest).sort()).toEqual(
      ["asOfRound", "drivers", "health", "paths", "remaining", "rounds", "season", "upcomingGrid", "wdc"],
    );
  });

  test("the report is plain JSON (round-trips unchanged)", () => {
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  test("the input state is not modified", () => {
    const before = JSON.stringify(state);
    buildCheckReport(state, undefined, "beta");
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("formatCheckReport: constructors", () => {
  const text = formatCheckReport(buildCheckReport(state), "some/path.sqlite");

  test("the WDC output is still there, before the constructors", () => {
    expect(text).toContain("WDC table");
    expect(text).toContain("Paths to the title");
    expect(text.indexOf("Paths to the title")).toBeLessThan(text.indexOf("WCC table"));
  });

  test("WCC table with status", () => {
    expect(text).toContain("WCC table");
    const line = text.split("\n").find((l) => l.includes("Alpha") && l.includes("alive") && l.includes("98"));
    expect(line).toBeDefined();
    expect(line).toContain("199");
    expect(text.split("\n").some((l) => l.includes("beta") && l.includes("Beta") && l.includes("51"))).toBe(true);
  });

  test("path section covers each contender", () => {
    expect(text).toContain("Paths to the constructors' title");
    expect(text).toContain("alpha (Alpha): alive, 98 pts, max 199");
    expect(text).toContain("beta (Beta): alive, 51 pts, max 109");
    expect(text).toContain("rivals may score at most");
  });

  test("the table leader sees what it takes to clinch, not 'needs 0'", () => {
    // beta's ceiling is 109, so 109 - 98 + 1 = 12
    const alpha = block(text, "alpha (Alpha):");
    expect(alpha).toContain("to clinch the constructors' title: 12 more points");
    expect(alpha).toContain("conservative");
    expect(alpha).not.toContain("needs");
    expect(alpha).toContain("no one-twos needed");
  });

  test("a team behind the leader sees how much is needed and how many one-twos", () => {
    const beta = block(text, "beta (Beta):");
    expect(beta).toContain("needs 48 of the 58 still to score");
    expect(beta).toContain("at least 1 one-two (1 race, 0 sprints)");
    expect(beta).toContain("alpha 10 pts (not better than P9-P10)");
    expect(beta).not.toContain("to clinch");
  });

  test("the estimate note appears when there are too few fillers", () => {
    expect(block(text, "beta (Beta):")).toContain("fewer than 8");
  });

  test("a clinched team just says so", () => {
    const done = makeState({
      rounds: 2, completed: 2, teams: { red: ["AAA", "BBB"], blue: ["CCC", "DDD"] },
      results: Object.fromEntries([1, 2].map((r) => [`${r}:race`, ["AAA", "BBB", "CCC", "DDD"]])),
    });
    const t = formatCheckReport(buildCheckReport(done), "x");
    expect(block(t, "red (red):")).toContain("constructors' title clinched");
    expect(block(t, "red (red):")).not.toContain("needs");
  });

  test("an eliminated team's path says so", () => {
    const three = makeState({
      rounds: 4, completed: 3,
      teams: { red: ["AAA", "BBB"], blue: ["CCC", "DDD"], green: ["EEE", "FFF"] },
      results: Object.fromEntries(
        [1, 2, 3].map((r) => [`${r}:race`, ["AAA", "CCC", "BBB", "DDD", "EEE", "FFF"]]),
      ),
    });
    const t = formatCheckReport(buildCheckReport(three, undefined, "green"), "x");
    expect(t).toContain("green (green): eliminated");
    expect(t).toContain("cannot win the constructors' title");
    expect(block(t, "green (green):")).not.toContain("rivals may score");
  });
});

describe("runCheck: --team", () => {
  test("text output includes the WCC table", () => {
    const r = runCheck(["--db", dbPath], "unused");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("WCC table");
  });

  test("--team restricts the team path section, case-insensitively", () => {
    const r = runCheck(["--db", dbPath, "--team", "BETA"], "unused");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("beta (Beta)");
    expect(r.stdout).not.toContain("alpha (Alpha):");
  });

  test("an unknown team is an error that lists the valid ids", () => {
    const r = runCheck(["--db", dbPath, "--team", "ZZZ"], "unused");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("ZZZ");
    expect(r.stderr).toContain("alpha, beta");
    expect(r.stdout).toBe("");
  });

  test("--json includes the new parts", () => {
    const r = runCheck(["--db", dbPath, "--team", "beta", "--json"], "unused");
    expect(r.code).toBe(0);
    const json = JSON.parse(r.stdout);
    expect(json).toEqual(buildCheckReport(state, undefined, "beta"));
    expect(json.wcc).toHaveLength(2);
    expect(json.teamPaths).toHaveLength(1);
  });

  test("--help mentions --team", () => {
    expect(runCheck(["--help"], dbPath).stdout).toContain("--team");
  });
});

describe("check on the Round 16 fixture", () => {
  const real = JSON.parse(
    readFileSync(join(import.meta.dir, "fixtures", "season-2026-r16.json"), "utf8"),
  ) as SeasonState;
  const report = buildCheckReport(real);

  test("the WCC table matches the constructor standings", () => {
    expect(report.wcc).toHaveLength(11);
    expect(report.wcc.slice(0, 4).map((r) => [r.team, r.points])).toEqual([
      ["mercedes", 556], ["ferrari", 405], ["mclaren", 316], ["red_bull", 298],
    ]);
    expect(report.wcc.filter((r) => r.status === "alive")).toHaveLength(4);
    expect(report.wcc.filter((r) => r.status === "eliminated")).toHaveLength(7);
  });

  test("one path per contender, with the hand-checked numbers", () => {
    expect(report.teamPaths.map((p) => p.team)).toEqual(["mercedes", "ferrari", "mclaren", "red_bull"]);
    expect(report.teamPaths[1]).toMatchObject({ pointsNeeded: 152, minOneTwos: { total: 0, races: 0, sprints: 0 } });
    expect(report.teamPaths[3]).toMatchObject({ pointsNeeded: 259, minOneTwos: { total: 2, races: 2, sprints: 0 } });
  });

  test("the text for the leader uses the clinch copy", () => {
    const text = formatCheckReport(report, "x");
    expect(block(text, "mercedes (Mercedes):")).toContain("to clinch the constructors' title: 166 more points");
    expect(block(text, "mercedes (Mercedes):")).not.toContain("fewer than 8");
  });
});
