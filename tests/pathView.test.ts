/** Phase 2 Step 7: the "Possible?" panel view-model (pure). */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { paceLimit, solveWdc, validateScenario, type Scenario, type SeasonState } from "../engine";
import { DIFFICULTY_BANDS } from "../web/config";
import {
  buildMeter,
  buildPathView,
  describeMinWins,
  describeRivalBudget,
  difficultyBand,
  sameScenario,
} from "../web/viewModel/path";
import { makeState } from "./helpers";

// AAA 75, BBB 54, CCC 45, DDD 36 after 3 races. Two races (50 points) left. Too few fillers: exact = false.
const four = (): SeasonState =>
  makeState({
    rounds: 5,
    completed: 3,
    teams: { red: ["AAA", "BBB"], blue: ["CCC", "DDD"] },
    results: {
      "1:race": ["AAA", "BBB", "CCC", "DDD"],
      "2:race": ["AAA", "BBB", "CCC", "DDD"],
      "3:race": ["AAA", "BBB", "CCC", "DDD"],
    },
  });

// AAA 100 after four wins, BBB 72, one race left: AAA has clinched, BBB is eliminated.
const decided = (): SeasonState =>
  makeState({
    rounds: 5,
    completed: 4,
    teams: { t: ["AAA", "BBB"] },
    results: {
      "1:race": ["AAA", "BBB"],
      "2:race": ["AAA", "BBB"],
      "3:race": ["AAA", "BBB"],
      "4:race": ["AAA", "BBB"],
    },
  });

describe("config", () => {
  test("difficulty bands default to 0.40 green and 0.75 yellow", () => {
    expect(DIFFICULTY_BANDS).toEqual({ green: 0.4, yellow: 0.75 });
  });
});

describe("difficultyBand", () => {
  test("up to 0.40 is green, up to 0.75 is yellow, above is orange", () => {
    expect(difficultyBand(0)).toBe("green");
    expect(difficultyBand(0.4)).toBe("green");
    expect(difficultyBand(0.4001)).toBe("yellow");
    expect(difficultyBand(0.75)).toBe("yellow");
    expect(difficultyBand(0.7501)).toBe("orange");
    expect(difficultyBand(1)).toBe("orange");
  });

  test("the bands can be changed", () => {
    expect(difficultyBand(0.5, { green: 0.6, yellow: 0.9 })).toBe("green");
    expect(difficultyBand(0.95, { green: 0.6, yellow: 0.9 })).toBe("orange");
  });
});

describe("buildMeter", () => {
  test("a share of the points still on offer, with the numbers in words", () => {
    const meter = buildMeter(85, 183, false);
    expect(meter).toMatchObject({ needed: 85, total: 183, percent: 46, band: "yellow", label: "85 of 183 points (46%)" });
    expect(meter.share).toBeCloseTo(85 / 183, 10);
  });

  test("the caption says it is a share, not a probability", () => {
    expect(buildMeter(85, 183, false).caption).toBe(
      "Share of the remaining points needed to take the lead. Not a probability.",
    );
    expect(buildMeter(100, 183, true).caption).toBe(
      "Share of the remaining points needed to clinch. Not a probability.",
    );
  });

  test("never more than everything that is left", () => {
    // A tie that only countback settles can need one point more than exists.
    const meter = buildMeter(184, 183, false);
    expect(meter.needed).toBe(183);
    expect(meter.percent).toBe(100);
    expect(meter.band).toBe("orange");
  });
});

describe("describeMinWins", () => {
  test("no wins needed", () => {
    expect(describeMinWins({ total: 0, races: 0, sprints: 0 })).toBe(
      "No wins needed: P2 in every session is enough if every rival scores nothing.",
    );
  });

  test("wins needed, counted in races and sprints", () => {
    expect(describeMinWins({ total: 1, races: 1, sprints: 0 })).toBe(
      "Needs at least 1 win (1 race) if every rival scores nothing.",
    );
    expect(describeMinWins({ total: 3, races: 2, sprints: 1 })).toBe(
      "Needs at least 3 wins (2 races, 1 sprint) if every rival scores nothing.",
    );
    expect(describeMinWins({ total: 2, races: 0, sprints: 2 })).toBe(
      "Needs at least 2 wins (2 sprints) if every rival scores nothing.",
    );
  });
});

describe("describeRivalBudget", () => {
  test("a budget with a pace limit", () => {
    expect(describeRivalBudget("George Russell", "Max Verstappen", 98, 4)).toBe(
      "If George Russell wins every remaining session, Max Verstappen can score at most 98 more points, and only if they finish P4 or worse in every session.",
    );
  });

  test("a budget so small the rival must stay outside the points", () => {
    expect(describeRivalBudget("A", "B", 0, 11)).toBe(
      "If A wins every remaining session, B can score at most 0 more points, and only if they finish outside the points in every session.",
    );
    expect(describeRivalBudget("A", "B", 1, 11)).toContain("at most 1 more point,");
  });

  test("a budget the rival cannot even reach: they cannot catch up however they finish", () => {
    expect(describeRivalBudget("A", "B", 204, 1)).toBe(
      "If A wins every remaining session, B cannot catch A however they finish.",
    );
  });

  test("a negative budget means the rival cannot be beaten this way", () => {
    expect(describeRivalBudget("A", "B", -3, null)).toBe(
      "If A wins every remaining session, B cannot be beaten this way.",
    );
  });
});

