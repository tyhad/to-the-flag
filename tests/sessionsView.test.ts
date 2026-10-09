/** Phase 2 Step 6: contenders, session cards and picker choices (pure). */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Scenario, SeasonState } from "../engine";
import {
  DEFAULT_CONTENDER_COUNT,
  MAX_CONTENDERS,
  contenderPool,
  defaultContenders,
  defaultFocus,
  defaultRival,
  toggleContender,
} from "../web/viewModel/contenders";
import { buildSessionCards, outChoices, pickerChoices, sessionTitle } from "../web/viewModel/sessions";
import { makeState } from "./helpers";

const REAL = join(import.meta.dir, "fixtures", "season-2026-r16.json");
const fixture = (): SeasonState => JSON.parse(readFileSync(REAL, "utf8")) as SeasonState;

describe("constants", () => {
  test("five contenders by default, up to eight", () => {
    expect(DEFAULT_CONTENDER_COUNT).toBe(5);
    expect(MAX_CONTENDERS).toBe(8);
  });
});

// Early season: 10 drivers after one race of 20, so everyone can still win the title.
const early = (): SeasonState => {
  const codes = ["D01", "D02", "D03", "D04", "D05", "D06", "D07", "D08", "D09", "D10"];
  return makeState({
    rounds: 20,
    completed: 1,
    teams: { a: codes.slice(0, 5), b: codes.slice(5) },
    results: { "1:race": codes },
  });
};

describe("contenders (synthetic)", () => {
  test("the pool is every active driver who can still win, in table order", () => {
    expect(contenderPool(early())).toHaveLength(10);
    expect(contenderPool(early())[0]).toBe("D01");
  });

  test("the default is the top five of the pool", () => {
    expect(defaultContenders(early())).toEqual(["D01", "D02", "D03", "D04", "D05"]);
  });

  test("adding a driver keeps table order and the count stops at eight", () => {
    const state = early();
    let current = defaultContenders(state);
    for (const code of ["D09", "D06", "D07"]) {
      const r = toggleContender(state, current, code);
      expect(r.error).toBeNull();
      current = r.contenders;
    }
    expect(current).toEqual(["D01", "D02", "D03", "D04", "D05", "D06", "D07", "D09"]);
    expect(current).toHaveLength(MAX_CONTENDERS);
    const ninth = toggleContender(state, current, "D08");
    expect(ninth.contenders).toBe(current);
    expect(ninth.error).toBe("You can follow up to 8 contenders.");
  });

  test("removing a contender works, but the last one stays", () => {
    const state = early();
    const r = toggleContender(state, ["D01", "D02"], "D02");
    expect(r).toEqual({ contenders: ["D01"], error: null });
    const last = toggleContender(state, ["D01"], "D01");
    expect(last.contenders).toEqual(["D01"]);
    expect(last.error).toBe("Keep at least one contender.");
  });
});

describe.skipIf(!existsSync(REAL))("contenders on the real Round 16 snapshot", () => {
  test("the pool is the six drivers still in the title fight", () => {
    expect(contenderPool(fixture())).toEqual(["ANT", "RUS", "HAM", "LEC", "NOR", "VER"]);
  });

  test("default contenders are the top five; VER can be added", () => {
    const state = fixture();
    const five = defaultContenders(state);
    expect(five).toEqual(["ANT", "RUS", "HAM", "LEC", "NOR"]);
    expect(toggleContender(state, five, "VER").contenders).toEqual(["ANT", "RUS", "HAM", "LEC", "NOR", "VER"]);
  });

  test("an eliminated or non-racing driver cannot become a contender", () => {
    const state = fixture();
    const five = defaultContenders(state);
    expect(toggleContender(state, five, "PIA").error).toBe("PIA can no longer win the title, so they cannot be a contender.");
    expect(toggleContender(state, five, "TSU").error).toBe("TSU can no longer win the title, so they cannot be a contender.");
    expect(toggleContender(state, five, "PIA").contenders).toBe(five);
  });

  test("the focus defaults to the driver in second place", () => {
    const state = fixture();
    expect(defaultFocus(state, defaultContenders(state))).toBe("RUS");
  });

  test("if second place is not a contender the focus is the first contender", () => {
    expect(defaultFocus(fixture(), ["HAM", "LEC"])).toBe("HAM");
    expect(defaultFocus(fixture(), [])).toBeNull();
  });

  test("the rival is the best-placed other driver in the projected table", () => {
    const state = fixture();
    expect(defaultRival(state, undefined, "RUS")).toBe("ANT");
    expect(defaultRival(state, undefined, "ANT")).toBe("RUS");
    // HAM wins the Singapore race: 214 + 25 = 239, ahead of RUS on 236.
    const scenario: Scenario = { locks: { "17:race": { fixed: { HAM: 1 } } } };
    expect(defaultRival(state, scenario, "ANT")).toBe("HAM");
    expect(defaultRival(state, scenario, null)).toBe("ANT");
  });
});

describe("sessionTitle", () => {
  test("round, place and session", () => {
    expect(sessionTitle(17, "Singapore Grand Prix", "sprint")).toBe("Round 17 · Singapore · Sprint");
    expect(sessionTitle(18, "United States Grand Prix", "race")).toBe("Round 18 · United States · Race");
    expect(sessionTitle(20, "São Paulo Grand Prix", "race")).toBe("Round 20 · São Paulo · Race");
  });

  test("a placeholder name like 'Round 4' is not repeated", () => {
    expect(sessionTitle(4, "Round 4", "race")).toBe("Round 4 · Race");
  });

  test("a name without 'Grand Prix' is kept whole", () => {
    expect(sessionTitle(9, "Imola", "race")).toBe("Round 9 · Imola · Race");
  });
});

