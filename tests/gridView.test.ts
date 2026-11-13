/**
 * Phase 8, Step 3: the grid source tag, the "OpenF1 has a different grid" notice and the state behind its buttons
 * (web/viewModel/grid.ts). Pure: no DOM, no fetch.
 */
import { describe, expect, test } from "bun:test";
import {
  GRID_NOTICE_STORAGE_KEY,
  GRID_NOTICE_TEXT,
  gridErrorMessage,
  gridNotice,
  gridReducer,
  gridSignature,
  gridTag,
  gridTagFor,
  gridWriteDisabledReason,
  initialGridState,
  parseGridResponse,
  readDismissedGrid,
  writeDismissedGrid,
  type GridInfo,
  type GridNoticeStorage,
} from "../web/viewModel/grid";

const OPEN_F1 = ["BBB", "AAA", "CCC"];

/** A manual grid in use that differs from OpenF1's. */
const differing: GridInfo = {
  round: 3,
  effective: { order: ["AAA", "BBB", "CCC"], pit: [], source: "manual" },
  data: { source: "openf1", order: OPEN_F1 },
  override: { updatedAt: "2026-11-13T10:00:00.000Z", valid: true },
  differs: true,
};
/** What the server answers once the manual grid is removed. */
const cleared: GridInfo = {
  round: 3,
  effective: { order: OPEN_F1, pit: [], source: "openf1" },
  data: { source: "openf1", order: OPEN_F1 },
  override: null,
  differs: false,
};

describe("parseGridResponse", () => {
  test("accepts what the server sends", () => {
    expect(parseGridResponse(true, differing)).toEqual(differing);
    expect(parseGridResponse(true, cleared)).toEqual(cleared);
  });

  test("accepts the answers with nothing in them: no grid yet, no race left", () => {
    const none = { round: 3, effective: null, data: null, override: null, differs: false };
    expect(parseGridResponse(true, none)).toEqual(none);
    const over = { ...none, round: null };
    expect(parseGridResponse(true, over)).toEqual(over);
  });

  test("a failed request or something that is not an object is refused", () => {
    expect(parseGridResponse(false, differing)).toBeNull();
    expect(parseGridResponse(true, null)).toBeNull();
    expect(parseGridResponse(true, "grid")).toBeNull();
    expect(parseGridResponse(true, [])).toBeNull();
  });

  test("a body with a wrong part is refused whole, never half-read", () => {
    expect(parseGridResponse(true, { ...differing, differs: "yes" })).toBeNull();
    expect(parseGridResponse(true, { ...differing, round: "3" })).toBeNull();
    expect(parseGridResponse(true, { ...differing, effective: { order: ["AAA"], pit: [], source: "guess" } })).toBeNull();
    expect(parseGridResponse(true, { ...differing, effective: { order: "AAA", pit: [], source: "manual" } })).toBeNull();
    expect(parseGridResponse(true, { ...differing, effective: { order: ["AAA", 1], pit: [], source: "manual" } })).toBeNull();
    expect(parseGridResponse(true, { ...differing, data: { source: "manual", order: [] } })).toBeNull();
    expect(parseGridResponse(true, { ...differing, override: { updatedAt: 5, valid: true } })).toBeNull();
    expect(parseGridResponse(true, { ...differing, override: { updatedAt: "x" } })).toBeNull();
  });
});

describe("the source tag", () => {
  test("the words of each source", () => {
    expect(gridTag("manual").text).toBe("Grid: manual");
    expect(gridTag("openf1").text).toBe("Grid: OpenF1");
    expect(gridTag("qualifying").text).toBe("Grid: qualifying (may differ from the real grid)");
  });

  test("only a qualifying grid is a warning (yellow with an icon); the others are plain", () => {
    expect(gridTag("qualifying").tone).toBe("warn");
    expect(gridTag("manual").tone).toBe("plain");
    expect(gridTag("openf1").tone).toBe("plain");
  });

  test("the tag follows the grid in use, not the one in the data file", () => {
    expect(gridTagFor(differing)?.text).toBe("Grid: manual");
    expect(gridTagFor(cleared)?.text).toBe("Grid: OpenF1");
    const quali: GridInfo = { ...cleared, effective: { order: OPEN_F1, pit: [], source: "qualifying" }, data: { source: "qualifying", order: OPEN_F1 } };
    expect(gridTagFor(quali)?.tone).toBe("warn");
  });

  test("no grid in use, or not loaded: no tag", () => {
    expect(gridTagFor(null)).toBeNull();
    expect(gridTagFor({ round: 3, effective: null, data: null, override: null, differs: false })).toBeNull();
  });
});

