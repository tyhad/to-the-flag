/**
 * The words for the two edge states of a season (Phase 10, Step 1, D60). Pure: no DOM, no fetch.
 *
 * "Season complete": no session is left to run. "Season not started": no round has a result. Every panel asks this
 * module, so the same state is said the same way in the header, the rails, the table and the PNG card.
 */
import { seasonPhase, type SeasonPhase, type SeasonState } from "../../engine";

export { seasonPhase, type SeasonPhase };

export const SEASON_COMPLETE = "Season complete";
export const SEASON_NOT_STARTED = "Season not started";

export interface PhaseMessage {
  title: string;
  text: string;
}

/** The right of the header: "Season 2026 · Season complete". Null while the season runs. */
export function phaseHeaderLabel(season: number, phase: SeasonPhase): string | null {
  if (phase === "complete") return `Season ${season} · ${SEASON_COMPLETE}`;
  if (phase === "not-started") return `Season ${season} · ${SEASON_NOT_STARTED}`;
  return null;
}

/** Instead of the session cards. Null while the season runs. */
export function sessionsMessage(phase: SeasonPhase): PhaseMessage | null {
  if (phase === "complete") {
    return { title: SEASON_COMPLETE, text: "No session is left to lock, so the standings are final." };
  }
  if (phase === "not-started") {
    return { title: SEASON_NOT_STARTED, text: "Sessions can be locked once the first race has a result." };
  }
  return null;
}

/** Instead of the standings table (only before the first race: a complete season still shows its final table). */
export function standingsMessage(phase: SeasonPhase): PhaseMessage | null {
  if (phase === "not-started") {
    return { title: SEASON_NOT_STARTED, text: "The standings appear once the first race has a result." };
  }
  return null;
}

/** Instead of the Possible? and Likely? panels, before the first race. */
export function analysisMessage(phase: SeasonPhase): PhaseMessage | null {
  if (phase === "not-started") {
    return { title: SEASON_NOT_STARTED, text: "Title paths and odds appear once the first race has a result." };
  }
  return null;
}

/** The one line above a complete season's table, where "Lock a result to see the table change." is said otherwise. */
export function standingsHint(phase: SeasonPhase, hasLocks: boolean): string | null {
  if (phase === "complete") return `${SEASON_COMPLETE}. These standings are final.`;
  return hasLocks ? null : "Lock a result to see the table change.";
}

/** The Race tab when there is no race left. */
export const NO_RACE_LEFT: PhaseMessage = { title: "No race left", text: `${SEASON_COMPLETE}. There is no grid to set.` };

/** The reason a lock control is disabled, in one line. Null while the season runs. */
export function lockDisabledReason(phase: SeasonPhase): string | null {
  if (phase === "complete") return `${SEASON_COMPLETE}: there is nothing left to lock.`;
  if (phase === "not-started") return `${SEASON_NOT_STARTED}: nothing can be locked yet.`;
  return null;
}

/** "Final" on the PNG card in place of "Round N", and in the "Likely?" panel in place of "as of Round N". */
export const FINAL_LABEL = "Final";

/** The headline of the path panels when the title is decided and no session is left. */
export function finalHeadline(name: string, kind: "driver" | "team", rank: number, points: number): string {
  const title = kind === "driver" ? "drivers'" : "constructors'";
  const pts = `${points} ${points === 1 ? "point" : "points"}`;
  return rank === 1
    ? `Final: ${name} won the ${title} title with ${pts}.`
    : `Final: ${name} finished P${rank} with ${pts}. The ${title} title is decided.`;
}

/** True when the final-state rules apply to this season. */
export function isFinal(state: SeasonState): boolean {
  return seasonPhase(state) === "complete";
}