describe("buildPathView: synthetic season", () => {
  test("a chaser who needs a win: copy, meter, conditions, rivals and the easiest path", () => {
    const state = four();
    const view = buildPathView(state, undefined, "DDD");
    expect(view.verdict).toBe("alive");
    expect(view.isLeader).toBe(false);
    expect(view.headline).toBe("DDD can still win the title.");
    // 75 - 36 + 1 = 40 of the 50 points still to come: 80%.
    expect(view.meter).toMatchObject({ needed: 40, total: 50, percent: 80, band: "orange", label: "40 of 50 points (80%)" });
    expect(view.conditions).toEqual(["Needs at least 1 win (1 race) if every rival scores nothing."]);
    expect(view.rivals).toHaveLength(3);
    expect(view.rivals[0]).toMatch(/^If DDD wins every remaining session, AAA can score at most /);
    // DDD would have 86 at best: AAA may add 86 - 75 - 1 = 10 more points.
    expect(view.rivals[0]).toContain("at most 10 more points");
    expect(view.estimateNote).toBe("Estimate: too few other drivers are left to fill the points positions.");
    expect(view.easiest?.locks["4:race"]?.fixed).toEqual({ DDD: 1 });
    expect(view.easiest?.locks["5:race"]?.fixed).toEqual({ DDD: 2 });
  });

  test("the leader gets the clinch copy, never 'needs 0'", () => {
    const view = buildPathView(four(), undefined, "AAA");
    expect(view.isLeader).toBe(true);
    // Highest rival maximum is BBB: 54 + 50 = 104. 104 - 75 + 1 = 30.
    expect(view.headline).toBe("AAA leads. 30 more points clinch the title, if every rival scores the maximum.");
    expect(view.meter).toMatchObject({ needed: 30, total: 50, percent: 60, band: "yellow", label: "30 of 50 points (60%)" });
    expect(view.meter?.caption).toContain("to clinch");
    expect(view.conditions).toEqual(["No wins needed: P2 in every session is enough if every rival scores nothing."]);
    const text = [view.headline, ...(view.meter ? [view.meter.label] : []), ...view.conditions].join(" ");
    expect(text).not.toMatch(/needs? 0\b|\b0 more/i);
  });

  test("a clinched driver: one sentence, nothing more", () => {
    const view = buildPathView(decided(), undefined, "AAA");
    expect(view.verdict).toBe("clinched");
    expect(view.headline).toBe("AAA has clinched the title.");
    expect(view.meter).toBeNull();
    expect(view.conditions).toEqual([]);
    expect(view.rivals).toEqual([]);
    expect(view.estimateNote).toBeNull();
    expect(view.easiest).toBeNull();
  });

  test("an eliminated driver: one sentence, nothing more", () => {
    const view = buildPathView(decided(), undefined, "BBB");
    expect(view.verdict).toBe("eliminated");
    expect(view.headline).toBe("BBB cannot win the title any more.");
    expect(view.meter).toBeNull();
    expect(view.conditions).toEqual([]);
    expect(view.rivals).toEqual([]);
    expect(view.easiest).toBeNull();
  });

  test("the numbers follow locked sessions: a locked win for the leader makes the chase harder", () => {
    const state = four();
    const scenario: Scenario = { locks: { "4:race": { fixed: { AAA: 1 } } } };
    // AAA 100. DDD 36 can reach 36 + 25 = 61 < 100: eliminated.
    expect(buildPathView(state, scenario, "DDD").verdict).toBe("eliminated");
    // BBB 54 + 25 = 79 < 100 too; CCC the same.
    expect(buildPathView(state, scenario, "AAA").verdict).toBe("clinched");
  });

  test("the easiest path loads as a valid scenario and keeps the owner's locks", () => {
    const state = four();
    const mine: Scenario = { locks: { "4:race": { fixed: { CCC: 1 } } } };
    const view = buildPathView(state, mine, "BBB");
    expect(view.easiest).not.toBeNull();
    expect(() => validateScenario(state, view.easiest!)).not.toThrow();
    expect(view.easiest?.locks["4:race"]?.fixed).toEqual({ CCC: 1 });
  });

  test("rival lines match the solver's budgets", () => {
    const state = four();
    const result = solveWdc(state, "BBB");
    const view = buildPathView(state, undefined, "BBB");
    expect(view.rivals).toHaveLength(result.rivalBudgets.length);
    for (const [i, b] of result.rivalBudgets.entries()) {
      if (b.paceLimit === 1) expect(view.rivals[i]).toContain(`${b.driver} cannot catch BBB however they finish.`);
      else expect(view.rivals[i]).toContain(`${b.driver} can score at most ${b.budget} more`);
    }
  });

  test("an unknown driver is an error, not a blank panel", () => {
    expect(() => buildPathView(four(), undefined, "ZZZ")).toThrow();
  });
});

