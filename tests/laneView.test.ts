/** Phase 2 Step 9: the Finish Lane model (pure). */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { driverStatus, type Scenario, type SeasonState } from "../engine";
import {
  axisBounds,
  axisTicks,
  buildLaneView,
  describeLane,
  laneModel,
  laneX,
} from "../web/viewModel/lane";
import { makeState } from "./helpers";

// AAA 75, BBB 54, CCC 45, DDD 36 after 3 races. Two races (50 points) left.
// Ceilings: AAA 125, BBB 104, CCC 95, DDD 86. Best rival of the leader is BBB: 104.
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

// AAA 100 after four wins, BBB 72, one race left: AAA is past the line.
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

const upset: Scenario = { locks: { "4:race": { fixed: { DDD: 1, CCC: 2 } } } };

describe("axisBounds", () => {
  test("a ten-point margin below the lowest value and above the highest, on whole tens", () => {
    expect(axisBounds(188, 503)).toEqual({ axisMin: 170, axisMax: 510 });
    expect(axisBounds(36, 125)).toEqual({ axisMin: 20, axisMax: 130 });
  });

  test("never below zero", () => {
    expect(axisBounds(0, 75)).toEqual({ axisMin: 0, axisMax: 80 });
    expect(axisBounds(5, 75)).toEqual({ axisMin: 0, axisMax: 80 });
  });

  test("the top is always strictly above the highest value, so nothing sits on the edge", () => {
    expect(axisBounds(100, 120).axisMax).toBe(130);
    expect(axisBounds(200, 200)).toEqual({ axisMin: 190, axisMax: 210 });
  });
});

describe("axisTicks", () => {
  test("whole steps that give at most seven labels", () => {
    expect(axisTicks(170, 510)).toEqual([200, 250, 300, 350, 400, 450, 500]);
    expect(axisTicks(20, 130)).toEqual([20, 40, 60, 80, 100, 120]);
  });

  test("a small range gets a fine step", () => {
    expect(axisTicks(0, 40)).toEqual([0, 10, 20, 30, 40]);
  });

  test("every tick lies inside the axis", () => {
    for (const [lo, hi] of [[170, 510], [20, 130], [0, 80], [190, 210]] as const) {
      const ticks = axisTicks(lo, hi);
      expect(ticks.length).toBeGreaterThan(1);
      expect(ticks.every((t) => t >= lo && t <= hi)).toBe(true);
    }
  });
});

describe("laneX", () => {
  const model = { axisMin: 100, axisMax: 200 };

  test("the axis start and end map to the left and right edges of the track", () => {
    expect(laneX(100, model, 600, 10, 20)).toBe(10);
    expect(laneX(200, model, 600, 10, 20)).toBe(580);
  });

  test("points in between are placed in proportion", () => {
    expect(laneX(150, model, 600, 10, 20)).toBe(295);
  });

  test("a value outside the axis stays on the track", () => {
    expect(laneX(50, model, 600, 10, 20)).toBe(10);
    expect(laneX(999, model, 600, 10, 20)).toBe(580);
  });

  test("a flat axis does not divide by zero", () => {
    expect(laneX(5, { axisMin: 5, axisMax: 5 }, 600, 10, 20)).toBe(10);
  });
});

describe("laneModel: synthetic season, no locks", () => {
  const model = laneModel(four(), undefined);

  test("one lane per contender, in table order", () => {
    expect(model.lanes.map((l) => l.driver)).toEqual(["AAA", "BBB", "CCC", "DDD"]);
  });

  test("base, projected and ceiling for each lane", () => {
    expect(model.lanes).toEqual([
      { driver: "AAA", base: 75, projected: 75, ceiling: 125 },
      { driver: "BBB", base: 54, projected: 54, ceiling: 104 },
      { driver: "CCC", base: 45, projected: 45, ceiling: 95 },
      { driver: "DDD", base: 36, projected: 36, ceiling: 86 },
    ]);
  });

  test("the finish line is where the leader clinches: the best rival's ceiling plus one", () => {
    expect(model.finishAt).toBe(105);
  });

  test("the axis covers every base and every ceiling", () => {
    expect(model.axisMin).toBe(20);
    expect(model.axisMax).toBe(130);
  });

  test("the line agrees with the status table: leader's points plus pointsToClinch", () => {
    const lead = driverStatus(four()).find((r) => r.driver === "AAA")!;
    expect(model.finishAt - 75).toBe(lead.pointsToClinch!);
  });
});

describe("laneModel: with locked sessions", () => {
  // 4:race: DDD wins, CCC second. DDD 61, CCC 63; one race (25) left.
  const model = laneModel(four(), upset);

  test("lanes re-order by projected points, keeping the real points as base", () => {
    expect(model.lanes).toEqual([
      { driver: "AAA", base: 75, projected: 75, ceiling: 100 },
      { driver: "CCC", base: 45, projected: 63, ceiling: 88 },
      { driver: "DDD", base: 36, projected: 61, ceiling: 86 },
      { driver: "BBB", base: 54, projected: 54, ceiling: 79 },
    ]);
  });

  test("locked sessions shrink the ceilings and pull the line in", () => {
    expect(model.finishAt).toBe(89);
    expect(model.axisMin).toBe(20);
    expect(model.axisMax).toBe(110);
  });

  test("projected never falls below base and never passes the ceiling", () => {
    for (const lane of model.lanes) {
      expect(lane.projected).toBeGreaterThanOrEqual(lane.base);
      expect(lane.ceiling).toBeGreaterThanOrEqual(lane.projected);
    }
  });

  test("with every session locked the ceiling is the projected total", () => {
    const all = laneModel(four(), { locks: { "4:race": { fixed: { AAA: 1 } }, "5:race": { fixed: { AAA: 1 } } } });
    for (const lane of all.lanes) expect(lane.ceiling).toBe(lane.projected);
    // AAA 125; best rival BBB 54: the line is 55, far behind the leader.
    expect(all.finishAt).toBe(55);
  });
});

