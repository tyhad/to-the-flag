/**
 * Phase 8, Step 1: starting grid rules (engine/grid.ts).
 * Hand-made six-driver field; DDD..FFF are on the grid, GGG is in the standings but not racing.
 */
import { describe, expect, test } from "bun:test";
import { loadSeason } from "../data/loadSeason";
import {
  InvalidGridError,
  backOfGrid,
  dropPlaces,
  gridFromOrder,
  gridProblems,
  moveTo,
  parseGridText,
  validateGrid,
} from "../engine/grid";
import { forecastRace } from "../engine/simulate";
import type { SeasonState } from "../engine/types";
import { buildDb } from "./dbHelpers";
import { makeState } from "./helpers";

const six = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"];

// Round 1: seven drivers. Round 2 (the latest completed): six. GGG is in the standings but not racing.
const state: SeasonState = makeState({
  rounds: 4,
  completed: 2,
  teams: { red: ["AAA", "BBB"], blue: ["CCC", "DDD"], green: ["EEE", "FFF", "GGG"] },
  results: {
    "1:race": [...six, "GGG"],
    "2:race": six,
  },
});

describe("the field of the test season", () => {
  test("six drivers race, GGG does not", () => {
    expect(state.drivers.filter((d) => d.active).map((d) => d.code).sort()).toEqual(six);
    expect(state.drivers.find((d) => d.code === "GGG")?.active).toBe(false);
  });
});

describe("gridFromOrder", () => {
  test("gives places 1..N in the order given", () => {
    expect(gridFromOrder(["CCC", "AAA", "BBB"])).toEqual({ CCC: 1, AAA: 2, BBB: 3 });
  });

  test("pit-lane starters get the places after everyone else, in the order given", () => {
    expect(gridFromOrder(["CCC", "AAA", "BBB"], ["EEE", "DDD"])).toEqual({ CCC: 1, AAA: 2, BBB: 3, EEE: 4, DDD: 5 });
  });

  test("an empty grid is an empty map", () => {
    expect(gridFromOrder([])).toEqual({});
  });

  test("a code listed twice (in either list) is a RangeError, never silently overwritten", () => {
    expect(() => gridFromOrder(["AAA", "BBB", "AAA"])).toThrow(RangeError);
    expect(() => gridFromOrder(["AAA", "BBB"], ["BBB"])).toThrow("BBB is listed twice.");
  });

  test("does not modify its input", () => {
    const order = ["CCC", "AAA"];
    const pit = ["BBB"];
    gridFromOrder(order, pit);
    expect(order).toEqual(["CCC", "AAA"]);
    expect(pit).toEqual(["BBB"]);
  });

  test("agrees with the data file's conventions: places 1..N, a pit-lane start last", () => {
    // starting_grid: AAA P1, CCC P2, BBB in the pit lane (position 0). The loader stores the pit-lane start as the field size.
    const loaded = loadSeason(
      buildDb((seed) => {
        seed.startingGrid = [
          { round: 3, abbr: "AAA", position: 1, source: "qualifying" },
          { round: 3, abbr: "BBB", position: 0, source: "qualifying" },
          { round: 3, abbr: "CCC", position: 2, source: "qualifying" },
        ];
      }),
    );
    expect(gridFromOrder(["AAA", "CCC"], ["BBB"])).toEqual(loaded.upcomingGrid!.grid);
  });

  test("the result is what forecastRace reads: moving a driver to the pit lane lowers that driver's win chance", () => {
    const params = { nSims: 4000, seed: 11, gridWeight: 1 };
    const normal = forecastRace(state, params, six, gridFromOrder(six));
    const pit = forecastRace(state, params, six, gridFromOrder(six.filter((d) => d !== "AAA"), ["AAA"]));
    expect(pit.win["AAA"]!).toBeLessThan(normal.win["AAA"]!);
  });
});

