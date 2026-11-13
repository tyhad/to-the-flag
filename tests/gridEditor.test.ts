/**
 * Phase 8, Step 4: the grid editor's rows, quick corrections, paste and buttons (web/viewModel/gridEditor.ts). Pure.
 * Field: AAA BBB (red), CCC DDD (blue), EEE FFF (green) race; GGG is in the standings but is not racing. Round 3 is next.
 */
import { describe, expect, test } from "bun:test";
import { gridProblems, parseGridText } from "../engine/grid";
import type { SeasonState } from "../engine/types";
import type { GridInfo } from "../web/viewModel/grid";
import {
  DROP_CHOICES,
  applyEditorMessage,
  buildEditorRows,
  dataGridAvailability,
  emptyGridMessage,
  gridToText,
  initialEditorState,
  invalidOverrideNote,
  isDirty,
  menuMessage,
  prefillEditor,
  raceLabel,
  saveAvailability,
  type AccessContext,
  type EditorGrid,
  type EditorMessage,
  type EditorState,
} from "../web/viewModel/gridEditor";
import { makeState } from "./helpers";

const six = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"];

const base: SeasonState = makeState({
  rounds: 4,
  completed: 2,
  teams: { red: ["AAA", "BBB"], blue: ["CCC", "DDD"], green: ["EEE", "FFF", "GGG"] },
  results: { "1:race": [...six, "GGG"], "2:race": six },
});
const season: SeasonState = { ...base, rounds: base.rounds.map((r) => (r.round === 3 ? { ...r, name: "Test Grand Prix" } : r)) };

const info = (order: string[], pit: string[] = [], source: "manual" | "openf1" | "qualifying" = "openf1"): GridInfo => ({
  round: 3,
  effective: { order, pit, source },
  data: source === "manual" ? null : { source, order: [...order, ...pit] },
  override: source === "manual" ? { updatedAt: "x", valid: true } : null,
  differs: false,
});

const grid = (order: string[], pit: string[] = []): EditorGrid => ({ order, pit });
const start = (order = six, pit: string[] = []): EditorState => initialEditorState(grid(order, pit));
const run = (ed: EditorState, ...messages: EditorMessage[]) => messages.reduce((s, m) => applyEditorMessage(season, s, m), ed);
const canWrite: AccessContext = { canWrite: true, verdict: "open", busy: false };