describe("laneModel: contenders", () => {
  test("a clinched leader sits past the line", () => {
    const model = laneModel(decided(), undefined, ["AAA", "BBB"]);
    expect(model.finishAt).toBe(98);
    expect(model.lanes[0]).toEqual({ driver: "AAA", base: 100, projected: 100, ceiling: 125 });
    expect(model.lanes[0]!.projected).toBeGreaterThanOrEqual(model.finishAt);
    expect(model.axisMin).toBe(60);
    expect(model.axisMax).toBe(130);
  });

  test("lanes follow the table, not the order the contenders were listed, and unknown codes are skipped", () => {
    const model = laneModel(four(), undefined, ["DDD", "ZZZ", "AAA"]);
    expect(model.lanes.map((l) => l.driver)).toEqual(["AAA", "DDD"]);
  });

  test("the line does not depend on which drivers are shown", () => {
    expect(laneModel(four(), undefined, ["DDD"]).finishAt).toBe(105);
  });

  test("by default the lanes are the drivers still in the title fight, at most five", () => {
    expect(laneModel(four(), undefined).lanes).toHaveLength(4);
  });
});

describe("describeLane", () => {
  const lane = { driver: "DDD", base: 36, projected: 61, ceiling: 86 };

  test("says the points, what the locks added, the most they can reach and the distance to the line", () => {
    expect(describeLane("Dee", lane, 89)).toBe(
      "Dee: 61 points, up from 36 with locked results. Most they can reach: 86. 28 points from the finish line at 89.",
    );
  });

  test("no locks, no 'up from'", () => {
    expect(describeLane("Dee", { driver: "DDD", base: 36, projected: 36, ceiling: 86 }, 105)).toBe(
      "Dee: 36 points. Most they can reach: 86. 69 points from the finish line at 105.",
    );
  });

  test("a single point is singular", () => {
    expect(describeLane("Dee", { driver: "DDD", base: 36, projected: 36, ceiling: 86 }, 37)).toContain(
      "1 point from the finish line at 37.",
    );
  });

  test("past the line means the title is clinched", () => {
    expect(describeLane("Ann", { driver: "AAA", base: 100, projected: 100, ceiling: 125 }, 98)).toBe(
      "Ann: 100 points. Most they can reach: 125. Past the finish line, so the title is clinched.",
    );
  });
});

describe("buildLaneView", () => {
  test("rows carry the name, team and summary the lane needs", () => {
    const view = buildLaneView(four(), undefined);
    expect(view.rows.map((r) => r.driver)).toEqual(["AAA", "BBB", "CCC", "DDD"]);
    expect(view.rows[2]).toMatchObject({ driver: "CCC", name: "CCC", teamId: "blue", base: 45, projected: 45, ceiling: 95 });
    expect(view.rows[0]!.summary).toBe(
      "AAA: 75 points. Most they can reach: 125. 30 points from the finish line at 105.",
    );
  });

  test("the caption names the leader's distance to the line", () => {
    expect(buildLaneView(four(), undefined).caption).toBe(
      "The finish line is at 105 points: AAA needs 30 more to clinch.",
    );
    expect(buildLaneView(four(), { locks: { "4:race": { fixed: { AAA: 1 } }, "5:race": { fixed: { AAA: 1 } } } }).caption).toBe(
      "AAA has passed the finish line at 55 points.",
    );
  });

  test("uses the given contenders", () => {
    expect(buildLaneView(four(), undefined, ["BBB", "DDD"]).rows.map((r) => r.driver)).toEqual(["BBB", "DDD"]);
  });
});

const REAL = join(import.meta.dir, "fixtures", "season-2026-r16.json");

describe.skipIf(!existsSync(REAL))("laneModel on the real Round 16 snapshot", () => {
  const state = JSON.parse(readFileSync(REAL, "utf8")) as SeasonState;

  test("five lanes: the top five, ANT on 320", () => {
    const model = laneModel(state, undefined);
    expect(model.lanes.map((l) => l.driver)).toEqual(["ANT", "RUS", "HAM", "LEC", "NOR"]);
    expect(model.lanes[0]).toEqual({ driver: "ANT", base: 320, projected: 320, ceiling: 503 });
  });

  test("the line is at 420, by hand: RUS 236 + 183 left + 1; ANT needs 100 more", () => {
    const model = laneModel(state, undefined);
    expect(model.finishAt).toBe(420);
    expect(model.finishAt - 320).toBe(100);
  });

  test("the axis runs 170 to 510", () => {
    const model = laneModel(state, undefined);
    expect(model.axisMin).toBe(170);
    expect(model.axisMax).toBe(510);
  });

  test("a locked sprint win for ANT: 328 projected, ceiling and line move by the 8 points taken", () => {
    const model = laneModel(state, { locks: { "17:sprint": { fixed: { ANT: 1 } } } });
    expect(model.lanes[0]).toMatchObject({ driver: "ANT", base: 320, projected: 328, ceiling: 503 });
    expect(model.lanes[1]).toMatchObject({ driver: "RUS", projected: 236, ceiling: 411 });
    expect(model.finishAt).toBe(412);
  });

  test("the caption in words", () => {
    expect(buildLaneView(state, undefined).caption).toBe(
      "The finish line is at 420 points: Andrea Kimi Antonelli needs 100 more to clinch.",
    );
  });
});
