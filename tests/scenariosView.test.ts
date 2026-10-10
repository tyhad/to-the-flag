/** Phase 2 Step 8: the scenario list view-model (pure). */
import { describe, expect, test } from "bun:test";
import type { Scenario } from "../engine";
import {
  apiErrorMessage,
  buildChips,
  isDirty,
  parseSavedScenario,
  parseScenarioList,
  toScenario,
  validateScenarioName,
  type SavedScenario,
} from "../web/viewModel/scenarios";

const saved = (over: Partial<SavedScenario> = {}): SavedScenario => ({
  id: "s1",
  name: "Norris wins all",
  season: 2026,
  asOfRound: 16,
  locks: { "17:race": { fixed: { NOR: 1 } } },
  contenders: ["ANT", "RUS", "NOR"],
  valid: true,
  stale: false,
  createdAt: "2026-10-01T10:00:00Z",
  updatedAt: "2026-10-01T10:00:00Z",
  ...over,
});

describe("buildChips", () => {
  const a = saved({ id: "a", name: "Alpha" });
  const b = saved({ id: "b", name: "Beta", asOfRound: 14, stale: true });
  const c = saved({ id: "c", name: "Gamma", valid: false });

  test("Base comes first, then saved scenarios in the order given", () => {
    const chips = buildChips(16, [a, b, c], null, null);
    expect(chips.map((x) => x.name)).toEqual(["Base", "Alpha", "Beta", "Gamma"]);
    expect(chips[0]).toMatchObject({ kind: "base", id: null });
    expect(chips[1]).toMatchObject({ kind: "saved", id: "a" });
  });

  test("with nothing selected Base is the selected chip", () => {
    const chips = buildChips(16, [a, b], null, null);
    expect(chips.map((x) => x.selected)).toEqual([true, false, false]);
  });

  test("selecting a saved scenario selects only that chip", () => {
    const chips = buildChips(16, [a, b], "b", null);
    expect(chips.map((x) => x.selected)).toEqual([false, false, true]);
  });

  test("an unknown selected id falls back to Base", () => {
    expect(buildChips(16, [a], "gone", null).map((x) => x.selected)).toEqual([true, false]);
  });

  test("the scenario on the overlay is marked live; Base never is", () => {
    const chips = buildChips(16, [a, b], null, "b");
    expect(chips.map((x) => x.live)).toEqual([false, false, true]);
  });

  test("a stale scenario shows the round it was saved at and explains itself", () => {
    const chip = buildChips(16, [b], null, null)[1]!;
    expect(chip.stale).toBe(true);
    expect(chip.staleLabel).toBe("Round 14");
    expect(chip.valid).toBe(true);
    expect(chip.note).toBe("Saved at Round 14. Data is now at Round 16, so the results may have changed.");
  });

  test("an invalid scenario is kept, marked invalid, and says why it cannot load", () => {
    const chip = buildChips(16, [c], null, null)[1]!;
    expect(chip.valid).toBe(false);
    expect(chip.note).toBe(
      "This scenario no longer fits the current data, for example because a locked session has since run. It is kept so you can rename or delete it.",
    );
  });

  test("a fresh, valid scenario has no label and no note", () => {
    const chip = buildChips(16, [a], null, null)[1]!;
    expect(chip).toMatchObject({ stale: false, staleLabel: null, note: null, valid: true });
  });

  test("Base has no note", () => {
    expect(buildChips(16, [], null, null)[0]?.note).toBeNull();
  });
});

describe("isDirty", () => {
  const s = saved();
  const same: Scenario = { locks: { "17:race": { fixed: { NOR: 1 } } } };

  test("not dirty when the working scenario matches the saved one", () => {
    expect(isDirty(same, ["ANT", "RUS", "NOR"], s)).toBe(false);
  });

  test("dirty when a lock differs", () => {
    expect(isDirty({ locks: { "17:race": { fixed: { NOR: 2 } } } }, ["ANT", "RUS", "NOR"], s)).toBe(true);
    expect(isDirty({ locks: {} }, ["ANT", "RUS", "NOR"], s)).toBe(true);
  });

  test("dirty when the contenders differ", () => {
    expect(isDirty(same, ["ANT", "RUS"], s)).toBe(true);
  });

  test("a scenario saved without contenders is judged on its locks alone", () => {
    expect(isDirty(same, ["ANT"], saved({ contenders: undefined }))).toBe(false);
  });

  test("nothing saved means nothing to be dirty against", () => {
    expect(isDirty(same, [], undefined)).toBe(false);
  });
});

