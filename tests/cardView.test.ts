import { describe, expect, test } from "bun:test";
import { buildCardView } from "../web/viewModel/cardView";
import type { SeasonState } from "../engine";
import type { OddsResult } from "../engine/odds";
import { defaultOddsParams } from "../engine/simulate";
import type { SavedScenario } from "../web/viewModel/scenarios";
import type { Workspace } from "../web/viewModel/workspace";

/** Minimal SeasonState for cardView tests. Two drivers, two teams, 3 rounds (1 completed). */
function makeState(): SeasonState {
  return {
    season: 2026,
    asOfRound: 1,
    rounds: [
      { round: 1, name: "Bahrain", hasSprint: false, status: "completed" },
      { round: 2, name: "Saudi", hasSprint: false, status: "scheduled" },
      { round: 3, name: "Australia", hasSprint: false, status: "scheduled" },
    ],
    results: [
      { round: 1, kind: "race", driver: "AAA", team: "alpha", position: 1, points: 25, classified: true, grid: 1 },
      { round: 1, kind: "race", driver: "BBB", team: "beta", position: 2, points: 18, classified: true, grid: 2 },
    ],
    qualifying: [],
    drivers: [
      { code: "AAA", name: "Anna Alpha", active: true },
      { code: "BBB", name: "Bruno Beta", active: true },
    ],
    teams: [
      { id: "alpha", name: "Alpha Racing" },
      { id: "beta", name: "Beta Racing" },
    ],
    health: { status: "ok", checkedAt: "2026-10-01T00:00:00Z" },
    schemaVersion: 2,
  };
}

function makeWorkspace(): Workspace {
  return {
    scenario: { locks: {} },
    contenders: ["AAA", "BBB"],
    mode: "contenders",
    focus: "AAA",
    team: null,
    notice: null,
  };
}

function makeScenarios(): SavedScenario[] {
  return [
    {
      id: "s1",
      name: "Alpha dominates",
      season: 2026,
      asOfRound: 1,
      locks: {},
      contenders: ["AAA"],
      valid: true,
      stale: false,
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-01T00:00:00Z",
    },
  ];
}

function makeOddsResult(): OddsResult {
  return {
    asOfRound: 1,
    roundsCompleted: 1,
    lowConfidence: true,
    nSims: 1000,
    seed: 42,
    params: {
      ...defaultOddsParams,
      nSims: 1000,
      seed: 42,
    },
    modelVersion: "v2",
    gridKnownRound: null,
    wdc: [
      { id: "AAA", wins: 800, probability: 0.8, display: "80%", avgPoints: 250, status: "alive" },
      { id: "BBB", wins: 200, probability: 0.2, display: "20%", avgPoints: 200, status: "alive" },
    ],
    wcc: [],
    maxStdError: 0.01,
  };
}