describe("gridSignature", () => {
  test("identifies OpenF1's grid for the next race", () => {
    expect(gridSignature(differing)).toBe("3:openf1:BBB,AAA,CCC");
  });

  test("changes when OpenF1's grid, its source or the race changes", () => {
    const base = gridSignature(differing);
    expect(gridSignature({ ...differing, data: { source: "openf1", order: ["AAA", "BBB", "CCC"] } })).not.toBe(base);
    expect(gridSignature({ ...differing, data: { source: "qualifying", order: OPEN_F1 } })).not.toBe(base);
    expect(gridSignature({ ...differing, round: 4 })).not.toBe(base);
  });

  test("does not depend on the manual grid", () => {
    const other = { ...differing, effective: { order: ["CCC", "BBB", "AAA"], pit: [], source: "manual" as const } };
    expect(gridSignature(other)).toBe(gridSignature(differing));
  });

  test("null when there is nothing to identify", () => {
    expect(gridSignature(null)).toBeNull();
    expect(gridSignature({ ...differing, data: null })).toBeNull();
    expect(gridSignature({ ...differing, round: null })).toBeNull();
  });
});

describe("the notice", () => {
  test("appears when a manual grid differs from OpenF1's, in these words", () => {
    const notice = gridNotice(differing, null);
    expect(notice).toEqual({
      text: "OpenF1 now has the official grid, and it differs from yours.",
      useLabel: "Use OpenF1 grid",
      keepLabel: "Keep mine",
    });
    expect(GRID_NOTICE_TEXT).toBe(notice!.text);
  });

  test("appears only when `differs` is true", () => {
    expect(gridNotice({ ...differing, differs: false }, null)).toBeNull();
    expect(gridNotice(cleared, null)).toBeNull();
    expect(gridNotice(null, null)).toBeNull();
  });

  test("is not shown for a qualifying grid or when there is no official grid: `differs` is false then", () => {
    const quali: GridInfo = { ...differing, data: { source: "qualifying", order: OPEN_F1 }, differs: false };
    expect(gridNotice(quali, null)).toBeNull();
  });

  test("stays away after 'Keep mine' for the same OpenF1 grid, and comes back when that grid changes", () => {
    const dismissed = gridSignature(differing);
    expect(gridNotice(differing, dismissed)).toBeNull();
    const changed: GridInfo = { ...differing, data: { source: "openf1", order: ["CCC", "BBB", "AAA"] } };
    expect(gridNotice(changed, dismissed)).not.toBeNull();
    expect(gridNotice({ ...differing, round: 4 }, dismissed)).not.toBeNull();
  });

  test("an old dismissal never hides it by accident", () => {
    expect(gridNotice(differing, "")).not.toBeNull();
    expect(gridNotice(differing, "garbage")).not.toBeNull();
  });
});

describe("why 'Use OpenF1 grid' may be disabled", () => {
  test("nothing when writing is allowed", () => {
    expect(gridWriteDisabledReason(true, "open")).toBeNull();
  });

  test("a token is needed, or writing is only from this computer", () => {
    expect(gridWriteDisabledReason(false, "needs-token")).toBe("Enter the write token to change the grid.");
    expect(gridWriteDisabledReason(false, "local-only")).toBe("Writing is only allowed from this computer.");
    expect(gridWriteDisabledReason(false, "error")).toBe("Writing is only allowed from this computer.");
  });
});

describe("gridErrorMessage", () => {
  test("plain words for each kind of failure", () => {
    expect(gridErrorMessage(null, null)).toBe("Could not reach the server. Check that it is running.");
    expect(gridErrorMessage(401, null)).toBe("Enter the write token to change the grid.");
    expect(gridErrorMessage(403, { message: "ignored" })).toBe("Writing is only allowed from this computer.");
    expect(gridErrorMessage(409, { error: "no_upcoming_round", message: "There is no race left in this season to set a grid for." })).toBe(
      "There is no race left in this season to set a grid for.",
    );
    expect(gridErrorMessage(500, null)).toBe("The server returned an error (500). Try again.");
    expect(gridErrorMessage(500, { message: "" })).toBe("The server returned an error (500). Try again.");
  });
});

