/** Load state for the season snapshot from `/api/season`. Pure: no DOM, no fetch. */
import type { SeasonState } from "../../engine";

export type SeasonLoad =
  | { status: "loading" }
  | { status: "ready"; state: SeasonState }
  | { status: "error"; message: string | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Enough of a check to refuse a body the engine would crash on. The server is the real validator. */
function looksLikeSeasonState(body: unknown): body is SeasonState {
  return (
    isRecord(body) &&
    typeof body.season === "number" &&
    typeof body.asOfRound === "number" &&
    Array.isArray(body.rounds) &&
    Array.isArray(body.results) &&
    Array.isArray(body.qualifying) &&
    Array.isArray(body.drivers) &&
    Array.isArray(body.teams)
  );
}

/** Turn an `/api/season` response (HTTP ok flag plus parsed JSON body) into a load state. */
export function parseSeasonResponse(httpOk: boolean, body: unknown): SeasonLoad {
  if (!httpOk) {
    const message = isRecord(body) && typeof body.message === "string" && body.message !== "" ? body.message : null;
    return { status: "error", message };
  }
  if (looksLikeSeasonState(body)) return { status: "ready", state: body };
  return { status: "error", message: null };
}

/** One line for the loading and error states. Ready has no message. */
export function loadMessage(load: Exclude<SeasonLoad, { status: "ready" }>): string {
  if (load.status === "loading") return "Loading season data";
  return load.message ?? "Season data not loaded. Check that the server is running.";
}
