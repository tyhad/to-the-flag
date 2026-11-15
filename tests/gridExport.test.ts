/**
 * Phase 8, Step 7: the export data of the starting grid (web/viewModel/gridExport.ts). Pure.
 * Field: AAA BBB (red), CCC DDD (blue), EEE FFF (green) race; round 3 is next.
 */
import { describe, expect, test } from "bun:test";
import { buildGridRows } from "../api/gridFeed";
import type { SeasonState } from "../engine/types";
import {
  CSV_COLUMNS,
  buildGridCardView,
  buildGridExportRows,
  FULL_DATA_NOTE,
  UNSAVED_EXPORT_NOTE,
  copyMessage,
  csvField,
  exportNote,
  formatGridRange,
  gridExportFilename,
  gridToCsv,
  gridToJson,
  resolveGridRange,
  type ExportGrid,
} from "../web/viewModel/gridExport";
import { makeState } from "./helpers";

const six = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"];
const base: SeasonState = makeState({
  rounds: 4,
  completed: 2,
  teams: { red: ["AAA", "BBB"], blue: ["CCC", "DDD"], green: ["EEE", "FFF"] },
  results: { "1:race": six, "2:race": six },
});
const named = (names: Record<string, string>, extra: Partial<SeasonState> = {}): SeasonState => ({
  ...base,
  ...extra,
  drivers: base.drivers.map((d) => ({ ...d, name: names[d.code] ?? d.name })),
});
const season = named({ AAA: "Ada Alpha", BBB: 'Bo "Bee" Beta', CCC: "Cy, Gamma", DDD: " Dee Delta " });
const manual: ExportGrid = { order: ["BBB", "AAA", "CCC", "DDD", "EEE"], pit: ["FFF"], source: "manual" };

describe("buildGridExportRows", () => {
  test("pole first: the grid, then the pit-lane starters, places 1..N", () => {
    const rows = buildGridExportRows(season, manual);
    expect(rows.map((r) => [r.position, r.driver, r.pit])).toEqual([
      [1, "BBB", false],
      [2, "AAA", false],
      [3, "CCC", false],
      [4, "DDD", false],
      [5, "EEE", false],
      [6, "FFF", true],
    ]);
  });

  test("each row has the name, the team and the source", () => {
    const [first] = buildGridExportRows(season, manual);
    expect(first).toEqual({ position: 1, driver: "BBB", name: 'Bo "Bee" Beta', team: "red", pit: false, source: "manual" });
  });

  test("a driver nobody knows has the code as the name and no team", () => {
    const [row] = buildGridExportRows(season, { order: ["ZZZ"], pit: [], source: "openf1" });
    expect(row).toMatchObject({ driver: "ZZZ", name: "ZZZ", team: "" });
  });

  test("is exactly what the overlay feed gives (api/gridFeed.ts), so the two never disagree", () => {
    for (const grid of [manual, { order: six, pit: [], source: "openf1" as const }, { order: six, pit: [], source: "qualifying" as const }]) {
      expect(buildGridExportRows(season, grid)).toEqual(buildGridRows(season, grid));
    }
  });

  test("does not modify what it is given", () => {
    const grid: ExportGrid = { order: [...manual.order], pit: [...manual.pit], source: "manual" };
    const before = JSON.stringify([season, grid]);
    buildGridExportRows(season, grid);
    expect(JSON.stringify([season, grid])).toBe(before);
  });
});

