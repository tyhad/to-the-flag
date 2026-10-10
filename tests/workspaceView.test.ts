/** Phase 2 Step 6: workspace state (scenario, contenders, mode, focus) as a pure reducer. */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SeasonState } from "../engine";
import { buildTowerRows } from "../web/viewModel/tower";
import {
  initialWorkspace,
  presetTargets,
  workspaceReducer,
  type Workspace,
  type WorkspaceMessage,
} from "../web/viewModel/workspace";

const REAL = join(import.meta.dir, "fixtures", "season-2026-r16.json");

describe.skipIf(!existsSync(REAL))("workspace on the real Round 16 snapshot", () => {
  const state = JSON.parse(readFileSync(REAL, "utf8")) as SeasonState;
  const send = (ws: Workspace, ...messages: WorkspaceMessage[]): Workspace =>
    messages.reduce((acc, m) => workspaceReducer(state, acc, m), ws);

  test("starts with five contenders, contender mode, focus on second place, nothing locked", () => {
    const ws = initialWorkspace(state);
    expect(ws.contenders).toEqual(["ANT", "RUS", "HAM", "LEC", "NOR"]);
    expect(ws.mode).toBe("contenders");
    expect(ws.focus).toBe("RUS");
    expect(ws.scenario).toEqual({ locks: {} });
    expect(ws.notice).toBeNull();
  });

  test("lock the next race for the leader at P1: the table reacts, and unlocking restores the base table", () => {
    const base = buildTowerRows(state, undefined, "wdc");
    let ws = send(
      initialWorkspace(state),
      { type: "lock", key: "17:race" },
      { type: "assign", key: "17:race", driver: "ANT", position: 1 },
    );
    expect(ws.notice).toBeNull();
    const locked = buildTowerRows(state, ws.scenario, "wdc");
    expect(locked[0]).toMatchObject({ id: "ANT", basePoints: 320, points: 345, pointsAdded: 25 });
    expect(locked.find((r) => r.id === "RUS")?.points).toBe(236);

    ws = send(ws, { type: "unlock", key: "17:race" });
    expect(buildTowerRows(state, ws.scenario, "wdc")).toEqual(base);
  });

  test("contender mode refuses a non-contender with a message scoped to that session; the scenario is untouched", () => {
    const locked = send(initialWorkspace(state), { type: "lock", key: "17:race" });
    const refused = send(locked, { type: "assign", key: "17:race", driver: "PIA", position: 1 });
    expect(refused.scenario).toBe(locked.scenario);
    expect(refused.notice).toEqual({
      scope: "17:race",
      message: "PIA is not one of your contenders. Add them to your contenders, or switch to all drivers.",
    });
  });

  test("switching to all drivers lets the owner place anyone", () => {
    const ws = send(
      initialWorkspace(state),
      { type: "lock", key: "17:race" },
      { type: "setMode", mode: "all" },
      { type: "assign", key: "17:race", driver: "PIA", position: 1 },
    );
    expect(ws.mode).toBe("all");
    expect(ws.notice).toBeNull();
    expect(ws.scenario.locks["17:race"]?.fixed).toEqual({ PIA: 1 });
  });

  test("a duplicate position is refused with a plain message", () => {
    const ws = send(
      initialWorkspace(state),
      { type: "lock", key: "17:race" },
      { type: "assign", key: "17:race", driver: "ANT", position: 1 },
      { type: "assign", key: "17:race", driver: "RUS", position: 1 },
    );
    expect(ws.notice?.message).toBe("P1 already belongs to ANT. Move ANT first.");
    expect(ws.scenario.locks["17:race"]?.fixed).toEqual({ ANT: 1 });
  });

  test("a successful action clears an earlier message", () => {
    const refused = send(
      initialWorkspace(state),
      { type: "lock", key: "17:race" },
      { type: "assign", key: "17:race", driver: "PIA", position: 1 },
    );
    expect(refused.notice).not.toBeNull();
    const ok = send(refused, { type: "assign", key: "17:race", driver: "ANT", position: 1 });
    expect(ok.notice).toBeNull();
    expect(send(refused, { type: "dismissNotice" }).notice).toBeNull();
  });

  describe("presets use the focus contender and the best-placed rival", () => {
    test("who they point at", () => {
      expect(presetTargets(state, initialWorkspace(state))).toEqual({ contender: "RUS", rival: "ANT" });
    });

    test("Contender wins puts the focus on P1; Rival out marks the rival out", () => {
      const ws = send(
        initialWorkspace(state),
        { type: "lock", key: "17:race" },
        { type: "preset", key: "17:race", preset: "contenderWins" },
        { type: "preset", key: "17:race", preset: "rivalOut" },
      );
      expect(ws.notice).toBeNull();
      expect(ws.scenario.locks["17:race"]?.fixed).toEqual({ RUS: 1, ANT: "out" });
    });

    test("changing the focus changes who wins", () => {
      const ws = send(
        initialWorkspace(state),
        { type: "lock", key: "17:race" },
        { type: "setFocus", driver: "HAM" },
        { type: "preset", key: "17:race", preset: "contenderWins" },
      );
      expect(ws.focus).toBe("HAM");
      expect(ws.scenario.locks["17:race"]?.fixed).toEqual({ HAM: 1 });
    });

    test("Clear empties the session and keeps it locked", () => {
      const ws = send(
        initialWorkspace(state),
        { type: "lock", key: "17:race" },
        { type: "preset", key: "17:race", preset: "contenderWins" },
        { type: "preset", key: "17:race", preset: "clear" },
      );
      expect(ws.scenario.locks["17:race"]).toEqual({ fixed: {} });
    });

    test("only a contender can be the focus", () => {
      const ws = send(initialWorkspace(state), { type: "setFocus", driver: "PIA" });
      expect(ws.focus).toBe("RUS");
    });
  });

  describe("contenders", () => {
    test("adding one that can still win works", () => {
      const ws = send(initialWorkspace(state), { type: "toggleContender", driver: "VER" });
      expect(ws.contenders).toEqual(["ANT", "RUS", "HAM", "LEC", "NOR", "VER"]);
      expect(ws.notice).toBeNull();
    });

    test("an eliminated driver is refused with a message scoped to the contenders", () => {
      const start = initialWorkspace(state);
      const ws = send(start, { type: "toggleContender", driver: "PIA" });
      expect(ws.contenders).toEqual(start.contenders);
      expect(ws.notice).toEqual({
        scope: "contenders",
        message: "PIA can no longer win the title, so they cannot be a contender.",
      });
    });

    test("dropping the focus moves it to the first contender", () => {
      const ws = send(initialWorkspace(state), { type: "toggleContender", driver: "RUS" });
      expect(ws.contenders).toEqual(["ANT", "HAM", "LEC", "NOR"]);
      expect(ws.focus).toBe("ANT");
    });

    test("a driver already placed keeps their position when dropped from the contenders", () => {
      const ws = send(
        initialWorkspace(state),
        { type: "lock", key: "17:race" },
        { type: "assign", key: "17:race", driver: "NOR", position: 2 },
        { type: "toggleContender", driver: "NOR" },
      );
      expect(ws.scenario.locks["17:race"]?.fixed).toEqual({ NOR: 2 });
    });
  });

  describe("loading a ready-made scenario (the easiest path)", () => {
    test("replaces the scenario, keeps the other settings, clears the message", () => {
      const start = send(initialWorkspace(state), { type: "setFocus", driver: "HAM" }, { type: "lock", key: "17:race" });
      const easiest = { locks: { "17:race": { fixed: { RUS: 2 } }, "18:race": { fixed: { RUS: 2 } } } };
      const ws = send(start, { type: "loadScenario", scenario: easiest });
      expect(ws.scenario).toEqual(easiest);
      expect(ws.focus).toBe("HAM");
      expect(ws.notice).toBeNull();
    });

    test("a scenario the engine refuses is not loaded, and the owner is told in plain words", () => {
      const start = send(initialWorkspace(state), { type: "lock", key: "17:race" });
      const ws = send(start, { type: "loadScenario", scenario: { locks: { "1:race": { fixed: { ANT: 1 } } } } });
      expect(ws.scenario).toBe(start.scenario);
      expect(ws.notice).toEqual({ scope: "path", message: "That session already has real results, so it cannot be locked." });
    });
  });

  test("Reset scenario removes every lock but keeps contenders, mode and focus", () => {
    const ws = send(
      initialWorkspace(state),
      { type: "setMode", mode: "all" },
      { type: "setFocus", driver: "HAM" },
      { type: "lock", key: "17:race" },
      { type: "lock", key: "18:race" },
      { type: "reset" },
    );
    expect(ws.scenario).toEqual({ locks: {} });
    expect(ws.mode).toBe("all");
    expect(ws.focus).toBe("HAM");
  });
});
