/**
 * The race forecast's conversation with the worker (Phase 8, Step 5), without any Worker or React in it, so it can be
 * tested. It is the same pattern as the odds (`oddsRequests.ts`): requests are numbered, only the answer to the newest
 * one is used, and the previous result stays while a new one is being calculated.
 */
import { activeDrivers, forecastRace, type OddsParams, type RaceForecast, type SeasonState } from "../../engine";
import type { OddsRequest, OddsResponse } from "./oddsRequests";
import { answerOddsRequest } from "./oddsRequests";

/** What the UI sends to the worker to ask for the next race's forecast. */
export interface ForecastRequest {
  id: number;
  kind: "forecast";
  state: SeasonState;
  params?: Partial<OddsParams>;
}

/** The forecast and what it was calculated from, so the page can show exactly what the numbers are based on. */
export interface ForecastData extends RaceForecast {
  /** The drivers who race, in the order of the state. */
  field: string[];
  /** The starting grid the model used (driver code -> place), or null when it used none. */
  grid: Record<string, number> | null;
  /** The round of that grid, and where it came from (the season's `upcomingGrid.source`, "manual" for a manual grid). */
  gridRound: number | null;
  gridSource: string | null;
  /** The latest completed round the model fitted on. */
  asOfRound: number;
}

/** What the worker sends back: the forecast and how long it took, or an error. */
export type ForecastResponse = { id: number; forecast: ForecastData; ms: number } | { id: number; error: string };

/** Runs one forecast. Never throws: a problem comes back as an error answer, so the worker keeps working. */
export function answerForecastRequest(request: ForecastRequest, now: () => number = () => performance.now()): ForecastResponse {
  const started = now();
  try {
    const { state, params } = request;
    const field = activeDrivers(state);
    const grid = state.upcomingGrid?.grid;
    const forecast = forecastRace(state, params, field, grid);
    return {
      id: request.id,
      forecast: {
        ...forecast,
        field,
        grid: grid ?? null,
        gridRound: state.upcomingGrid?.round ?? null,
        gridSource: state.upcomingGrid?.source ?? null,
        asOfRound: state.asOfRound,
      },
      ms: Math.round(now() - started),
    };
  } catch (error) {
    return { id: request.id, error: error instanceof Error ? error.message : String(error) };
  }
}

/** The single worker answers both kinds of request; the odds requests have no `kind`. */
export type WorkerRequest = OddsRequest | ForecastRequest;

export function answerWorkerRequest(request: WorkerRequest): OddsResponse | ForecastResponse {
  return "kind" in request && request.kind === "forecast" ? answerForecastRequest(request) : answerOddsRequest(request as OddsRequest);
}

export type ForecastStatus = "idle" | "calculating" | "ready" | "error";

export interface ForecastState {
  status: ForecastStatus;
  /** The latest forecast that arrived. Kept while a newer calculation runs or fails, so the UI can show it dimmed. */
  forecast: ForecastData | null;
  error: string | null;
  durationMs: number | null;
}

export const initialForecastState: ForecastState = { status: "idle", forecast: null, error: null, durationMs: null };

/** The inputs changed and a new calculation is due. Returns the same object if that is already the case. */
export function markForecastCalculating(state: ForecastState): ForecastState {
  if (state.status === "calculating" && state.error === null) return state;
  return { ...state, status: "calculating", error: null };
}

/** There is nothing to calculate (no grid yet, or the tab is not shown). */
export function markForecastIdle(state: ForecastState): ForecastState {
  if (state.status === "idle") return state;
  return { ...state, status: "idle", error: null };
}

/** A problem that did not come from a request, for example a worker that cannot start. */
export function failForecast(state: ForecastState, message: string): ForecastState {
  return { ...state, status: "error", error: message };
}

/** Folds a worker answer into the state. An answer to anything but the latest request changes nothing. */
export function applyForecastResponse(state: ForecastState, response: ForecastResponse, latestId: number): ForecastState {
  if (response.id !== latestId) return state;
  if ("error" in response) return { ...state, status: "error", error: response.error };
  return { status: "ready", forecast: response.forecast, error: null, durationMs: response.ms };
}