describe("CSV", () => {
  test("the header is position,driver,name,team,pit,source", () => {
    expect(CSV_COLUMNS.join(",")).toBe("position,driver,name,team,pit,source");
    expect(gridToCsv([]).split("\n")).toEqual(["position,driver,name,team,pit,source"]);
  });

  test("one line per row, in grid order", () => {
    const lines = gridToCsv(buildGridExportRows(named({ AAA: "Ada Alpha", BBB: "Bo Beta" }), manual)).split("\n");
    expect(lines).toHaveLength(7);
    expect(lines[1]).toBe("1,BBB,Bo Beta,red,false,manual");
    expect(lines[2]).toBe("2,AAA,Ada Alpha,red,false,manual");
    expect(lines[6]).toBe("6,FFF,FFF,green,true,manual");
  });

  test("a field is quoted when it has a comma, a quote, a line break, or blanks at the ends; quotes are doubled", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField("Cy, Gamma")).toBe('"Cy, Gamma"');
    expect(csvField('Bo "Bee" Beta')).toBe('"Bo ""Bee"" Beta"');
    expect(csvField("two\nlines")).toBe('"two\nlines"');
    expect(csvField(" padded ")).toBe('" padded "');
    expect(csvField(7)).toBe("7");
    expect(csvField(true)).toBe("true");
    expect(csvField("")).toBe("");
  });

  test("the quoted names come out right in the whole file", () => {
    const csv = gridToCsv(buildGridExportRows(season, { order: ["BBB", "CCC", "DDD"], pit: [], source: "openf1" }));
    expect(csv.split("\n").slice(1)).toEqual(['1,BBB,"Bo ""Bee"" Beta",red,false,openf1', '2,CCC,"Cy, Gamma",blue,false,openf1', '3,DDD," Dee Delta ",blue,false,openf1']);
  });

  test("a spreadsheet would read it back the same: split with a small CSV reader", () => {
    const rows = buildGridExportRows(season, manual);
    const parsed = parseCsv(gridToCsv(rows));
    expect(parsed[0]).toEqual([...CSV_COLUMNS]);
    parsed.slice(1).forEach((cells, i) => {
      const r = rows[i]!;
      expect(cells).toEqual([String(r.position), r.driver, r.name, r.team, String(r.pit), r.source]);
    });
  });
});

describe("JSON", () => {
  test("parses back to the same rows", () => {
    const rows = buildGridExportRows(season, manual);
    expect(JSON.parse(gridToJson(rows))).toEqual(rows);
  });

  test("is an indented array, and an empty grid is an empty array", () => {
    expect(gridToJson(buildGridExportRows(season, manual))).toContain('\n  {\n    "position": 1,');
    expect(JSON.parse(gridToJson([]))).toEqual([]);
  });

  test("has nothing but the six fields in each row (no token, path or note can slip in)", () => {
    for (const row of JSON.parse(gridToJson(buildGridExportRows(season, manual)))) {
      expect(Object.keys(row).sort()).toEqual([...CSV_COLUMNS].sort());
    }
  });
});

describe("resolveGridRange", () => {
  const none = { from: 1, to: 1 };

  test("All, and any choice that already covers the whole grid, is no range", () => {
    expect(resolveGridRange("all", none, 22)).toEqual({ range: null, problem: null });
    expect(resolveGridRange("10", none, 8)).toEqual({ range: null, problem: null });
    expect(resolveGridRange("12", none, 12)).toEqual({ range: null, problem: null });
    expect(resolveGridRange("custom", { from: 1, to: 22 }, 22)).toEqual({ range: null, problem: null });
  });

  test("Top 10 and Top 12 are P1 to P10 and P1 to P12", () => {
    expect(resolveGridRange("10", none, 22).range).toEqual({ from: 1, to: 10 });
    expect(resolveGridRange("12", none, 22).range).toEqual({ from: 1, to: 12 });
  });

  test("a custom range is used as typed", () => {
    expect(resolveGridRange("custom", { from: 6, to: 15 }, 22)).toEqual({ range: { from: 6, to: 15 }, problem: null });
    expect(resolveGridRange("custom", { from: 3, to: 3 }, 22).range).toEqual({ from: 3, to: 3 });
  });

  test("a custom range is made sensible: not before P1, not backwards, not past the last place", () => {
    expect(resolveGridRange("custom", { from: 0, to: 5 }, 22).range).toEqual({ from: 1, to: 5 });
    expect(resolveGridRange("custom", { from: -3, to: 5 }, 22).range).toEqual({ from: 1, to: 5 });
    expect(resolveGridRange("custom", { from: 8, to: 4 }, 22).range).toEqual({ from: 8, to: 8 });
    expect(resolveGridRange("custom", { from: 15, to: 40 }, 22).range).toEqual({ from: 15, to: 22 });
    expect(resolveGridRange("custom", { from: 2.9, to: 5.2 }, 22).range).toEqual({ from: 2, to: 5 });
  });

  test("numbers that are not numbers fall back to something that works", () => {
    expect(resolveGridRange("custom", { from: NaN, to: NaN }, 22).range).toEqual({ from: 1, to: 1 });
    expect(resolveGridRange("custom", { from: 4, to: NaN }, 22).range).toEqual({ from: 4, to: 4 });
  });

  test("a range that starts after the last place says so and shows nothing", () => {
    expect(resolveGridRange("custom", { from: 23, to: 30 }, 22)).toEqual({ range: null, problem: "The grid has only 22 places." });
  });

  test("a grid with no places has a problem too", () => {
    expect(resolveGridRange("all", none, 0).problem).toBe("There are no places to export.");
  });

  test("P-numbers in plain words", () => {
    expect(formatGridRange({ from: 6, to: 15 })).toBe("P6–P15");
  });
});