describe("toScenario", () => {
  test("keeps only the locks", () => {
    expect(toScenario(saved())).toEqual({ locks: { "17:race": { fixed: { NOR: 1 } } } });
  });
});

describe("validateScenarioName", () => {
  const others = [saved({ id: "a", name: "Alpha" }), saved({ id: "b", name: "Beta" })];

  test("trims and accepts a good name", () => {
    expect(validateScenarioName("  Title push  ", others)).toEqual({ ok: true, name: "Title push" });
  });

  test("a name is required", () => {
    expect(validateScenarioName("   ", others)).toEqual({ ok: false, message: "Give the scenario a name." });
  });

  test("forty characters at most", () => {
    expect(validateScenarioName("x".repeat(40), others).ok).toBe(true);
    expect(validateScenarioName("x".repeat(41), others)).toEqual({
      ok: false,
      message: "Keep the name to 40 characters or fewer.",
    });
  });

  test("no duplicates, whatever the case; renaming to your own name is fine", () => {
    expect(validateScenarioName("alpha", others)).toEqual({
      ok: false,
      message: 'You already have a scenario called "alpha".',
    });
    expect(validateScenarioName("Alpha", others, "a")).toEqual({ ok: true, name: "Alpha" });
  });

  test("Base is reserved for the real results", () => {
    expect(validateScenarioName("base", others)).toEqual({
      ok: false,
      message: '"base" is the name of the real-results table. Pick another name.',
    });
  });
});

describe("parseSavedScenario and parseScenarioList", () => {
  test("a good record passes through", () => {
    expect(parseSavedScenario(saved())).toEqual(saved());
  });

  test("a list of good records parses", () => {
    expect(parseScenarioList([saved({ id: "a" }), saved({ id: "b" })])?.map((s) => s.id)).toEqual(["a", "b"]);
    expect(parseScenarioList([])).toEqual([]);
  });

  test("anything else is refused instead of crashing the strip", () => {
    expect(parseScenarioList(null)).toBeNull();
    expect(parseScenarioList({})).toBeNull();
    expect(parseScenarioList([{ id: "a" }])).toBeNull();
    expect(parseScenarioList([saved(), "nope"])).toBeNull();
    expect(parseSavedScenario({ ...saved(), locks: "x" })).toBeNull();
    expect(parseSavedScenario({ ...saved(), valid: "yes" })).toBeNull();
  });
});

describe("apiErrorMessage", () => {
  test("no response at all", () => {
    expect(apiErrorMessage(null, null)).toBe("Could not reach the server. Check that it is running.");
  });

  test("a scenario that is gone", () => {
    expect(apiErrorMessage(404, { error: "not_found", message: "Scenario not found" })).toBe(
      "That scenario no longer exists. It may have been deleted somewhere else.",
    );
  });

  test("a missing name, and a scenario the data no longer allows", () => {
    expect(apiErrorMessage(422, { errors: ["Scenario name is required"] })).toBe("Give the scenario a name.");
    expect(apiErrorMessage(422, { errors: ["Locked session 2:race already has results"] })).toBe(
      "The server did not accept that scenario. It may no longer fit the current data.",
    );
  });

  test("the server's own plain message is kept, for example when the data file is missing", () => {
    expect(apiErrorMessage(503, { error: "data_unavailable", message: "The season data file is missing." })).toBe(
      "The season data file is missing.",
    );
  });

  test("anything else names the status and says to try again", () => {
    expect(apiErrorMessage(500, null)).toBe("The server returned an error (500). Try again.");
  });
});