describe("buildSessionCards", () => {
  const state = (): SeasonState =>
    makeState({
      rounds: 5,
      completed: 3,
      sprints: [4],
      teams: { red: ["AAA", "BBB"], blue: ["CCC", "DDD"] },
      results: {
        "1:race": ["AAA", "BBB", "CCC", "DDD"],
        "2:race": ["AAA", "BBB", "CCC", "DDD"],
        "3:race": ["AAA", "BBB", "CCC", "DDD"],
      },
    });

  test("one card per remaining session, in calendar order, all open at first", () => {
    const cards = buildSessionCards(state(), { locks: {} });
    expect(cards.map((c) => c.key)).toEqual(["4:sprint", "4:race", "5:race"]);
    expect(cards.map((c) => c.title)).toEqual(["Round 4 · Sprint", "Round 4 · Race", "Round 5 · Race"]);
    expect(cards.every((c) => !c.locked)).toBe(true);
    expect(cards.map((c) => c.slots.length)).toEqual([8, 10, 10]);
    expect(cards.every((c) => c.out.length === 0)).toBe(true);
  });

  test("a locked card lists each slot with its driver, and who is out", () => {
    const scenario: Scenario = { locks: { "4:race": { fixed: { CCC: 1, AAA: 3, DDD: "out" } } } };
    const card = buildSessionCards(state(), scenario).find((c) => c.key === "4:race")!;
    expect(card.locked).toBe(true);
    expect(card.slots.slice(0, 4)).toEqual([
      { position: 1, driver: "CCC" },
      { position: 2, driver: null },
      { position: 3, driver: "AAA" },
      { position: 4, driver: null },
    ]);
    expect(card.out).toEqual(["DDD"]);
    const others = buildSessionCards(state(), scenario).filter((c) => c.key !== "4:race");
    expect(others.every((c) => !c.locked)).toBe(true);
  });

  test("locked and nothing chosen is still locked", () => {
    const card = buildSessionCards(state(), { locks: { "5:race": { fixed: {} } } }).find((c) => c.key === "5:race")!;
    expect(card.locked).toBe(true);
    expect(card.slots.every((s) => s.driver === null)).toBe(true);
  });

  test("out drivers are listed in table order", () => {
    const scenario: Scenario = { locks: { "4:race": { fixed: { DDD: "out", BBB: "out" } } } };
    expect(buildSessionCards(state(), scenario).find((c) => c.key === "4:race")!.out).toEqual(["BBB", "DDD"]);
  });
});

describe.skipIf(!existsSync(REAL))("session cards on the real Round 16 snapshot", () => {
  test("eight sessions are left: the Singapore sprint and race, then six races", () => {
    const cards = buildSessionCards(fixture(), { locks: {} });
    expect(cards).toHaveLength(8);
    expect(cards[0]?.title).toBe("Round 17 · Singapore · Sprint");
    expect(cards[1]?.title).toBe("Round 17 · Singapore · Race");
    expect(cards[7]?.title).toBe("Round 23 · Abu Dhabi · Race");
    expect(cards.map((c) => c.slots.length)).toEqual([8, 10, 10, 10, 10, 10, 10, 10]);
  });
});

describe("picker choices", () => {
  const state = (): SeasonState =>
    makeState({
      rounds: 5,
      completed: 3,
      sprints: [4],
      teams: { red: ["AAA", "BBB"], blue: ["CCC", "DDD", "EEE"] },
      results: {
        "1:race": ["AAA", "BBB", "CCC", "DDD", "EEE"],
        "2:race": ["AAA", "BBB", "CCC", "DDD", "EEE"],
        "3:race": ["AAA", "BBB", "CCC", "DDD"],
      },
    });
  const card = (scenario: Scenario) => buildSessionCards(state(), scenario).find((c) => c.key === "4:race")!;

  test("contender mode lists the contenders, in table order", () => {
    const choices = pickerChoices(state(), ["BBB", "AAA"], card({ locks: { "4:race": { fixed: {} } } }));
    expect(choices.map((c) => c.code)).toEqual(["AAA", "BBB"]);
    expect(choices[0]).toEqual({ code: "AAA", name: "AAA" });
  });

  test("full mode lists every active driver and never the ones who are not racing", () => {
    const choices = pickerChoices(state(), null, card({ locks: { "4:race": { fixed: {} } } }));
    expect(choices.map((c) => c.code)).toEqual(["AAA", "BBB", "CCC", "DDD"]);
  });

  test("a driver who was placed and then dropped from the contenders stays listed", () => {
    const view = card({ locks: { "4:race": { fixed: { DDD: 2 } } } });
    expect(pickerChoices(state(), ["AAA"], view).map((c) => c.code)).toEqual(["AAA", "DDD"]);
  });

  test("out choices are every active driver who is not already out", () => {
    const view = card({ locks: { "4:race": { fixed: { BBB: "out", AAA: 1 } } } });
    expect(outChoices(state(), view).map((c) => c.code)).toEqual(["AAA", "CCC", "DDD"]);
  });
});