describe("the buttons' effects (gridReducer)", () => {
  const loaded = gridReducer(initialGridState(), { type: "loaded", info: differing });

  test("starts empty and not busy", () => {
    expect(initialGridState()).toEqual({ info: null, dismissed: null, busy: false, error: null });
    expect(initialGridState("x").dismissed).toBe("x");
  });

  test("loading the grid shows the notice", () => {
    expect(gridNotice(loaded.info, loaded.dismissed)).not.toBeNull();
  });

  test("'Keep mine' hides the notice, changes nothing else and sends nothing (the info is untouched)", () => {
    const after = gridReducer(loaded, { type: "keepMine" });
    expect(gridNotice(after.info, after.dismissed)).toBeNull();
    expect(after.info).toBe(loaded.info);
    expect(after.busy).toBe(false);
    expect(after.dismissed).toBe(gridSignature(differing));
  });

  test("'Keep mine' with no OpenF1 grid to identify does nothing", () => {
    const empty = gridReducer(initialGridState(), { type: "keepMine" });
    expect(empty).toEqual(initialGridState());
  });

  test("after 'Keep mine', a different OpenF1 grid shows the notice again", () => {
    const kept = gridReducer(loaded, { type: "keepMine" });
    const later = gridReducer(kept, { type: "loaded", info: { ...differing, data: { source: "openf1", order: ["CCC", "BBB", "AAA"] } } });
    expect(gridNotice(later.info, later.dismissed)).not.toBeNull();
  });

  test("'Use OpenF1 grid' is busy while it runs, and a second press is ignored", () => {
    const running = gridReducer(loaded, { type: "clearStarted" });
    expect(running.busy).toBe(true);
    expect(gridReducer(running, { type: "clearStarted" })).toBe(running);
  });

  test("when the server answers, the OpenF1 grid is in use, the tag says so and the notice is gone", () => {
    const running = gridReducer(loaded, { type: "clearStarted" });
    const done = gridReducer(running, { type: "cleared", info: cleared });
    expect(done.busy).toBe(false);
    expect(done.error).toBeNull();
    expect(done.info).toBe(cleared);
    expect(gridTagFor(done.info)?.text).toBe("Grid: OpenF1");
    expect(gridNotice(done.info, done.dismissed)).toBeNull();
  });

  test("when it fails, the notice stays, the grid in use is unchanged, and the reason is shown", () => {
    const running = gridReducer(loaded, { type: "clearStarted" });
    const failed = gridReducer(running, { type: "clearFailed", message: "Writing is only allowed from this computer." });
    expect(failed.busy).toBe(false);
    expect(failed.error).toBe("Writing is only allowed from this computer.");
    expect(failed.info).toBe(loaded.info);
    expect(gridNotice(failed.info, failed.dismissed)).not.toBeNull();
  });

  test("trying again clears the old error", () => {
    const failed = gridReducer(gridReducer(loaded, { type: "clearStarted" }), { type: "clearFailed", message: "x" });
    expect(gridReducer(failed, { type: "clearStarted" }).error).toBeNull();
  });

  test("if the grid cannot be loaded there is no tag and no notice", () => {
    const none = gridReducer(initialGridState(), { type: "loaded", info: null });
    expect(gridTagFor(none.info)).toBeNull();
    expect(gridNotice(none.info, none.dismissed)).toBeNull();
  });

  test("never modifies the state it was given", () => {
    const before = JSON.stringify(loaded);
    gridReducer(loaded, { type: "keepMine" });
    gridReducer(loaded, { type: "clearStarted" });
    gridReducer(loaded, { type: "cleared", info: cleared });
    gridReducer(loaded, { type: "clearFailed", message: "x" });
    expect(JSON.stringify(loaded)).toBe(before);
  });
});

describe("remembering 'Keep mine'", () => {
  const fake = (initial: Record<string, string> = {}) => {
    const data = { ...initial };
    const storage: GridNoticeStorage = {
      getItem: (key) => data[key] ?? null,
      setItem: (key, value) => {
        data[key] = value;
      },
    };
    return { storage, data };
  };
  const throwing: GridNoticeStorage = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };

  test("what was written is read back, under one key", () => {
    const { storage, data } = fake();
    writeDismissedGrid("3:openf1:BBB,AAA,CCC", storage);
    expect(data).toEqual({ [GRID_NOTICE_STORAGE_KEY]: "3:openf1:BBB,AAA,CCC" });
    expect(readDismissedGrid(storage)).toBe("3:openf1:BBB,AAA,CCC");
  });

  test("nothing stored, an empty value, or no storage: null", () => {
    expect(readDismissedGrid(fake().storage)).toBeNull();
    expect(readDismissedGrid(fake({ [GRID_NOTICE_STORAGE_KEY]: "" }).storage)).toBeNull();
    expect(readDismissedGrid(undefined)).toBeNull();
  });

  test("blocked storage never throws: reading gives null and writing is ignored", () => {
    expect(readDismissedGrid(throwing)).toBeNull();
    expect(() => writeDismissedGrid("x", throwing)).not.toThrow();
    expect(() => writeDismissedGrid("x", undefined)).not.toThrow();
  });

  test("a remembered dismissal starts the state with the notice hidden for that grid", () => {
    const { storage } = fake();
    writeDismissedGrid(gridSignature(differing)!, storage);
    const state = gridReducer(initialGridState(readDismissedGrid(storage)), { type: "loaded", info: differing });
    expect(gridNotice(state.info, state.dismissed)).toBeNull();
  });
});
