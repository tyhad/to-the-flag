/**
 * web/viewModel/freshness.ts - Pure freshness decision and message builder.
 */

export interface FreshnessBaseline {
  asOfRound: number;
  checkedAt: string;
}

export interface FreshnessCheck {
  asOfRound: number;
  checkedAt: string;
}

export type FreshnessStatus = "none" | "new-data";

export interface FreshnessResult {
  status: FreshnessStatus;
  message: string | null;
  newRound: number | null;
}

export function isNewerData(latest: FreshnessCheck, current: FreshnessBaseline): boolean {
  if (latest.asOfRound > current.asOfRound) return true;
  if (latest.asOfRound === current.asOfRound && latest.checkedAt > current.checkedAt) {
    return true;
  }
  return false;
}

export function decideFreshness(
  current: FreshnessBaseline,
  latest: FreshnessCheck | null | undefined,
  isEditing: boolean = false,
): FreshnessResult {
  if (!latest) {
    return { status: "none", message: null, newRound: null };
  }

  const newer = isNewerData(latest, current);
  if (!newer || isEditing) {
    return { status: "none", message: null, newRound: null };
  }

  return {
    status: "new-data",
    message: `New data from Round ${latest.asOfRound} is ready.`,
    newRound: latest.asOfRound,
  };
}
