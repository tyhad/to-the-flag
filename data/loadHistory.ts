/**
 * Loads multiple season SQLite databases for history evaluation and calibration.
 * See docs/PHASE_4.md Step 3.
 */
import { join } from "node:path";
import { loadSeason } from "./loadSeason";
import type { SeasonState } from "../engine/types";

export interface SkippedSeason {
  season: number;
  reason: string;
}

export interface LoadSeasonsResult {
  loaded: SeasonState[];
  skipped: SkippedSeason[];
}

/**
 * Loads each season's SQLite file (`f1gstats-<season>.sqlite`) from `dir`.
 * Returns `{ loaded, skipped }`. Never throws for one bad season; reports it in `skipped`.
 */
export function loadSeasons(dir: string, seasons: readonly number[]): LoadSeasonsResult {
  const loaded: SeasonState[] = [];
  const skipped: SkippedSeason[] = [];

  for (const season of seasons) {
    const path = join(dir, `f1gstats-${season}.sqlite`);
    try {
      const state = loadSeason(path);
      if (state.season !== season) {
        skipped.push({
          season,
          reason: `f1gstats-${season}.sqlite has season ${state.season}, expected ${season}`,
        });
        continue;
      }
      loaded.push(state);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      skipped.push({ season, reason });
    }
  }

  return { loaded, skipped };
}
