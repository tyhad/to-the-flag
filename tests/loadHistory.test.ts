import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSeasons } from "../data/loadHistory";
import { SchemaVersionError } from "../data/loadSeason";
import { buildDb, cleanupDbs } from "./dbHelpers";

const tmpDirs: string[] = [];
afterAll(() => {
  cleanupDbs();
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("loadSeasons", () => {
  test("two seasons load; a missing file and a bad schema version are reported in skipped", () => {
    const dir = mkdtempSync(join(tmpdir(), "ttf-hist-"));
    tmpDirs.push(dir);

    // Season 2022: valid
    buildDb((s) => (s.season = 2022), join(dir, "f1gstats-2022.sqlite"));
    // Season 2023: valid
    buildDb((s) => (s.season = 2023), join(dir, "f1gstats-2023.sqlite"));
    // Season 2024: bad schema version (v1)
    buildDb(
      (s) => {
        s.season = 2024;
        s.schemaVersion = 1;
      },
      join(dir, "f1gstats-2024.sqlite"),
    );
    // Season 2025: missing file

    const result = loadSeasons(dir, [2022, 2023, 2024, 2025]);

    expect(result.loaded).toHaveLength(2);
    expect(result.loaded.map((s) => s.season)).toEqual([2022, 2023]);

    expect(result.skipped).toHaveLength(2);
    expect(result.skipped[0]?.season).toBe(2024);
    expect(result.skipped[0]?.reason).toMatch(/schema_version 1/);

    expect(result.skipped[1]?.season).toBe(2025);
    expect(result.skipped[1]?.reason).toMatch(/not found/);
  });

  const REAL_HISTORY_DIR = join(import.meta.dir, "..", "..", "F1GStats", "history");
  describe.skipIf(!existsSync(REAL_HISTORY_DIR))("real history databases", () => {
    test("loads seasons 2022 to 2025 from F1GStats/history", () => {
      const result = loadSeasons(REAL_HISTORY_DIR, [2022, 2023, 2024, 2025]);
      expect(result.loaded).toHaveLength(4);
      expect(result.loaded.map((s) => s.season)).toEqual([2022, 2023, 2024, 2025]);
      expect(result.skipped).toEqual([]);
    });
  });
});
