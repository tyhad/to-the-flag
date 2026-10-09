/** Header data-status view-model. Pure: no DOM, no fetch. */

export type DataStatus = "ok" | "warn" | "fail";

export type HealthState =
  | { status: "loading" }
  | { status: "ready"; season: number; asOfRound: number; dataStatus: DataStatus }
  | { status: "error"; message: string | null };

const DATA_STATUSES: readonly string[] = ["ok", "warn", "fail"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Turn an `/api/health` response (HTTP ok flag plus parsed JSON body) into a header state. */
export function parseHealthResponse(httpOk: boolean, body: unknown): HealthState {
  if (!httpOk) {
    const message = isRecord(body) && typeof body.message === "string" && body.message !== "" ? body.message : null;
    return { status: "error", message };
  }
  if (
    isRecord(body) &&
    typeof body.season === "number" &&
    typeof body.asOfRound === "number" &&
    typeof body.dataStatus === "string" &&
    DATA_STATUSES.includes(body.dataStatus)
  ) {
    return {
      status: "ready",
      season: body.season,
      asOfRound: body.asOfRound,
      dataStatus: body.dataStatus as DataStatus,
    };
  }
  return { status: "error", message: null };
}

/** The line shown at the right of the header. "as of Round N" is always shown when data is loaded. */
export function headerLabel(state: HealthState): string {
  switch (state.status) {
    case "loading":
      return "Loading season data";
    case "ready":
      return `Season ${state.season} · as of Round ${state.asOfRound}`;
    case "error":
      return state.message ?? "Season data not loaded. Check that the server is running.";
  }
}
