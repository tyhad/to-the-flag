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