describe("prefillEditor", () => {
  test("starts from the grid in use", () => {
    expect(prefillEditor(season, info(six))).toEqual({ grid: grid(six), notes: [] });
  });

  test("keeps a manual grid's pit-lane starters apart", () => {
    const pre = prefillEditor(season, info(["AAA", "BBB", "CCC", "DDD", "EEE"], ["FFF"], "manual"));
    expect(pre).toEqual({ grid: grid(["AAA", "BBB", "CCC", "DDD", "EEE"], ["FFF"]), notes: [] });
  });

  test("no grid known, or nothing loaded: nothing to edit", () => {
    expect(prefillEditor(season, null)).toBeNull();
    expect(prefillEditor(season, { round: 3, effective: null, data: null, override: null, differs: false })).toBeNull();
  });

  test("a racing driver the grid does not have is added at the back, and it is said", () => {
    const pre = prefillEditor(season, info(["AAA", "BBB", "CCC", "DDD", "EEE"]))!;
    expect(pre.grid.order).toEqual(["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"]);
    expect(pre.notes).toEqual(["FFF was not in the grid and was added at the back. Check the order."]);
  });

  test("several missing drivers", () => {
    const pre = prefillEditor(season, info(["AAA", "BBB", "CCC", "DDD"]))!;
    expect(pre.grid.order).toEqual(["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"]);
    expect(pre.notes).toEqual(["EEE, FFF were not in the grid and were added at the back. Check the order."]);
  });

  test("missing drivers go before the pit-lane starters, which stay last", () => {
    const pre = prefillEditor(season, info(["AAA", "BBB", "CCC"], ["DDD"], "manual"))!;
    expect(pre.grid).toEqual(grid(["AAA", "BBB", "CCC", "EEE", "FFF"], ["DDD"]));
  });

  test("a code that is not racing is left out, and it is said", () => {
    const pre = prefillEditor(season, info([...six, "GGG"]))!;
    expect(pre.grid.order).toEqual(six);
    expect(pre.notes).toEqual(["GGG is not racing and was left out."]);
  });

  test("both notes", () => {
    const pre = prefillEditor(season, info(["AAA", "GGG", "ZZZ", "BBB", "CCC", "DDD", "EEE"]))!;
    expect(pre.notes).toEqual(["FFF was not in the grid and was added at the back. Check the order.", "GGG, ZZZ are not racing and were left out."]);
  });

  test("the result is always a grid the engine accepts", () => {
    for (const input of [info(six), info(["AAA"]), info([...six, "GGG", "ZZZ"]), info(["AAA", "BBB"], ["CCC"], "manual")]) {
      const pre = prefillEditor(season, input)!;
      expect(gridProblems(season, pre.grid.order, pre.grid.pit)).toEqual([]);
    }
  });

  test("does not modify what it is given", () => {
    const input = info(["AAA", "GGG"], ["BBB"], "manual");
    const before = JSON.stringify(input);
    prefillEditor(season, input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("what to show instead of the editor", () => {
  const ready = (i: GridInfo | null) => ({ status: "ready" as const, info: i });

  test("loading, failed, season over, before qualifying", () => {
    expect(emptyGridMessage({ status: "loading", info: null })?.title).toBe("Loading the grid…");
    expect(emptyGridMessage({ status: "error", info: null })).toEqual({ title: "The grid could not be loaded", text: "Reload the page to try again." });
    expect(emptyGridMessage(ready({ round: null, effective: null, data: null, override: null, differs: false }))?.title).toBe("No race left");
    expect(emptyGridMessage(ready({ round: 3, effective: null, data: null, override: null, differs: false }))?.title).toBe(
      "The grid is known after qualifying.",
    );
  });

  test("none when there is a grid to edit", () => {
    expect(emptyGridMessage(ready(info(six)))).toBeNull();
  });
});

describe("small texts", () => {
  test("raceLabel names the race when it can", () => {
    expect(raceLabel(season, 3)).toBe("Round 3 · Test Grand Prix");
    expect(raceLabel(season, 99)).toBe("Round 99");
  });

  test("a saved grid that no longer fits is explained; a good or absent one is not", () => {
    const bad = { ...info(six), override: { updatedAt: "x", valid: false } };
    expect(invalidOverrideNote(bad)).toContain("no longer fits the drivers");
    expect(invalidOverrideNote(info(six, [], "manual"))).toBeNull();
    expect(invalidOverrideNote(info(six))).toBeNull();
    expect(invalidOverrideNote(null)).toBeNull();
  });
});

describe("buildEditorRows", () => {
  test("one row per driver, in start order, with name and team", () => {
    const rows = buildEditorRows(season, grid(["BBB", "AAA", "CCC", "DDD", "EEE", "FFF"]));
    expect(rows.map((r) => r.code)).toEqual(["BBB", "AAA", "CCC", "DDD", "EEE", "FFF"]);
    expect(rows.map((r) => r.place)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(rows[0]).toMatchObject({ code: "BBB", name: season.drivers.find((d) => d.code === "BBB")!.name, teamId: "red", pit: false });
    expect(rows[2]!.teamId).toBe("blue");
  });

  test("pit-lane starters come after the grid, keep counting, and are marked", () => {
    const rows = buildEditorRows(season, grid(["AAA", "BBB", "CCC", "DDD"], ["FFF", "EEE"]));
    expect(rows.map((r) => [r.code, r.place, r.pit])).toEqual([
      ["AAA", 1, false],
      ["BBB", 2, false],
      ["CCC", 3, false],
      ["DDD", 4, false],
      ["FFF", 5, true],
      ["EEE", 6, true],
    ]);
  });

  test("a driver nobody knows is shown by code, with no team", () => {
    const [row] = buildEditorRows(season, grid(["ZZZ"]));
    expect(row).toMatchObject({ code: "ZZZ", name: "ZZZ", teamId: "" });
  });

  test("Up is off for pole; Down is off for the last place of the grid", () => {
    const rows = buildEditorRows(season, grid(six));
    expect([rows[0]!.canUp, rows[0]!.canDown]).toEqual([false, true]);
    expect([rows[2]!.canUp, rows[2]!.canDown]).toEqual([true, true]);
    expect([rows[5]!.canUp, rows[5]!.canDown]).toEqual([true, false]);
  });

  test("a pit-lane starter can always go up (the first one joins the grid); down only within the pit lane", () => {
    const rows = buildEditorRows(season, grid(["AAA", "BBB", "CCC", "DDD"], ["EEE", "FFF"]));
    expect([rows[4]!.canUp, rows[4]!.canDown]).toEqual([true, true]);
    expect([rows[5]!.canUp, rows[5]!.canDown]).toEqual([true, false]);
  });

  test("a grid driver's menu: Drop N places, Back of the grid, Pit-lane start", () => {
    const menu = buildEditorRows(season, grid(six))[0]!.menu;
    expect(menu.map((m) => m.label)).toEqual([
      "Drop 1 place",
      "Drop 2 places",
      "Drop 3 places",
      "Drop 5 places",
      "Drop 10 places",
      "Back of the grid",
      "Pit-lane start",
    ]);
    expect(menu.every((m) => !m.disabled)).toBe(true);
    expect(DROP_CHOICES).toEqual([1, 2, 3, 5, 10]);
  });

  test("the last driver of the grid cannot drop or go to the back, but can start from the pit lane", () => {
    const menu = buildEditorRows(season, grid(six))[5]!.menu;
    for (const item of menu) expect(item.disabled).toBe(item.id !== "pit");
  });

  test("a pit-lane starter's menu has one item: start from the grid", () => {
    const row = buildEditorRows(season, grid(["AAA", "BBB", "CCC", "DDD", "EEE"], ["FFF"]))[5]!;
    expect(row.menu).toEqual([{ id: "unpit", label: "Start from the grid", disabled: false }]);
  });

  test("menuMessage maps each item to its correction", () => {
    expect(menuMessage("AAA", "drop-3")).toEqual({ type: "drop", code: "AAA", n: 3 });
    expect(menuMessage("AAA", "drop-10")).toEqual({ type: "drop", code: "AAA", n: 10 });
    expect(menuMessage("AAA", "back")).toEqual({ type: "back", code: "AAA" });
    expect(menuMessage("AAA", "pit")).toEqual({ type: "pit", code: "AAA" });
    expect(menuMessage("AAA", "unpit")).toEqual({ type: "unpit", code: "AAA" });
  });
});

describe("quick corrections", () => {
  test("Up and Down swap neighbours", () => {
    expect(run(start(), { type: "up", code: "CCC" }).grid.order).toEqual(["AAA", "CCC", "BBB", "DDD", "EEE", "FFF"]);
    expect(run(start(), { type: "down", code: "CCC" }).grid.order).toEqual(["AAA", "BBB", "DDD", "CCC", "EEE", "FFF"]);
  });

  test("Up on pole and Down on the last place do nothing", () => {
    const ed = start();
    expect(run(ed, { type: "up", code: "AAA" })).toBe(ed);
    expect(run(ed, { type: "down", code: "FFF" })).toBe(ed);
  });

  test("Drop N places moves the driver back N and the drivers passed up one", () => {
    expect(run(start(), { type: "drop", code: "BBB", n: 2 }).grid.order).toEqual(["AAA", "CCC", "DDD", "BBB", "EEE", "FFF"]);
  });

  test("a drop past the end stops at the back", () => {
    expect(run(start(), { type: "drop", code: "DDD", n: 10 }).grid.order).toEqual(["AAA", "BBB", "CCC", "EEE", "FFF", "DDD"]);
  });

  test("Back of the grid", () => {
    expect(run(start(), { type: "back", code: "AAA" }).grid.order).toEqual(["BBB", "CCC", "DDD", "EEE", "FFF", "AAA"]);
  });

  test("Pit-lane start takes the driver out of the grid and puts them in the pit lane", () => {
    const ed = run(start(), { type: "pit", code: "BBB" });
    expect(ed.grid).toEqual(grid(["AAA", "CCC", "DDD", "EEE", "FFF"], ["BBB"]));
  });

  test("pit-lane starters are in the order they were marked, and can be reordered", () => {
    const marked = run(start(), { type: "pit", code: "BBB" }, { type: "pit", code: "AAA" });
    expect(marked.grid.pit).toEqual(["BBB", "AAA"]);
    expect(run(marked, { type: "up", code: "AAA" }).grid.pit).toEqual(["AAA", "BBB"]);
    expect(run(marked, { type: "down", code: "BBB" }).grid.pit).toEqual(["AAA", "BBB"]);
  });

  test("Up on the first pit-lane starter puts them at the end of the grid", () => {
    const ed = run(start(), { type: "pit", code: "BBB" }, { type: "up", code: "BBB" });
    expect(ed.grid).toEqual(grid(["AAA", "CCC", "DDD", "EEE", "FFF", "BBB"], []));
  });

  test("Start from the grid puts a pit-lane starter on the last place of the grid", () => {
    const ed = run(start(), { type: "pit", code: "BBB" }, { type: "unpit", code: "BBB" });
    expect(ed.grid.order).toEqual(["AAA", "CCC", "DDD", "EEE", "FFF", "BBB"]);
    expect(ed.grid.pit).toEqual([]);
  });

  test("a pit-lane starter cannot drop or go to the back (they are already behind everyone)", () => {
    const ed = run(start(), { type: "pit", code: "BBB" });
    expect(run(ed, { type: "drop", code: "BBB", n: 2 })).toBe(ed);
    expect(run(ed, { type: "back", code: "BBB" })).toBe(ed);
    expect(run(ed, { type: "pit", code: "BBB" })).toBe(ed);
  });

  test("a driver who is not in the grid, or a bad N, is ignored", () => {
    const ed = start();
    for (const m of [
      { type: "up", code: "ZZZ" },
      { type: "down", code: "ZZZ" },
      { type: "drop", code: "ZZZ", n: 1 },
      { type: "drop", code: "AAA", n: -1 },
      { type: "drop", code: "AAA", n: 1.5 },
      { type: "back", code: "ZZZ" },
      { type: "pit", code: "ZZZ" },
      { type: "unpit", code: "AAA" },
    ] satisfies EditorMessage[]) {
      expect(run(ed, m)).toBe(ed);
    }
  });

  test("every correction keeps every driver exactly once, so the grid stays valid", () => {
    let ed = start();
    const moves: EditorMessage[] = [
      { type: "drop", code: "AAA", n: 3 },
      { type: "pit", code: "CCC" },
      { type: "up", code: "CCC" },
      { type: "back", code: "BBB" },
      { type: "pit", code: "EEE" },
      { type: "pit", code: "FFF" },
      { type: "down", code: "EEE" },
      { type: "unpit", code: "FFF" },
    ];
    for (const m of moves) {
      ed = run(ed, m);
      expect(gridProblems(season, ed.grid.order, ed.grid.pit)).toEqual([]);
    }
  });

  test("never modifies the state or the lists it was given", () => {
    const ed = start();
    const before = JSON.stringify(ed);
    run(ed, { type: "up", code: "CCC" }, { type: "pit", code: "AAA" });
    run(ed, { type: "drop", code: "AAA", n: 2 });
    expect(JSON.stringify(ed)).toBe(before);
  });
});

describe("changes against the saved grid", () => {
  test("a fresh editor is not dirty; a move is; moving back is not", () => {
    const ed = start();
    expect(isDirty(ed)).toBe(false);
    const moved = run(ed, { type: "down", code: "AAA" });
    expect(isDirty(moved)).toBe(true);
    expect(isDirty(run(moved, { type: "up", code: "AAA" }))).toBe(false);
  });

  test("marking a pit-lane starter is a change even if the places are the same", () => {
    expect(isDirty(run(start(), { type: "pit", code: "FFF" }))).toBe(true);
  });

  test("reset starts again from the server's grid", () => {
    const moved = run(start(), { type: "back", code: "AAA" });
    const again = run(moved, { type: "reset", grid: grid(["CCC", "BBB", "AAA", "DDD", "EEE", "FFF"]) });
    expect(again.grid.order[0]).toBe("CCC");
    expect(isDirty(again)).toBe(false);
    expect(again.pasteOpen).toBe(false);
  });
});

describe("paste a list", () => {
  test("the text box starts with the current grid, in a form that reads back the same", () => {
    const ed = run(start(), { type: "pit", code: "FFF" }, { type: "openPaste" });
    expect(ed.pasteOpen).toBe(true);
    expect(ed.pasteText).toBe("1 AAA\n2 BBB\n3 CCC\n4 DDD\n5 EEE\nPIT:\n6 FFF");
    const parsed = parseGridText(ed.pasteText, season);
    expect(parsed).toEqual({ order: ["AAA", "BBB", "CCC", "DDD", "EEE"], pit: ["FFF"], errors: [] });
    expect(gridToText(grid(six))).toBe("1 AAA\n2 BBB\n3 CCC\n4 DDD\n5 EEE\n6 FFF");
  });

  test("a good list replaces the grid and closes the box", () => {
    const ed = run(start(), { type: "openPaste" }, { type: "pasteText", text: "fff eee\nddd, ccc; bbb\nPIT: aaa" }, { type: "applyPaste" });
    expect(ed.grid).toEqual(grid(["FFF", "EEE", "DDD", "CCC", "BBB"], ["AAA"]));
    expect(ed.pasteOpen).toBe(false);
    expect(ed.pasteErrors).toEqual([]);
    expect(isDirty(ed)).toBe(true);
  });

  test("a list with something unreadable changes nothing and says what", () => {
    const ed = run(start(), { type: "openPaste" }, { type: "pasteText", text: "AAA Antonelli BBB CCC DDD EEE FFF" }, { type: "applyPaste" });
    expect(ed.grid).toEqual(grid(six));
    expect(ed.pasteOpen).toBe(true);
    expect(ed.pasteErrors).toEqual(['Could not read "Antonelli".']);
  });

  test("a list that is readable but not a full grid says who is missing, repeated or not racing", () => {
    const missing = run(start(), { type: "pasteText", text: "AAA BBB CCC" }, { type: "applyPaste" });
    expect(missing.pasteErrors).toEqual(["Missing from the grid: DDD, EEE, FFF."]);
    expect(missing.grid).toEqual(grid(six));

    const twice = run(start(), { type: "pasteText", text: "AAA AAA BBB CCC DDD EEE FFF" }, { type: "applyPaste" });
    expect(twice.pasteErrors).toEqual(["AAA is listed 2 times."]);

    const notRacing = run(start(), { type: "pasteText", text: "AAA BBB CCC DDD EEE FFF GGG" }, { type: "applyPaste" });
    expect(notRacing.pasteErrors).toEqual(["GGG is not racing, so it cannot be on the grid."]);
  });

  test("a code that is not a driver at all is reported once, by the reader", () => {
    const ed = run(start(), { type: "pasteText", text: "AAA BBB CCC DDD EEE FFF ZZZ" }, { type: "applyPaste" });
    expect(ed.pasteErrors).toEqual(["ZZZ is not a driver code in this season."]);
  });

  test("an empty box says so", () => {
    expect(run(start(), { type: "pasteText", text: "  " }, { type: "applyPaste" }).pasteErrors).toEqual(["The list is empty."]);
  });

  test("editing the text clears the old errors; closing the box clears everything", () => {
    const failed = run(start(), { type: "pasteText", text: "AAA" }, { type: "applyPaste" });
    expect(failed.pasteErrors.length).toBeGreaterThan(0);
    expect(run(failed, { type: "pasteText", text: "AAA B" }).pasteErrors).toEqual([]);
    const closed = run(failed, { type: "closePaste" });
    expect(closed).toMatchObject({ pasteOpen: false, pasteText: "", pasteErrors: [] });
  });

  test("a quick correction while errors are shown clears them", () => {
    const failed = run(start(), { type: "pasteText", text: "AAA" }, { type: "applyPaste" });
    expect(run(failed, { type: "down", code: "AAA" }).pasteErrors).toEqual([]);
  });
});

describe("Save grid", () => {
  test("is on when writing is allowed, the grid is valid and something changed", () => {
    const ed = run(start(), { type: "down", code: "AAA" });
    expect(saveAvailability(season, ed, canWrite)).toEqual({ enabled: true, reason: null });
  });

  test("is off, with the reason, when nothing changed", () => {
    expect(saveAvailability(season, start(), canWrite)).toEqual({ enabled: false, reason: "Change the grid first." });
  });

  test("is off, with the reason, when read-only", () => {
    const ed = run(start(), { type: "down", code: "AAA" });
    expect(saveAvailability(season, ed, { canWrite: false, verdict: "needs-token", busy: false })).toEqual({
      enabled: false,
      reason: "Enter the write token to change the grid.",
    });
    expect(saveAvailability(season, ed, { canWrite: false, verdict: "local-only", busy: false }).reason).toBe(
      "Writing is only allowed from this computer.",
    );
  });

  test("read-only is said first, even when nothing changed", () => {
    expect(saveAvailability(season, start(), { canWrite: false, verdict: "needs-token", busy: false }).reason).toBe(
      "Enter the write token to change the grid.",
    );
  });

  test("is off while a request runs, without a reason", () => {
    const ed = run(start(), { type: "down", code: "AAA" });
    expect(saveAvailability(season, ed, { ...canWrite, busy: true })).toEqual({ enabled: false, reason: null });
  });

  test("is off, with the engine's sentence, when the grid is not valid", () => {
    const broken: EditorState = { ...start(), grid: grid(["AAA", "BBB", "AAA", "DDD", "EEE", "FFF"]) };
    const result = saveAvailability(season, broken, canWrite);
    expect(result.enabled).toBe(false);
    expect(result.reason).toBe("AAA is listed 2 times. Missing from the grid: CCC.");
  });
});

describe("Use data grid", () => {
  test("is on when a manual grid is saved and writing is allowed", () => {
    expect(dataGridAvailability(info(six, [], "manual"), canWrite)).toEqual({ enabled: true, reason: null });
  });

  test("a saved grid that no longer fits can still be removed", () => {
    const bad = { ...info(six), override: { updatedAt: "x", valid: false } };
    expect(dataGridAvailability(bad, canWrite).enabled).toBe(true);
  });

  test("is off, with the reason, when no manual grid is saved or nothing is loaded", () => {
    expect(dataGridAvailability(info(six), canWrite)).toEqual({ enabled: false, reason: "No manual grid is saved." });
    expect(dataGridAvailability(null, canWrite)).toEqual({ enabled: false, reason: "No manual grid is saved." });
  });

  test("is off, with the reason, when read-only", () => {
    expect(dataGridAvailability(info(six, [], "manual"), { canWrite: false, verdict: "needs-token", busy: false }).reason).toBe(
      "Enter the write token to change the grid.",
    );
  });

  test("is off while a request runs", () => {
    expect(dataGridAvailability(info(six, [], "manual"), { ...canWrite, busy: true })).toEqual({ enabled: false, reason: null });
  });
});
