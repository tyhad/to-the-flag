/** Tunable numbers for the UI. Change them here, not in components. */

export interface DifficultyBands {
  /** Up to and including this share of the remaining points needed: green. */
  green: number;
  /** Up to and including this share: yellow. Above it: orange. */
  yellow: number;
}

/**
 * Difficulty meter bands (DESIGN.md section 6). The meter shows a share of the points still on offer.
 * It is arithmetic, never a probability.
 */
export const DIFFICULTY_BANDS: DifficultyBands = { green: 0.4, yellow: 0.75 };

/** How long the inputs must stay unchanged before the odds are recalculated (milliseconds). */
export const ODDS_DEBOUNCE_MS = 250;

/**
 * The odds worker, as built into dist/ next to the page. `scripts/build.ts` bundles web/oddsWorker.ts under this name.
 * It is resolved against the page's own script, so it always loads from the same origin.
 */
export const ODDS_WORKER_FILE = "./oddsWorker.js";

export interface OddsBands {
  /** At least this probability: green. */
  green: number;
  /** At least this probability (and under `green`): yellow. Below it: orange. */
  yellow: number;
}

/** Probability bar colors (DESIGN.md section 6). */
export const ODDS_BANDS: OddsBands = { green: 0.5, yellow: 0.1 };

/** The form-weight slider moves in steps of this many percent, and starts at the default. */
export const FORM_WEIGHT_STEP = 10;
export const FORM_WEIGHT_DEFAULT = 100;