describe("dropPlaces", () => {
  test("moves the driver back N places; the drivers passed move up one", () => {
    expect(dropPlaces(six, "BBB", 2)).toEqual(["AAA", "CCC", "DDD", "BBB", "EEE", "FFF"]);
  });

  test("N is at most: a drop past the end stops at the back", () => {
    expect(dropPlaces(six, "DDD", 10)).toEqual(["AAA", "BBB", "CCC", "EEE", "FFF", "DDD"]);
  });

  test("a drop of 0 returns an equal list that is a new array", () => {
    const same = dropPlaces(six, "CCC", 0);
    expect(same).toEqual(six);
    expect(same).not.toBe(six);
  });

  test("the last driver stays last", () => {
    expect(dropPlaces(six, "FFF", 3)).toEqual(six);
  });

  test("a negative or fractional N, or a driver who is not in the list, is a RangeError", () => {
    expect(() => dropPlaces(six, "AAA", -1)).toThrow(RangeError);
    expect(() => dropPlaces(six, "AAA", 1.5)).toThrow(RangeError);
    expect(() => dropPlaces(six, "GGG", 1)).toThrow("GGG is not in the grid order.");
  });

  test("does not modify its input", () => {
    const copy = [...six];
    dropPlaces(six, "AAA", 3);
    expect(six).toEqual(copy);
  });
});

describe("backOfGrid", () => {
  test("the driver goes last; everyone behind moves up one place", () => {
    expect(backOfGrid(six, "BBB")).toEqual(["AAA", "CCC", "DDD", "EEE", "FFF", "BBB"]);
    expect(backOfGrid(six, "AAA")).toEqual(["BBB", "CCC", "DDD", "EEE", "FFF", "AAA"]);
  });

  test("the last driver stays last; an unknown driver is a RangeError", () => {
    expect(backOfGrid(six, "FFF")).toEqual(six);
    expect(() => backOfGrid(six, "GGG")).toThrow(RangeError);
  });

  test("does not modify its input", () => {
    const copy = [...six];
    backOfGrid(six, "AAA");
    expect(six).toEqual(copy);
  });
});

describe("moveTo", () => {
  test("up: the driver takes the place, the drivers in between move back one", () => {
    expect(moveTo(six, "EEE", 2)).toEqual(["AAA", "EEE", "BBB", "CCC", "DDD", "FFF"]);
  });

  test("down: the drivers in between move up one", () => {
    expect(moveTo(six, "BBB", 5)).toEqual(["AAA", "CCC", "DDD", "EEE", "BBB", "FFF"]);
  });

  test("pole and the same place", () => {
    expect(moveTo(six, "FFF", 1)).toEqual(["FFF", "AAA", "BBB", "CCC", "DDD", "EEE"]);
    expect(moveTo(six, "CCC", 3)).toEqual(six);
  });

  test("a place outside 1..N, a fraction, or an unknown driver is a RangeError", () => {
    expect(() => moveTo(six, "AAA", 0)).toThrow(RangeError);
    expect(() => moveTo(six, "AAA", 7)).toThrow("from 1 to 6");
    expect(() => moveTo(six, "AAA", 2.5)).toThrow(RangeError);
    expect(() => moveTo(six, "GGG", 2)).toThrow(RangeError);
  });

  test("does not modify its input, and every helper keeps the same drivers", () => {
    const copy = [...six];
    for (const next of [moveTo(six, "DDD", 1), dropPlaces(six, "AAA", 2), backOfGrid(six, "CCC")]) {
      expect([...next].sort()).toEqual([...six].sort());
    }
    expect(six).toEqual(copy);
  });
});

