/** Phase 5 Step 7: the "Possible?" panel for constructors (pure view-model) and the workspace rules around it. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateScenario } from "../engine/scenario";
import { remainingSessions } from "../engine/sessions";
import { teamCars } from "../engine/teams";
import type { Scenario, SeasonState } from "../engine/types";
import {
  buildTeamPathView,
  defaultTeam,
  describeTeamOneTwos,
  describeTeamRivalBudget,
  planTeamLoad,
  teamOptions,
} from "../web/viewModel/teamPath";
import { sameScenario } from "../web/viewModel/path";
import { initialWorkspace, workspaceReducer } from "../web/viewModel/workspace";
import { makeState } from "./helpers";

const real = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "season-2026-r16.json"), "utf8")) as SeasonState;

describe("describeTeamOneTwos", () => {
  test("none needed", () => {
    expect(describeTeamOneTwos({ total: 0, races: 0, sprints: 0 })).toBe(
      "No one-twos needed: P2 and P3 in every session is enough if every rival scores nothing.",
    );
  });
  test("one, with the singular", () => {
    expect(describeTeamOneTwos({ total: 1, races: 1, sprints: 0 })).toBe(
      "Needs at least 1 one-two (1 race) if every rival scores nothing.",
    );
  });
  test("races only, and races with sprints", () => {
    expect(describeTeamOneTwos({ total: 5, races: 5, sprints: 0 })).toBe(
      "Needs at least 5 one-twos (5 races) if every rival scores nothing.",
    );
    expect(describeTeamOneTwos({ total: 3, races: 2, sprints: 1 })).toBe(
      "Needs at least 3 one-twos (2 races, 1 sprint) if every rival scores nothing.",
    );
    expect(describeTeamOneTwos({ total: 2, races: 1, sprints: 1 })).toBe(
      "Needs at least 2 one-twos (1 race, 1 sprint) if every rival scores nothing.",
    );
  });
});

describe("describeTeamRivalBudget", () => {
  const lead = "If Ferrari finish 1-2 in every remaining session, Mercedes";
  test("a real limit: never better than the pair", () => {
    expect(describeTeamRivalBudget("Ferrari", "Mercedes", 123, 5)).toBe(
      `${lead} can score at most 123 more points, and never better than P5 and P6 in every session.`,
    );
    for (const p of [3, 5, 7, 9]) {
      expect(describeTeamRivalBudget("Ferrari", "Mercedes", 40, p)).toContain(
        `never better than P${p} and P${p + 1} in every session.`,
      );
    }
  });
  test("11 means outside the points", () => {
    expect(describeTeamRivalBudget("Ferrari", "Mercedes", 11, 11)).toBe(
      `${lead} can score at most 11 more points, and only if they finish outside the points in every session.`,
    );
  });
  test("a negative budget cannot be beaten this way", () => {
    expect(describeTeamRivalBudget("Ferrari", "Mercedes", -4, null)).toBe(`${lead} cannot be beaten this way.`);
  });
  test("one point is singular", () => {
    expect(describeTeamRivalBudget("Ferrari", "Mercedes", 1, 11)).toContain("at most 1 more point,");
  });
});

describe("buildTeamPathView: the copy for each verdict", () => {
  test("alive, behind the leader", () => {
    const v = buildTeamPathView(real, undefined, "ferrari");
    expect(v.team).toBe("ferrari");
    expect(v.name).toBe("Ferrari");
    expect(v.verdict).toBe("alive");
    expect(v.isLeader).toBe(false);
    expect(v.headline).toBe("Ferrari can still win the constructors' title.");
  });

  test("the leader while still alive sees the clinch copy, never 'needs 0'", () => {
    const v = buildTeamPathView(real, undefined, "mercedes");
    expect(v.isLeader).toBe(true);
    expect(v.headline).toBe(
      "Mercedes lead. 166 more points clinch the constructors' title, if every rival scores the maximum.",
    );
    expect(v.headline).not.toContain("needs");
    expect(v.meter?.caption).toContain("to clinch");
  });

  test("eliminated", () => {
    const v = buildTeamPathView(real, undefined, "rb");
    expect(v.verdict).toBe("eliminated");
    expect(v.headline).toBe("RB F1 Team cannot win the constructors' title any more.");
    expect(v.meter).toBeNull();
    expect(v.conditions).toEqual([]);
    expect(v.rivals).toEqual([]);
    expect(v.estimateNote).toBeNull();
    expect(v.easiest).toBeNull();
  });

  test("clinched", () => {
    const [m1, m2] = teamCars(real).get("mercedes") as [string, string];
    const sweep: Scenario = {
      locks: Object.fromEntries(remainingSessions(real).map((k) => [k, { fixed: { [m1]: 1, [m2]: 2 } }])) as Scenario["locks"],
    };
    const v = buildTeamPathView(real, sweep, "mercedes");
    expect(v.verdict).toBe("clinched");
    expect(v.headline).toBe("Mercedes has clinched the constructors' title.");
    expect(v.meter).toBeNull();
    expect(v.easiest).toBeNull();
    expect(v.isLeader).toBe(false);
  });
});

describe("buildTeamPathView: numbers on the real data", () => {
  test("Ferrari: points needed = leader's points - Ferrari's points + 1, of 316 still to score", () => {
    const v = buildTeamPathView(real, undefined, "ferrari");
    expect(v.meter?.needed).toBe(556 - 405 + 1);
    expect(v.meter?.total).toBe(316);
    expect(v.meter?.label).toBe("152 of 316 points (48%)");
    expect(v.meter?.caption).toContain("to take the lead");
    expect(v.meter?.caption).toContain("Not a probability");
  });

  test("band selection with the default bands", () => {
    expect(buildTeamPathView(real, undefined, "ferrari").meter?.band).toBe("yellow"); // 48%
    expect(buildTeamPathView(real, undefined, "mclaren").meter?.band).toBe("orange"); // 76%
    expect(buildTeamPathView(real, undefined, "red_bull").meter?.band).toBe("orange"); // 82%
    expect(buildTeamPathView(real, undefined, "mercedes").meter?.band).toBe("yellow"); // 53%
  });

  test("band selection with other bands", () => {
    expect(buildTeamPathView(real, undefined, "ferrari", { green: 0.5, yellow: 0.9 }).meter?.band).toBe("green");
    expect(buildTeamPathView(real, undefined, "ferrari", { green: 0.1, yellow: 0.2 }).meter?.band).toBe("orange");
  });

  test("one-twos and rival budgets", () => {
    const f = buildTeamPathView(real, undefined, "ferrari");
    expect(f.conditions).toEqual([
      "No one-twos needed: P2 and P3 in every session is enough if every rival scores nothing.",
    ]);
    expect(f.rivals).toHaveLength(3);
    expect(f.rivals[0]).toMatch(/^If Ferrari finish 1-2 in every remaining session, Mercedes can score at most \d+ more points?, and /);
    expect(buildTeamPathView(real, undefined, "red_bull").conditions).toEqual([
      "Needs at least 2 one-twos (2 races) if every rival scores nothing.",
    ]);
  });

  test("rival names are team names", () => {
    const rb = buildTeamPathView(real, undefined, "red_bull");
    expect(rb.rivals.some((r) => r.includes("McLaren"))).toBe(true);
  });

  test("exact data has no estimate note", () => {
    expect(buildTeamPathView(real, undefined, "ferrari").estimateNote).toBeNull();
  });

  test("too few fillers: the estimate note", () => {
    const B = ["AAA", "CCC", "BBB", "DDD", "EEE", "FFF"];
    const s = makeState({
      rounds: 4, completed: 3, teams: { red: ["AAA", "BBB"], blue: ["CCC", "DDD"], green: ["EEE", "FFF"] },
      results: { "1:race": B, "2:race": B, "3:race": B },
    });
    expect(buildTeamPathView(s, undefined, "blue").estimateNote).toBe(
      "Estimate: too few other drivers are left to fill the points positions.",
    );
  });

  test("the scenario is taken into account", () => {
    const [c1, c2] = teamCars(real).get("ferrari") as [string, string];
    const oneTwo: Scenario = { locks: { "17:race": { fixed: { [c1]: 1, [c2]: 2 } } } };
    const v = buildTeamPathView(real, oneTwo, "ferrari");
    // 448 points, 273 still to score (316 - 43), 556 - 448 + 1 = 109 needed
    expect(v.meter?.label).toBe("109 of 273 points (40%)");
    expect(v.meter?.band).toBe("green");
  });

  test("no rivals are listed when nothing is left to lock", () => {
    const done = makeState({
      rounds: 2, completed: 2, teams: { red: ["AAA", "BBB"], blue: ["CCC", "DDD"] },
      results: { "1:race": ["AAA", "BBB", "CCC", "DDD"], "2:race": ["AAA", "BBB", "CCC", "DDD"] },
    });
    expect(buildTeamPathView(done, undefined, "red").rivals).toEqual([]);
  });

  test("easiest is the engine's, and it is a valid scenario", () => {
    for (const team of ["mercedes", "ferrari", "mclaren", "red_bull"]) {
      const v = buildTeamPathView(real, undefined, team);
      expect(v.easiest).not.toBeNull();
      expect(() => validateScenario(real, v.easiest as Scenario)).not.toThrow();
    }
  });
});

describe("defaultTeam and teamOptions", () => {
  test("the team in second place, if it can still win", () => {
    expect(defaultTeam(real)).toBe("ferrari");
  });

  test("otherwise the first team that can still win", () => {
    const done = makeState({
      rounds: 2, completed: 2, teams: { red: ["AAA", "BBB"], blue: ["CCC", "DDD"] },
      results: { "1:race": ["AAA", "BBB", "CCC", "DDD"], "2:race": ["AAA", "BBB", "CCC", "DDD"] },
    });
    // blue is second but out of the fight; red has clinched
    expect(defaultTeam(done)).toBe("red");
  });

  test("a season with no teams has none", () => {
    expect(defaultTeam({ ...real, teams: [], results: [] })).toBeNull();
  });

  test("the select lists teams still in the fight first, then the rest, each in table order", () => {
    const options = teamOptions(real);
    expect(options.map((o) => o.id)).toEqual([
      "mercedes", "ferrari", "mclaren", "red_bull", "rb", "alpine", "haas", "audi", "williams", "aston_martin", "cadillac",
    ]);
    expect(options.slice(0, 4).every((o) => o.inFight)).toBe(true);
    expect(options.slice(4).every((o) => !o.inFight)).toBe(true);
    expect(options[1]).toEqual({ id: "ferrari", name: "Ferrari", inFight: true });
  });
});

// Ten drivers on five teams, one race run: everybody can still win the drivers' title, so the contender list can fill up.
const crowd = () =>
  makeState({
    rounds: 20, completed: 1,
    teams: { t1: ["D01", "D02"], t2: ["D03", "D04"], t3: ["D05", "D06"], t4: ["D07", "D08"], t5: ["D09", "D10"] },
    results: { "1:race": ["D01", "D02", "D03", "D04", "D05", "D06", "D07", "D08", "D09", "D10"] },
  });

describe("planTeamLoad: the team's cars join the contender list", () => {
  test("both cars are added, and nothing is said", () => {
    const plan = planTeamLoad(real, ["ANT"], teamCars(real).get("ferrari") ?? []);
    expect(plan.contenders.sort()).toEqual(["ANT", "HAM", "LEC"]);
    expect(plan.notice).toBeNull();
  });

  test("a car that is already a contender is not added twice", () => {
    const plan = planTeamLoad(real, ["ANT", "LEC"], ["LEC", "HAM"]);
    expect(plan.contenders.filter((d) => d === "LEC")).toHaveLength(1);
    expect(plan.contenders).toHaveLength(3);
  });

  test("a car that can no longer win the drivers' title is left out without a fuss", () => {
    // PIA is out of the drivers' fight; NOR is not
    const plan = planTeamLoad(real, ["ANT"], ["NOR", "PIA"]);
    expect(plan.contenders.sort()).toEqual(["ANT", "NOR"]);
    expect(plan.notice).toBeNull();
  });

  test("a full list keeps what is there and says so in plain words", () => {
    const state = crowd();
    const eight = ["D01", "D02", "D03", "D04", "D05", "D06", "D07", "D08"];
    const plan = planTeamLoad(state, eight, ["D09", "D10"]);
    expect([...plan.contenders].sort()).toEqual(eight);
    expect(plan.notice).toBe("You can follow up to 8 contenders, so D09 and D10 were not added. Remove one to make room.");
  });

  test("with room for one car, that car is added and the other is named", () => {
    const state = crowd();
    const seven = ["D01", "D02", "D03", "D04", "D05", "D06", "D07"];
    const plan = planTeamLoad(state, seven, ["D09", "D10"]);
    expect(plan.contenders).toHaveLength(8);
    expect(plan.contenders).toContain("D09");
    expect(plan.contenders).not.toContain("D10");
    expect(plan.notice).toBe("You can follow up to 8 contenders, so D10 was not added. Remove one to make room.");
  });
});

describe("workspace: the chosen team", () => {
  test("the initial team is the default team", () => {
    expect(initialWorkspace(real).team).toBe("ferrari");
  });

  test("setTeam changes it and clears a notice; an unknown team changes nothing", () => {
    const ws = { ...initialWorkspace(real), notice: { scope: "path" as const, message: "x" } };
    const next = workspaceReducer(real, ws, { type: "setTeam", team: "mclaren" });
    expect(next.team).toBe("mclaren");
    expect(next.notice).toBeNull();
    expect(workspaceReducer(real, ws, { type: "setTeam", team: "nope" })).toBe(ws);
  });

  test("any team of the season can be chosen, also one that is out", () => {
    const next = workspaceReducer(real, initialWorkspace(real), { type: "setTeam", team: "rb" });
    expect(next.team).toBe("rb");
  });

  test("the team survives other changes to the workspace", () => {
    let ws = workspaceReducer(real, initialWorkspace(real), { type: "setTeam", team: "red_bull" });
    ws = workspaceReducer(real, ws, { type: "lock", key: "17:race" });
    ws = workspaceReducer(real, ws, { type: "setMode", mode: "all" });
    expect(ws.team).toBe("red_bull");
  });
});

describe("loading a team's easiest path", () => {
  test("the scenario is loaded as it is, and it passes validateScenario (the reducer would refuse it otherwise)", () => {
    for (const team of ["mercedes", "ferrari", "mclaren", "red_bull"]) {
      const view = buildTeamPathView(real, undefined, team);
      const easiest = view.easiest as Scenario;
      const ws = initialWorkspace(real);
      const plan = planTeamLoad(real, ws.contenders, teamCars(real).get(team) ?? []);
      const next = workspaceReducer(real, ws, {
        type: "loadScenario", scenario: easiest, contenders: plan.contenders, ...(plan.notice ? { notice: plan.notice } : {}),
      });
      expect(next.notice).toBeNull();
      expect(next.scenario).toEqual(easiest);
      expect(sameScenario(easiest, next.scenario)).toBe(true);
    }
  });

  test("the team's cars end up in the contender list so the picker shows the locks", () => {
    const view = buildTeamPathView(real, undefined, "ferrari");
    const base = { ...initialWorkspace(real), contenders: ["ANT", "RUS"], focus: "RUS" };
    const plan = planTeamLoad(real, base.contenders, teamCars(real).get("ferrari") ?? []);
    const next = workspaceReducer(real, base, {
      type: "loadScenario", scenario: view.easiest as Scenario, contenders: plan.contenders,
    });
    expect(next.contenders).toEqual(expect.arrayContaining(["ANT", "RUS", "LEC", "HAM"]));
    expect(next.focus).toBe("RUS");
  });

  test("a full list: the scenario still loads, what fits is kept, and the notice shows in the panel", () => {
    const state = crowd();
    const view = buildTeamPathView(state, undefined, "t5");
    const eight = ["D01", "D02", "D03", "D04", "D05", "D06", "D07", "D08"];
    const ws = { ...initialWorkspace(state), contenders: eight, focus: "D02" };
    const plan = planTeamLoad(state, ws.contenders, teamCars(state).get("t5") ?? []);
    const next = workspaceReducer(state, ws, {
      type: "loadScenario", scenario: view.easiest as Scenario, contenders: plan.contenders,
      ...(plan.notice ? { notice: plan.notice } : {}),
    });
    expect(next.scenario).toEqual(view.easiest as Scenario);
    expect([...next.contenders].sort()).toEqual(eight);
    expect(next.notice).toEqual({ scope: "path", message: plan.notice as string, tone: "info" });
  });

  test("an invalid scenario still refuses, with its own notice", () => {
    const ws = initialWorkspace(real);
    const next = workspaceReducer(real, ws, {
      type: "loadScenario", scenario: { locks: { "1:race": { fixed: { ANT: 1 } } } }, notice: "ignored",
    });
    expect(next.scenario).toEqual(ws.scenario);
    expect(next.notice?.scope).toBe("path");
    expect(next.notice?.message).not.toBe("ignored");
  });
});
