/**
 * The conversation between the UI and the odds worker (Phase 3, Step 8), without any Worker or React in it, so it
 * can be tested. The UI numbers its requests; only the answer to the newest one is used.
 */
import { InvalidScenarioError, computeOdds, type OddsParams, type OddsResult, type Scenario, type SeasonState } from "../../engine";

/** What the UI sends to the worker. */
export interface OddsRequest {
  id: number;
  state: SeasonState;
  scenario?: Scenario;
  params?: Partial<OddsParams>;
}

export type OddsErrorKind = "invalid_scenario" | "failed";

/** What the worker sends back: the odds and how long they took, or an error. */
export type OddsResponse =
  | { id: number; result: OddsResult; ms: number }
  | { id: number; error: string; kind: OddsErrorKind };

/** Runs one request. Never throws: a problem comes back as an error answer, so the worker keeps working. */
export function answerOddsRequest(request: OddsRequest, now: () => number = () => performance.now()): OddsResponse {
  const started = now();
  try {
    const result = computeOdds(request.state, request.scenario, request.params);
    return { id: request.id, result, ms: Math.round(now() - started) };
  } catch (error) {
    return {
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
      kind: error instanceof InvalidScenarioError ? "invalid_scenario" : "failed",
    };
  }
}

/** Hands out request ids and knows which one is the latest. */
export class OddsRequestTracker {
  private latest = 0;

  get latestId(): number {
    return this.latest;
  }

  /** A new request: from now on every older one is out of date. */
  issue(): number {
    return ++this.latest;
  }

  isCurrent(id: number): boolean {
    return id === this.latest && id > 0;
  }

  /** The inputs went away (or the hook is closing): answers still on their way are out of date. */
  invalidate(): void {
    this.latest++;
  }
}

export type OddsStatus = "idle" | "calculating" | "ready" | "error";

export interface OddsState {
  status: OddsStatus;
  /** The latest odds that arrived. Kept while a newer calculation runs or fails, so the UI can show it dimmed. */
  result: OddsResult | null;
  error: string | null;
  errorKind: OddsErrorKind | null;
  /** How long the last finished calculation took, in milliseconds. */
  durationMs: number | null;
}

export const initialOddsState: OddsState = { status: "idle", result: null, error: null, errorKind: null, durationMs: null };

/** The inputs changed and a new calculation is due. Returns the same object if that is already the case. */
export function markCalculating(state: OddsState): OddsState {
  if (state.status === "calculating" && state.error === null) return state;
  return { ...state, status: "calculating", error: null, errorKind: null };
}

/** There is nothing to calculate (no season yet, or the feature is off). */
export function markIdle(state: OddsState): OddsState {
  if (state.status === "idle") return state;
  return { ...state, status: "idle", error: null, errorKind: null };
}

/** A problem that did not come from a request, for example a worker that cannot start. */
export function failOdds(state: OddsState, message: string, kind: OddsErrorKind): OddsState {
  return { ...state, status: "error", error: message, errorKind: kind };
}

/** Folds a worker answer into the state. An answer to anything but the latest request changes nothing. */
export function applyOddsResponse(state: OddsState, response: OddsResponse, latestId: number): OddsState {
  if (response.id !== latestId) return state;
  if ("error" in response) return { ...state, status: "error", error: response.error, errorKind: response.kind };
  return { status: "ready", result: response.result, error: null, errorKind: null, durationMs: response.ms };
}