describe("validateGrid and gridProblems", () => {
  test("a complete grid is fine; a pit-lane list counts", () => {
    expect(gridProblems(state, six)).toEqual([]);
    expect(gridProblems(state, ["AAA", "BBB", "CCC", "DDD"], ["EEE", "FFF"])).toEqual([]);
    expect(() => validateGrid(state, six)).not.toThrow();
    expect(() => validateGrid(state, ["AAA", "BBB", "CCC", "DDD"], ["EEE", "FFF"])).not.toThrow();
  });

  test("a missing driver is named", () => {
    expect(gridProblems(state, ["AAA", "BBB", "CCC", "DDD", "EEE"])).toEqual(["Missing from the grid: FFF."]);
    expect(gridProblems(state, ["AAA", "BBB", "CCC"])).toEqual(["Missing from the grid: DDD, EEE, FFF."]);
  });

  test("a repeated driver is named, also when one is in the pit-lane list", () => {
    expect(gridProblems(state, ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF", "AAA"])).toEqual(["AAA is listed 2 times."]);
    expect(gridProblems(state, six, ["BBB"])).toEqual(["BBB is listed 2 times."]);
  });

  test("an unknown code is named", () => {
    expect(gridProblems(state, [...six, "ZZZ"])).toEqual(["ZZZ is not a driver in this season."]);
  });

  test("a driver who is not racing is named, and is not 'unknown'", () => {
    expect(gridProblems(state, [...six, "GGG"])).toEqual(["GGG is not racing, so it cannot be on the grid."]);
  });

  test("several problems are all reported, in a fixed order", () => {
    const problems = gridProblems(state, ["AAA", "AAA", "ZZZ", "GGG", "BBB"]);
    expect(problems).toEqual([
      "ZZZ is not a driver in this season.",
      "GGG is not racing, so it cannot be on the grid.",
      "AAA is listed 2 times.",
      "Missing from the grid: CCC, DDD, EEE, FFF.",
    ]);
  });

  test("an empty grid misses everyone", () => {
    expect(gridProblems(state, [])).toEqual(["Missing from the grid: AAA, BBB, CCC, DDD, EEE, FFF."]);
  });

  test("validateGrid throws InvalidGridError with the same problems, in plain words", () => {
    let caught: unknown;
    try {
      validateGrid(state, ["AAA", "AAA", "BBB", "CCC", "DDD", "EEE"]);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InvalidGridError);
    expect(caught).toBeInstanceOf(Error);
    const error = caught as InvalidGridError;
    expect(error.name).toBe("InvalidGridError");
    expect(error.problems).toEqual(["AAA is listed 2 times.", "Missing from the grid: FFF."]);
    expect(error.message).toBe("AAA is listed 2 times. Missing from the grid: FFF.");
  });

  test("does not modify its inputs", () => {
    const order = ["AAA", "BBB"];
    const pit = ["CCC"];
    gridProblems(state, order, pit);
    expect(order).toEqual(["AAA", "BBB"]);
    expect(pit).toEqual(["CCC"]);
  });
});

describe("parseGridText", () => {
  const sixText = "AAA BBB CCC DDD EEE FFF";

  test("codes separated by spaces", () => {
    expect(parseGridText(sixText, state)).toEqual({ order: six, pit: [], errors: [] });
  });

  test("codes separated by commas, semicolons, and lines, with extra blanks", () => {
    expect(parseGridText("AAA, BBB;CCC,\n  DDD\n\nEEE ,FFF  ", state).order).toEqual(six);
  });

  test("any case", () => {
    expect(parseGridText("aaa Bbb cCc ddd eee fff", state)).toEqual({ order: six, pit: [], errors: [] });
  });

  test("optional place numbers: '1 AAA' and '1. AAA' and '1) AAA' and '1.AAA'", () => {
    const lines = parseGridText("1 AAA\n2. BBB\n3) CCC\n4.DDD\n5: EEE\n6 FFF", state);
    expect(lines).toEqual({ order: six, pit: [], errors: [] });
  });

  test("numbers and plain codes can be mixed", () => {
    expect(parseGridText("1 AAA BBB 3 CCC DDD EEE FFF", state)).toEqual({ order: six, pit: [], errors: [] });
  });

  test("the pit-lane marker: the codes after it are the pit-lane starters, in the order given", () => {
    expect(parseGridText("AAA BBB CCC DDD PIT: FFF EEE", state)).toEqual({
      order: ["AAA", "BBB", "CCC", "DDD"],
      pit: ["FFF", "EEE"],
      errors: [],
    });
  });

  test("the marker can be written 'pit lane:' or 'Pit-lane:' or 'pit:' on its own line", () => {
    for (const marker of ["pit lane:", "Pit-Lane:", "pit:", "PIT :"]) {
      const parsed = parseGridText(`AAA BBB CCC DDD EEE\n${marker}\nFFF`, state);
      expect(parsed).toEqual({ order: ["AAA", "BBB", "CCC", "DDD", "EEE"], pit: ["FFF"], errors: [] });
    }
  });

  test("numbers carry on into the pit-lane list", () => {
    expect(parseGridText("1 AAA 2 BBB 3 CCC 4 DDD 5 EEE PIT: 6 FFF", state).errors).toEqual([]);
  });

  test("a pasted grid is accepted by validateGrid and gives the model's grid", () => {
    const parsed = parseGridText("1. BBB\n2. AAA\n3. CCC\n4. DDD\n5. EEE\nPIT: FFF", state);
    expect(parsed.errors).toEqual([]);
    expect(() => validateGrid(state, parsed.order, parsed.pit)).not.toThrow();
    expect(gridFromOrder(parsed.order, parsed.pit)).toEqual({ BBB: 1, AAA: 2, CCC: 3, DDD: 4, EEE: 5, FFF: 6 });
  });

  test("a code that is not a driver of this season is reported, not guessed", () => {
    const parsed = parseGridText("AAA ZZZ BBB", state);
    expect(parsed.order).toEqual(["AAA", "BBB"]);
    expect(parsed.errors).toEqual(["ZZZ is not a driver code in this season."]);
  });

  test("a driver who is in the standings but not racing is still readable (validateGrid reports it)", () => {
    const parsed = parseGridText("AAA BBB CCC DDD EEE FFF GGG", state);
    expect(parsed.errors).toEqual([]);
    expect(gridProblems(state, parsed.order, parsed.pit)).toEqual(["GGG is not racing, so it cannot be on the grid."]);
  });

  test("something that is not a code at all is reported as unreadable", () => {
    expect(parseGridText("AAA Antonelli BBB", state).errors).toEqual(['Could not read "Antonelli".']);
    expect(parseGridText("AAA P1 BBB", state).errors).toEqual(['Could not read "P1".']);
    expect(parseGridText("AAA — BBB", state).errors).toEqual(['Could not read "—".']);
  });

  test("a number with no driver after it is reported", () => {
    expect(parseGridText("1 2 AAA", state).errors).toEqual([
      "Number 1 has no driver after it.",
      "AAA is numbered 2, but it is entry 1 in the list.",
    ]);
    expect(parseGridText("1 PIT: AAA", state).errors).toEqual(["Number 1 has no driver after it."]);
    expect(parseGridText("AAA BBB 3", state).errors).toEqual(["Number 3 has no driver after it."]);
    expect(parseGridText("AAA 2 PIT: BBB", state).errors).toEqual(["Number 2 has no driver after it."]);
  });

  test("a number that does not match the place of its entry is reported (the list is not reordered)", () => {
    const parsed = parseGridText("2 AAA\n1 BBB", state);
    expect(parsed.order).toEqual(["AAA", "BBB"]);
    expect(parsed.errors).toEqual([
      "AAA is numbered 2, but it is entry 1 in the list.",
      "BBB is numbered 1, but it is entry 2 in the list.",
    ]);
  });

  test("a second pit-lane marker is reported", () => {
    const parsed = parseGridText("AAA BBB PIT: CCC PIT: DDD", state);
    expect(parsed.errors).toEqual(['There is more than one pit-lane marker. Use a single "PIT:" before the pit-lane starters.']);
  });

  test("empty text, or only blanks, is reported", () => {
    expect(parseGridText("", state).errors).toEqual(["The list is empty."]);
    expect(parseGridText(" \n , ; ", state).errors).toEqual(["The list is empty."]);
  });

  test("a repeated code is read as written; validateGrid reports it", () => {
    const parsed = parseGridText("AAA AAA BBB", state);
    expect(parsed.errors).toEqual([]);
    expect(parsed.order).toEqual(["AAA", "AAA", "BBB"]);
    expect(gridProblems(state, parsed.order, parsed.pit)[0]).toBe("AAA is listed 2 times.");
  });

  test("every problem is reported, not just the first", () => {
    const parsed = parseGridText("ZZZ Antonelli 4 AAA", state);
    expect(parsed.errors).toEqual([
      "ZZZ is not a driver code in this season.",
      'Could not read "Antonelli".',
      "AAA is numbered 4, but it is entry 1 in the list.",
    ]);
  });

  test("does not touch the season state", () => {
    const before = JSON.stringify(state);
    parseGridText("AAA BBB PIT: CCC", state);
    expect(JSON.stringify(state)).toBe(before);
  });
});
