import { useEffect, useMemo, useState } from "react";
import type { OddsParams, Scenario, SeasonState } from "../engine";
import { ODDS_DEBOUNCE_MS, ODDS_WORKER_FILE } from "./config";
import {
  OddsRequestTracker,
  applyOddsResponse,
  failOdds,
  initialOddsState,
  markCalculating,
  markIdle,
  type OddsRequest,
  type OddsResponse,
  type OddsState,
} from "./viewModel/oddsRequests";

export interface UseOddsInput {
  state: SeasonState | null;
  scenario?: Scenario;
  params?: Partial<OddsParams>;
  /** Set to false while the "Likely?" panel is not shown, so nothing is calculated for nothing. */
  enabled?: boolean;
}

/**
 * The championship odds for a season and a scenario, calculated in a Web Worker.
 *
 * A change in the inputs marks the state `calculating` at once and starts the calculation after
 * ODDS_DEBOUNCE_MS of calm. Only the answer to the newest request is used. The previous result stays in the state
 * while a new one is being calculated (or has failed), so the UI can show it dimmed.
 */
export function useOdds({ state, scenario, params, enabled = true }: UseOddsInput): OddsState {
  const [odds, setOdds] = useState<OddsState>(initialOddsState);
  const [tracker] = useState(() => new OddsRequestTracker());
  const [workerBox] = useState<{ worker: Worker | null }>(() => ({ worker: null }));
  // One stable text for the inputs that are objects, so a new object with the same content is not a change.
  const inputsKey = useMemo(() => JSON.stringify([scenario ?? null, params ?? null]), [scenario, params]);

  // The worker lives as long as the hook is enabled.
  useEffect(() => {
    if (!enabled) return;
    let worker: Worker;
    try {
      // Resolved against this script, so it comes from the same place as the page.
      worker = new Worker(new URL(ODDS_WORKER_FILE, import.meta.url), { type: "module" });
    } catch {
      setOdds((s) => failOdds(s, "This browser could not start the background calculation.", "failed"));
      return;
    }
    worker.onmessage = (event: MessageEvent<OddsResponse>) => {
      setOdds((s) => applyOddsResponse(s, event.data, tracker.latestId));
    };
    worker.onerror = () => {
      setOdds((s) => failOdds(s, "The background calculation stopped unexpectedly.", "failed"));
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
      setOdds(markIdle);
      return;
    }
    const id = tracker.issue();
    setOdds(markCalculating);
    const timer = setTimeout(() => {
      const request: OddsRequest = { id, state, scenario, params };
      workerBox.worker?.postMessage(request);
    }, ODDS_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `scenario` and `params` are covered by `inputsKey`.
  }, [enabled, state, inputsKey, tracker, workerBox]);

  return odds;
}
