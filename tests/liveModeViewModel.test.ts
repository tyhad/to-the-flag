import { describe, expect, test } from "bun:test";
import {
  effectiveWorkspaceForLive,
  liveToggleLabel,
  liveToggleTone,
  parseLiveStateResponse,
} from "../web/viewModel/liveMode";
import type { Workspace } from "../web/viewModel/workspace";

const BASE_WORKSPACE: Workspace = {
  scenario: { locks: { "3:race": { fixed: { AAA: 1 } } } },
  contenders: ["AAA", "BBB"],
  mode: "contenders",
  focus: "AAA",
  team: "alpha",
  notice: null,
};

describe("web/viewModel/liveMode", () => {
  test("parses inactive, active live race, and malformed /api/live/state responses", () => {
    expect(parseLiveStateResponse(false, null)).toBeNull();
    expect(parseLiveStateResponse(true, {})).toBeNull();

    const inactive = parseLiveStateResponse(true, { active: false, updatedAt: null, snapshot: null });
    expect(inactive).not.toBeNull();
    expect(inactive!.active).toBe(false);
    expect(inactive!.scenario).toEqual({ locks: {} });

    const active = parseLiveStateResponse(true, {
      active: true,
      updatedAt: "2026-08-23T14:30:00Z",
      snapshot: {
        round: 17,
        kind: "race",
        liveApplied: true,
        provisional: false,
        lap: 35,
        totalLaps: 57,
        sessionName: "Dutch Grand Prix",
        scenario: {
          locks: {
            "17:race": { fixed: { ANT: 1, NOR: 2, VER: "out" }, tier: "full" },
          },
        },
      },
    });
    expect(active).not.toBeNull();
    expect(active!.active).toBe(true);
    expect(active!.round).toBe(17);
    expect(active!.lap).toBe(35);
    expect(active!.scenario.locks["17:race"]).toEqual({
      fixed: { ANT: 1, NOR: 2, VER: "out" },
      tier: "full",
    });
  });

  test("formats header toggle label and tone cleanly across states", () => {
    expect(liveToggleTone(false, null, false)).toBe("off");
    expect(liveToggleLabel(false, null, false)).toBe("Live");

    expect(liveToggleTone(true, null, false)).toBe("waiting");
    expect(liveToggleLabel(true, null, false)).toBe("Live · Waiting");

    expect(liveToggleTone(true, null, true)).toBe("error");
    expect(liveToggleLabel(true, null, true)).toBe("Live · Offline");

    const liveFeed = parseLiveStateResponse(true, {
      active: true,
      updatedAt: "2026-08-23T14:30:00Z",
      snapshot: {
        round: 17,
        kind: "race",
        liveApplied: true,
        provisional: false,
        lap: 35,
        totalLaps: 57,
        scenario: { locks: { "17:race": { fixed: { ANT: 1 } } } },
      },
    });
    expect(liveToggleTone(true, liveFeed, false)).toBe("active");
    expect(liveToggleLabel(true, liveFeed, false)).toBe("Live · R17 · Lap 35/57");

    const provFeed = parseLiveStateResponse(true, {
      active: true,
      updatedAt: "2026-08-23T15:30:00Z",
      snapshot: {
        round: 17,
        kind: "race",
        liveApplied: true,
        provisional: true,
        lap: 57,
        totalLaps: 57,
        scenario: { locks: { "17:race": { fixed: { ANT: 1 } } } },
      },
    });
    expect(liveToggleLabel(true, provFeed, false)).toBe("Live · Provisional");
  });

  test("overlays live scenario only when enabled + liveApplied without mutating manual workspace", () => {
    const liveFeed = parseLiveStateResponse(true, {
      active: true,
      updatedAt: "2026-08-23T14:30:00Z",
      snapshot: {
        round: 3,
        kind: "race",
        liveApplied: true,
        provisional: false,
        scenario: { locks: { "3:race": { fixed: { BBB: 1 }, tier: "full" } } },
      },
    });

    // Disabled -> preserves user manual workspace
    expect(effectiveWorkspaceForLive(BASE_WORKSPACE, false, liveFeed)).toBe(BASE_WORKSPACE);

    // Enabled + liveApplied -> overlays live scenario without mutating BASE_WORKSPACE
    const overlaid = effectiveWorkspaceForLive(BASE_WORKSPACE, true, liveFeed);
    expect(overlaid.scenario.locks["3:race"]?.fixed).toEqual({ BBB: 1 });
    expect(BASE_WORKSPACE.scenario.locks["3:race"]?.fixed).toEqual({ AAA: 1 });
  });
});
