/**
 * Phase 7, Step 5: the "Title info" choice (Auto, On, Off) and the rule that decides whether the status tags and
 * the Best column are drawn (D44). All pure: no DOM, no storage of its own.
 */
import { describe, expect, test } from "bun:test";
import type { Scenario } from "../engine/types";
import {
  DEFAULT_TITLE_INFO,
  TITLE_INFO_MODES,
  TITLE_INFO_STORAGE_KEY,
  nextTitleInfo,
  parseTitleInfo,
  readTitleInfo,
  titleInfoVisible,
  writeTitleInfo,
  type TitleInfoStorage,
} from "../web/viewModel/titleInfo";
import { buildTowerRows, towerColumns } from "../web/viewModel/tower";
import { makeState } from "./helpers";

/** A storage that keeps values in a map. */
function memoryStorage(initial: Record<string, string> = {}): TitleInfoStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key]! : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

/** A storage that throws on every call, like a browser with storage switched off. */
const brokenStorage: TitleInfoStorage = {
  getItem: () => {
    throw new Error("storage is off");
  },
  setItem: () => {
    throw new Error("storage is off");
  },
};

describe("the three modes", () => {
  test("auto, on, off, in that order; the default is auto", () => {
    expect([...TITLE_INFO_MODES]).toEqual(["auto", "on", "off"]);
    expect(DEFAULT_TITLE_INFO).toBe("auto");
  });

  test("parseTitleInfo accepts the three values and gives the default for anything else", () => {
    expect(parseTitleInfo("auto")).toBe("auto");
    expect(parseTitleInfo("on")).toBe("on");
    expect(parseTitleInfo("off")).toBe("off");
    for (const bad of [null, undefined, "", "ON", "yes", "true", " off", 1, {}]) {
      expect(parseTitleInfo(bad)).toBe("auto");
    }
  });
});

describe("remembering the choice", () => {
  test("nothing stored gives the default, auto", () => {
    expect(readTitleInfo(memoryStorage())).toBe("auto");
  });

  test("a stored choice is read back", () => {
    for (const mode of TITLE_INFO_MODES) {
      expect(readTitleInfo(memoryStorage({ [TITLE_INFO_STORAGE_KEY]: mode }))).toBe(mode);
    }
  });

  test("a stored value that is not a mode gives the default", () => {
    expect(readTitleInfo(memoryStorage({ [TITLE_INFO_STORAGE_KEY]: "banana" }))).toBe("auto");
  });

  test("storage that throws gives the default instead of throwing", () => {
    expect(() => readTitleInfo(brokenStorage)).not.toThrow();
    expect(readTitleInfo(brokenStorage)).toBe("auto");
  });

  test("no storage at all (undefined) gives the default", () => {
    expect(readTitleInfo(undefined)).toBe("auto");
  });

  test("writing stores the mode under the key, and reading gives it back", () => {
    const storage = memoryStorage();
    writeTitleInfo("off", storage);
    expect(storage.data[TITLE_INFO_STORAGE_KEY]).toBe("off");
    expect(readTitleInfo(storage)).toBe("off");
    writeTitleInfo("on", storage);
    expect(readTitleInfo(storage)).toBe("on");
  });

  test("writing to storage that throws, or to no storage, does not throw", () => {
    expect(() => writeTitleInfo("on", brokenStorage)).not.toThrow();
    expect(() => writeTitleInfo("on", undefined)).not.toThrow();
  });

  test("the key is specific to this app", () => {
    expect(TITLE_INFO_STORAGE_KEY).toMatch(/^ttf_/);
  });
});

describe("titleInfoVisible", () => {
  const nobodyOut = [{ best: 1 }, { best: 1 }, { best: 1 }];
  const oneOut = [{ best: 1 }, { best: 1 }, { best: 2 }];

  test("on is always true", () => {
    expect(titleInfoVisible("on", nobodyOut)).toBe(true);
    expect(titleInfoVisible("on", oneOut)).toBe(true);
    expect(titleInfoVisible("on", [])).toBe(true);
  });

  test("off is always false, even when someone is out", () => {
    expect(titleInfoVisible("off", nobodyOut)).toBe(false);
    expect(titleInfoVisible("off", oneOut)).toBe(false);
    expect(titleInfoVisible("off", [])).toBe(false);
  });

  test("auto with nobody out: false (every row would say 'alive' and 'P1')", () => {
    expect(titleInfoVisible("auto", nobodyOut)).toBe(false);
  });

  test("auto with one entry out (best 2): true", () => {
    expect(titleInfoVisible("auto", oneOut)).toBe(true);
  });

  test("auto: 'best 2 or worse' counts, so any worse place also turns it on", () => {
    expect(titleInfoVisible("auto", [{ best: 1 }, { best: 7 }])).toBe(true);
    expect(titleInfoVisible("auto", [{ best: 20 }])).toBe(true);
  });

  test("auto with no rows: false", () => {
    expect(titleInfoVisible("auto", [])).toBe(false);
  });

  test("does not modify the rows", () => {
    const rows = Object.freeze([Object.freeze({ best: 1 }), Object.freeze({ best: 3 })]);
    expect(() => titleInfoVisible("auto", rows)).not.toThrow();
  });
});