describe("web/viewModel/cardView: buildCardView", () => {
  test("builds correct season, round, and scenario name for Base", () => {
    const view = buildCardView(makeState(), makeWorkspace(), makeScenarios(), null, null);
    expect(view.season).toBe(2026);
    expect(view.asOfRound).toBe(1);
    expect(view.scenarioName).toBe("Base");
  });

  test("uses saved scenario name when one is selected", () => {
    const view = buildCardView(makeState(), makeWorkspace(), makeScenarios(), "s1", null);
    expect(view.scenarioName).toBe("Alpha dominates");
  });

  test("includes all drivers as rows", () => {
    const view = buildCardView(makeState(), makeWorkspace(), makeScenarios(), null, null);
    expect(view.rows.length).toBe(2);
  });

  test("rows have rank, driver code, base and projected points", () => {
    const view = buildCardView(makeState(), makeWorkspace(), makeScenarios(), null, null);
    const first = view.rows[0]!;
    expect(first.rank).toBe(1);
    expect(first.driverCode).toBe("AAA");
    expect(first.currentPoints).toBe(25);
    expect(first.projectedPoints).toBe(25);
    expect(first.deltaPoints).toBe(0);
  });

  test("driver name is included when it differs from code", () => {
    const view = buildCardView(makeState(), makeWorkspace(), makeScenarios(), null, null);
    const aaa = view.rows.find((r) => r.driverCode === "AAA");
    expect(aaa?.driverName).toBe("Anna Alpha");
  });

  test("hasOdds is false when no odds result", () => {
    const view = buildCardView(makeState(), makeWorkspace(), makeScenarios(), null, null);
    expect(view.hasOdds).toBe(false);
  });

  test("hasOdds is true when odds result is provided", () => {
    const view = buildCardView(makeState(), makeWorkspace(), makeScenarios(), null, makeOddsResult());
    expect(view.hasOdds).toBe(true);
  });

  test("oddsDisplay values come from odds result", () => {
    const view = buildCardView(makeState(), makeWorkspace(), makeScenarios(), null, makeOddsResult());
    const aaa = view.rows.find((r) => r.driverCode === "AAA");
    expect(aaa?.oddsDisplay).toBe("80%");
    const bbb = view.rows.find((r) => r.driverCode === "BBB");
    expect(bbb?.oddsDisplay).toBe("20%");
  });

  test("statusText is capitalized (alive → Alive, longShot → Long shot)", () => {
    const view = buildCardView(makeState(), makeWorkspace(), makeScenarios(), null, null);
    for (const row of view.rows) {
      if (row.statusText) {
        expect(row.statusText.charAt(0)).toBe(row.statusText.charAt(0).toUpperCase());
      }
    }
  });

  test("a driver who cannot win the title gets the text '✕ No title'; the leader is 'Clinched'", () => {
    // AAA wins both remaining races: 25 + 25 + 25 = 75, BBB can reach at most 18 (unspecified drivers add 0).
    const workspace = {
      ...makeWorkspace(),
      scenario: { locks: { "2:race": { fixed: { AAA: 1 } }, "3:race": { fixed: { AAA: 1 } } } },
    } as Workspace;
    const view = buildCardView(makeState(), workspace, makeScenarios(), null, null);
    expect(view.rows.find((r) => r.driverCode === "AAA")?.statusText).toBe("Clinched");
    expect(view.rows.find((r) => r.driverCode === "BBB")?.statusText).toBe("✕ No title");
  });

  describe("the card follows the Title info choice", () => {
    const oneOut = () =>
      ({
        ...makeWorkspace(),
        scenario: { locks: { "2:race": { fixed: { AAA: 1 } }, "3:race": { fixed: { AAA: 1 } } } },
      }) as Workspace;
    const build = (workspace: Workspace, mode?: "on" | "off") =>
      buildCardView(makeState(), workspace, makeScenarios(), null, null, mode);

    test("on: the status column is drawn", () => {
      expect(build(makeWorkspace(), "on").showTitleInfo).toBe(true);
    });

    test("off: it is not, even when someone is out", () => {
      expect(build(oneOut(), "off").showTitleInfo).toBe(false);
    });

    test("on is the default when no choice is passed", () => {
      expect(build(makeWorkspace()).showTitleInfo).toBe(true);
      expect(build(oneOut()).showTitleInfo).toBe(true);
    });

    test("the row data is unchanged by the choice: only whether it is drawn differs", () => {
      expect(build(oneOut(), "off").rows).toEqual(build(oneOut(), "on").rows);
    });
  });

  test("the word 'Eliminated' never appears on the card", () => {
    const view = buildCardView(makeState(), makeWorkspace(), makeScenarios(), null, null);
    for (const row of view.rows) expect(row.statusText).not.toBe("Eliminated");
  });

  test("rows include bestText", () => {
    const view = buildCardView(makeState(), makeWorkspace(), makeScenarios(), null, null);
    expect(view.rows[0]?.bestText).toBeDefined();
    expect(view.rows[0]?.bestText).toMatch(/^P\d+$/);
  });

  test("builds cardView for WCC with tab = 'wcc'", () => {
    const odds = {
      ...makeOddsResult(),
      wcc: [
        { id: "alpha", wins: 700, probability: 0.7, display: "70%", avgPoints: 400, status: "alive" as const },
        { id: "beta", wins: 300, probability: 0.3, display: "30%", avgPoints: 350, status: "alive" as const },
      ],
    };
    const view = buildCardView(makeState(), makeWorkspace(), makeScenarios(), null, odds, "on", "wcc", "all");
    expect(view.tab).toBe("wcc");
    expect(view.rowLimit).toBe("all");
    expect(view.rows.length).toBe(2);
    expect(view.hasOdds).toBe(true);
    const alpha = view.rows.find((r) => r.constructorId === "alpha");
    expect(alpha?.driverCode).toBe("Alpha Racing");
    expect(alpha?.oddsDisplay).toBe("70%");
    expect(alpha?.bestText).toBeDefined();
  });

  test("no tokens, server paths, or localhost in any field", () => {
    const view = buildCardView(makeState(), makeWorkspace(), makeScenarios(), "s1", makeOddsResult());
    const strings = [
      view.scenarioName,
      ...view.rows.map((r) => [r.driverCode, r.driverName ?? "", r.statusText, r.oddsDisplay ?? ""]).flat(),
    ];
    for (const s of strings) {
      expect(s).not.toContain("token");
      expect(s).not.toContain("127.0.0.1");
      expect(s).not.toContain("localhost");
      expect(s).not.toContain("/api/");
    }
  });
});