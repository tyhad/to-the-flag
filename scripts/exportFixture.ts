/**
 * Usage: bun scripts/exportFixture.ts <path-to-f1gstats.sqlite> <out.json>
 * Writes the loader output as JSON (one array element per line, so diffs stay readable).
 * Public data, small enough to commit as tests/fixtures/season-2026-r16.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadSeason } from "../data/loadSeason";
import type { SeasonState } from "../engine/types";

export function formatState(state: SeasonState): string {
  const parts = Object.entries(state).map(([key, value]) => {
    if (Array.isArray(value)) {
      const body = value.length === 0 ? "[]" : `[\n${value.map((v) => `    ${JSON.stringify(v)}`).join(",\n")}\n  ]`;
      return `  ${JSON.stringify(key)}: ${body}`;
    }
    return `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`;
  });
  return `{\n${parts.join(",\n")}\n}\n`;
}

if (import.meta.main) {
  const [dbPath, outPath] = process.argv.slice(2);
  if (!dbPath || !outPath || process.argv.length !== 4) {
    console.error("Usage: bun scripts/exportFixture.ts <path-to-f1gstats.sqlite> <out.json>");
    process.exit(1);
  }
  try {
    const state = loadSeason(dbPath);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, formatState(state));
    console.log(`Wrote ${outPath}`);
    console.log(
      `season ${state.season}, as of round ${state.asOfRound}, ${state.results.length} result rows, ` +
        `${state.qualifying.length} qualifying rows, ${state.drivers.length} drivers, ${state.teams.length} teams, ` +
        `health ${state.health.status}`,
    );
  } catch (err) {
    console.error(`${err instanceof Error ? err.name : "Error"}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
