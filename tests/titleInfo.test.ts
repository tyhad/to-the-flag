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

describe("the two modes", () => {
  test("on, off, in that order; the default is on", () => {
    expect([...TITLE_INFO_MODES]).toEqual(["on", "off"]);
    expect(DEFAULT_TITLE_INFO).toBe("on");
  });

  test("parseTitleInfo accepts the two values and gives the default for anything else", () => {
    expect(parseTitleInfo("on")).toBe("on");
    expect(parseTitleInfo("off")).toBe("off");
    for (const bad of [null, undefined, "", "auto", "ON", "yes", "true", " off", 1, {}]) {
      expect(parseTitleInfo(bad)).toBe("on");
    }
  });
});

describe("remembering the choice", () => {
  test("nothing stored gives the default, on", () => {
    expect(readTitleInfo(memoryStorage())).toBe("on");
  });

  test("a stored choice is read back", () => {
    for (const mode of TITLE_INFO_MODES) {
      expect(readTitleInfo(memoryStorage({ [TITLE_INFO_STORAGE_KEY]: mode }))).toBe(mode);
    }
  });

  test("a stored value that is not a mode gives the default", () => {
    expect(readTitleInfo(memoryStorage({ [TITLE_INFO_STORAGE_KEY]: "banana" }))).toBe("on");
  });

  test("storage that throws gives the default instead of throwing", () => {
    expect(() => readTitleInfo(brokenStorage)).not.toThrow();
    expect(readTitleInfo(brokenStorage)).toBe("on");
  });

  test("no storage at all (undefined) gives the default", () => {
    expect(readTitleInfo(undefined)).toBe("on");
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

  test("does not modify the rows", () => {
    const rows = Object.freeze([Object.freeze({ best: 1 }), Object.freeze({ best: 3 })]);
    expect(() => titleInfoVisible("on", rows)).not.toThrow();
  });
});

describe("keyboard: nextTitleInfo", () => {
  test("ArrowRight and ArrowDown toggle between on and off", () => {
    expect(nextTitleInfo("on", "ArrowRight")).toBe("off");
    expect(nextTitleInfo("off", "ArrowRight")).toBe("on");
    expect(nextTitleInfo("on", "ArrowDown")).toBe("off");
  });

  test("ArrowLeft and ArrowUp toggle between on and off", () => {
    expect(nextTitleInfo("off", "ArrowLeft")).toBe("on");
    expect(nextTitleInfo("on", "ArrowLeft")).toBe("off");
    expect(nextTitleInfo("off", "ArrowUp")).toBe("on");
  });

  test("Home goes to on and End to off", () => {
    expect(nextTitleInfo("off", "Home")).toBe("on");
    expect(nextTitleInfo("on", "End")).toBe("off");
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