describe("auto decides for the table being viewed: WDC and WCC separately", () => {
  // One team with five drivers, one race left. CCC and DDD can no longer win (best P2), but there is only
  // one team, so in the WCC nobody is out.
  const drivers = makeState({
    rounds: 4,
    completed: 3,
    teams: { t: ["AAA", "BBB", "CCC", "DDD", "EEE"] },
    results: {
      "1:race": ["AAA", "BBB", "CCC", "DDD", "EEE"],
      "2:race": ["AAA", "BBB", "CCC", "DDD", "EEE"],
      "3:race": ["AAA", "BBB", "CCC", "DDD"],
    },
  });

  test("someone out in the WDC turns auto on there, while the WCC (one team) stays plain", () => {
    expect(titleInfoVisible("auto", buildTowerRows(drivers, undefined, "wdc"))).toBe(true);
    expect(titleInfoVisible("auto", buildTowerRows(drivers, undefined, "wcc"))).toBe(false);
  });

  test("early in the season nobody is out, in either table", () => {
    const early = makeState({
      rounds: 10,
      completed: 1,
      teams: { red: ["AAA", "BBB"], blue: ["CCC", "DDD"] },
      results: { "1:race": ["AAA", "BBB", "CCC", "DDD"] },
    });
    expect(titleInfoVisible("auto", buildTowerRows(early, undefined, "wdc"))).toBe(false);
    expect(titleInfoVisible("auto", buildTowerRows(early, undefined, "wcc"))).toBe(false);
  });

  test("a lock can take auto from plain to shown: it follows the scenario", () => {
    // After 3 races: AAA 52, BBB 55, CCC 58, DDD 45; one race left (25). Ceilings 77, 80, 83, 70: nobody is out.
    const s = makeState({
      rounds: 4,
      completed: 3,
      teams: { red: ["AAA", "BBB"], blue: ["CCC", "DDD"] },
      results: {
        "1:race": ["AAA", "BBB", "CCC", "DDD"],
        "2:race": ["BBB", "CCC", "DDD", "AAA"],
        "3:race": ["CCC", "DDD", "AAA", "BBB"],
      },
    });
    expect(titleInfoVisible("auto", buildTowerRows(s, undefined, "wdc"))).toBe(false);
    // The last race locked as CCC, AAA, BBB, DDD: CCC 83, AAA 70, BBB 70, DDD 57. Nothing is open any more,
    // so CCC's 83 is above AAA's and BBB's ceiling of 70: they are P2 at best.
    const scenario: Scenario = { locks: { "4:race": { fixed: { CCC: 1, AAA: 2, BBB: 3, DDD: 4 } } } };
    expect(titleInfoVisible("auto", buildTowerRows(s, scenario, "wdc"))).toBe(true);
  });
});

describe("keyboard: nextTitleInfo", () => {
  test("ArrowRight and ArrowDown go to the next mode and wrap round", () => {
    expect(nextTitleInfo("auto", "ArrowRight")).toBe("on");
    expect(nextTitleInfo("on", "ArrowRight")).toBe("off");
    expect(nextTitleInfo("off", "ArrowRight")).toBe("auto");
    expect(nextTitleInfo("auto", "ArrowDown")).toBe("on");
  });

  test("ArrowLeft and ArrowUp go to the previous mode and wrap round", () => {
    expect(nextTitleInfo("on", "ArrowLeft")).toBe("auto");
    expect(nextTitleInfo("auto", "ArrowLeft")).toBe("off");
    expect(nextTitleInfo("off", "ArrowUp")).toBe("on");
  });

  test("Home goes to the first mode and End to the last", () => {
    expect(nextTitleInfo("off", "Home")).toBe("auto");
    expect(nextTitleInfo("auto", "End")).toBe("off");
  });

  test("any other key is ignored", () => {
    for (const key of ["Enter", " ", "Tab", "a", "Escape"]) expect(nextTitleInfo("on", key)).toBeNull();
  });
});

describe("towerColumns: what the table draws", () => {
  test("with the info shown: rank, name, points, change, best, status", () => {
    expect(towerColumns(true)).toEqual(["rank", "name", "points", "delta", "best", "status"]);
  });

  test("hidden: a plain standings table; rank, name, points and change stay", () => {
    expect(towerColumns(false)).toEqual(["rank", "name", "points", "delta"]);
    expect(towerColumns(false)).not.toContain("best");
    expect(towerColumns(false)).not.toContain("status");
  });
});