describe("sameScenario", () => {
  test("equal when the same locks are set, whatever the key order", () => {
    const a: Scenario = { locks: { "4:race": { fixed: { AAA: 1, BBB: 2 } }, "5:race": { fixed: {} } } };
    const b: Scenario = { locks: { "5:race": { fixed: {} }, "4:race": { fixed: { BBB: 2, AAA: 1 } } } };
    expect(sameScenario(a, b)).toBe(true);
  });

  test("different when a position, a driver or a lock differs", () => {
    const a: Scenario = { locks: { "4:race": { fixed: { AAA: 1 } } } };
    expect(sameScenario(a, { locks: { "4:race": { fixed: { AAA: 2 } } } })).toBe(false);
    expect(sameScenario(a, { locks: { "4:race": { fixed: { BBB: 1 } } } })).toBe(false);
    expect(sameScenario(a, { locks: {} })).toBe(false);
  });
});

const REAL = join(import.meta.dir, "fixtures", "season-2026-r16.json");

describe.skipIf(!existsSync(REAL))("buildPathView on the real Round 16 snapshot", () => {
  const state = JSON.parse(readFileSync(REAL, "utf8")) as SeasonState;
  const nameOf = (code: string) => state.drivers.find((d) => d.code === code)!.name;

  test("second place: RUS needs 85 of 183 points (46%), by hand: 320 - 236 + 1", () => {
    const view = buildPathView(state, undefined, "RUS");
    expect(view.headline).toBe(`${nameOf("RUS")} can still win the title.`);
    expect(view.meter).toMatchObject({ needed: 85, total: 183, percent: 46, band: "yellow", label: "85 of 183 points (46%)" });
    expect(view.isLeader).toBe(false);
  });

  test("RUS needs no wins: P2 in every session is enough when rivals score nothing", () => {
    // 236 + 7 races x 18 + sprint P2 (7) = 369 > 320.
    expect(buildPathView(state, undefined, "RUS").conditions).toEqual([
      "No wins needed: P2 in every session is enough if every rival scores nothing.",
    ]);
  });

  test("RUS: one budget line per other contender, in table order, matching the solver", () => {
    const view = buildPathView(state, undefined, "RUS");
    const result = solveWdc(state, "RUS");
    expect(result.rivalBudgets.map((b) => b.driver)).toEqual(["ANT", "HAM", "LEC", "NOR", "VER"]);
    expect(view.rivals).toHaveLength(5);
    // ANT: 236 + 183 = 419 at best, so ANT may add 419 - 320 - 1 = 98 more points.
    const limit = paceLimit(98, 7, 1);
    expect(view.rivals[0]).toBe(
      `If ${nameOf("RUS")} wins every remaining session, ${nameOf("ANT")} can score at most 98 more points, and only if they finish P${limit} or worse in every session.`,
    );
    // The others cannot catch RUS whatever they do, and the copy must not pretend they are limited.
    expect(view.rivals[1]).toBe(`If ${nameOf("RUS")} wins every remaining session, ${nameOf("HAM")} cannot catch ${nameOf("RUS")} however they finish.`);
    expect(view.rivals.some((line) => /P1 or worse/.test(line))).toBe(false);
  });

  test("the leader: 100 more points clinch, by hand: 419 - 320 + 1", () => {
    const view = buildPathView(state, undefined, "ANT");
    expect(view.isLeader).toBe(true);
    expect(view.headline).toBe(
      `${nameOf("ANT")} leads. 100 more points clinch the title, if every rival scores the maximum.`,
    );
    expect(view.meter).toMatchObject({ needed: 100, total: 183, percent: 55 });
  });

  test("an eliminated driver: PIA", () => {
    const view = buildPathView(state, undefined, "PIA");
    expect(view.headline).toBe(`${nameOf("PIA")} cannot win the title any more.`);
    expect(view.meter).toBeNull();
    expect(view.rivals).toEqual([]);
  });

  test("the snapshot has enough fillers, so there is no estimate note", () => {
    expect(buildPathView(state, undefined, "RUS").estimateNote).toBeNull();
  });

  test("a locked sprint win for the leader moves the numbers: 328 - 236 + 1 = 93 of 175", () => {
    const scenario: Scenario = { locks: { "17:sprint": { fixed: { ANT: 1 } } } };
    const view = buildPathView(state, scenario, "RUS");
    expect(view.meter).toMatchObject({ needed: 93, total: 175, percent: 53, label: "93 of 175 points (53%)" });
  });

  test("every driver in the table can be analysed", () => {
    for (const d of state.drivers.filter((x) => x.active)) {
      expect(() => buildPathView(state, undefined, d.code)).not.toThrow();
    }
  });
});
