import { useEffect, useMemo, useState } from "react";
import type { OddsParams, SeasonState } from "../engine";
import { ODDS_DEBOUNCE_MS, ODDS_WORKER_FILE } from "./config";
import {
  applyForecastResponse,
  failForecast,
  initialForecastState,
  markForecastCalculating,
  markForecastIdle,
  type ForecastRequest,
  type ForecastResponse,
  type ForecastState,
} from "./viewModel/forecastRequests";
import { OddsRequestTracker } from "./viewModel/oddsRequests";

export interface UseRaceForecastInput {
  state: SeasonState | null;
  params?: Partial<OddsParams>;
  /** Set to false while the "Race" tab is not shown (or there is no grid), so nothing is calculated for nothing. */
  enabled?: boolean;
}

/**
 * The forecast of the next race, calculated in a Web Worker: the same worker file, the same debounce and the same
 * "newest answer only" rule as `useOdds`. The previous forecast stays in the state while a new one is being
 * calculated (or has failed), so the UI can show it dimmed.
 */
export function useRaceForecast({ state, params, enabled = true }: UseRaceForecastInput): ForecastState {
  const [forecast, setForecast] = useState<ForecastState>(initialForecastState);
  const [tracker] = useState(() => new OddsRequestTracker());
  const [workerBox] = useState<{ worker: Worker | null }>(() => ({ worker: null }));
  // One stable text for the input that is an object, so a new object with the same content is not a change.
  const paramsKey = useMemo(() => JSON.stringify(params ?? null), [params]);

  // The worker lives as long as the hook is enabled.
  useEffect(() => {
    if (!enabled) return;
    let worker: Worker;
    try {
      worker = new Worker(new URL(ODDS_WORKER_FILE, import.meta.url), { type: "module" });
    } catch {
      setForecast((s) => failForecast(s, "This browser could not start the background calculation."));
      return;
    }
    worker.onmessage = (event: MessageEvent<ForecastResponse>) => {
      setForecast((s) => applyForecastResponse(s, event.data, tracker.latestId));
    };
    worker.onerror = () => {
      setForecast((s) => failForecast(s, "The background calculation stopped unexpectedly."));
    };
    workerBox.worker = worker;
    return () => {
      worker.terminate();
      workerBox.worker = null;
      tracker.invalidate();
    };
  }, [enabled, tracker, workerBox]);

  // Every change of the inputs is a new request; the call itself waits until the inputs have settled.
  useEffect(() => {
    if (!enabled || !state) {
      tracker.invalidate();
      setForecast(markForecastIdle);
      return;
    }
    const id = tracker.issue();
    setForecast(markForecastCalculating);
    const timer = setTimeout(() => {
      const request: ForecastRequest = { id, kind: "forecast", state, params };
      workerBox.worker?.postMessage(request);
    }, ODDS_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `params` is covered by `paramsKey`.
  }, [enabled, state, paramsKey, tracker, workerBox]);

  return forecast;
}