describe("file names", () => {
  test("the picture: size, season, round, and the places when it is a part of the grid", () => {
    expect(gridExportFilename("png", { season: 2026, round: 17, size: "square" })).toBe("starting-grid-square-2026-r17.png");
    expect(gridExportFilename("png", { season: 2026, round: 17, size: "wide", range: { from: 6, to: 15 } })).toBe("starting-grid-wide-2026-r17-p6-p15.png");
  });

  test("CSV and JSON are always the whole grid: no size, no range", () => {
    expect(gridExportFilename("csv", { season: 2026, round: 17 })).toBe("starting-grid-2026-r17.csv");
    expect(gridExportFilename("json", { season: 2026, round: 17, size: "wide", range: { from: 2, to: 3 } })).toBe("starting-grid-2026-r17.json");
  });
});

describe("the words of the controls", () => {
  test("the unsaved-changes note appears only while there are unsaved changes", () => {
    expect(exportNote(true)).toBe(UNSAVED_EXPORT_NOTE);
    expect(exportNote(false)).toBeNull();
    expect(UNSAVED_EXPORT_NOTE).toBe("The export is of the saved grid. Save your changes first to include them.");
  });

  test("after copying, in plain words, and a failure points to Download", () => {
    expect(copyMessage("CSV", true)).toBe("Copied the CSV.");
    expect(copyMessage("JSON", true)).toBe("Copied the JSON.");
    expect(copyMessage("CSV", false)).toContain("Could not copy the CSV");
    expect(copyMessage("JSON", false)).toContain("use Download instead");
  });

  test("the data exports say they are never cut to the range", () => {
    expect(FULL_DATA_NOTE).toBe("The CSV and JSON always have every place.");
  });
});

describe("buildGridCardView", () => {
  const withRaceName: SeasonState = { ...season, rounds: season.rounds.map((r) => (r.round === 3 ? { ...r, name: "Test Grand Prix" } : r)) };

  test("is what the picture is drawn from: race, source, and every place", () => {
    const view = buildGridCardView(withRaceName, { round: 3, effective: manual }, null)!;
    expect(view).toMatchObject({ season: season.season, round: 3, raceName: "Test Grand Prix", source: "manual", range: null });
    expect(view.rows).toEqual([
      { position: 1, code: "BBB", teamId: "red", pit: false },
      { position: 2, code: "AAA", teamId: "red", pit: false },
      { position: 3, code: "CCC", teamId: "blue", pit: false },
      { position: 4, code: "DDD", teamId: "blue", pit: false },
      { position: 5, code: "EEE", teamId: "green", pit: false },
      { position: 6, code: "FFF", teamId: "green", pit: true },
    ]);
  });

  test("carries the range for the picture", () => {
    expect(buildGridCardView(withRaceName, { round: 3, effective: manual }, { from: 2, to: 4 })!.range).toEqual({ from: 2, to: 4 });
  });

  test("a race with no name in the schedule has none", () => {
    const unnamed: SeasonState = { ...season, rounds: season.rounds.map((r) => (r.round === 3 ? { ...r, name: "" } : r)) };
    expect(buildGridCardView(unnamed, { round: 3, effective: manual }, null)!.raceName).toBeNull();
  });

  test("no grid yet, or no race left: no picture", () => {
    expect(buildGridCardView(season, { round: 3, effective: null }, null)).toBeNull();
    expect(buildGridCardView(season, { round: null, effective: manual }, null)).toBeNull();
  });
});

/** A small CSV reader for the test: handles quotes, doubled quotes, and line breaks inside quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}
