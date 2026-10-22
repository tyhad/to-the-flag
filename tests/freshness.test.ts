import { describe, expect, test } from "bun:test";
import { decideFreshness, isNewerData } from "../web/viewModel/freshness";

describe("web/viewModel/freshness", () => {
  const baseline = {
    asOfRound: 16,
    checkedAt: "2026-10-20T12:00:00Z",
  };

  test("same data gives no notice", () => {
    const latest = {
      asOfRound: 16,
      checkedAt: "2026-10-20T12:00:00Z",
    };

    const res = decideFreshness(baseline, latest, false);
    expect(res.status).toBe("none");
    expect(res.message).toBeNull();
  });

  test("a newer round gives the notice with the right copy", () => {
    const latest = {
      asOfRound: 17,
      checkedAt: "2026-10-27T14:00:00Z",
    };

    const res = decideFreshness(baseline, latest, false);
    expect(res.status).toBe("new-data");
    expect(res.message).toBe("New data from Round 17 is ready.");
    expect(res.newRound).toBe(17);
  });

  test("a newer checkedAt with the same round gives the notice", () => {
    const latest = {
      asOfRound: 16,
      checkedAt: "2026-10-20T15:30:00Z",
    };

    const res = decideFreshness(baseline, latest, false);
    expect(res.status).toBe("new-data");
    expect(res.message).toBe("New data from Round 16 is ready.");
    expect(res.newRound).toBe(16);
  });

  test("the editing case: waits until the picker is closed", () => {
    const latest = {
      asOfRound: 17,
      checkedAt: "2026-10-27T14:00:00Z",
    };

    // While editing, notice is suppressed
    const editingRes = decideFreshness(baseline, latest, true);
    expect(editingRes.status).toBe("none");
    expect(editingRes.message).toBeNull();

    // Once editing is finished (isEditing = false), notice appears
    const closedRes = decideFreshness(baseline, latest, false);
    expect(closedRes.status).toBe("new-data");
    expect(closedRes.message).toBe("New data from Round 17 is ready.");
  });

  test("failed poll or missing latest data gives no notice", () => {
    expect(decideFreshness(baseline, null, false).status).toBe("none");
    expect(decideFreshness(baseline, undefined, false).status).toBe("none");
  });

  test("older data gives no notice", () => {
    const olderRound = { asOfRound: 15, checkedAt: "2026-10-10T12:00:00Z" };
    expect(decideFreshness(baseline, olderRound, false).status).toBe("none");

    const olderTime = { asOfRound: 16, checkedAt: "2026-10-20T11:00:00Z" };
    expect(decideFreshness(baseline, olderTime, false).status).toBe("none");
  });
});
