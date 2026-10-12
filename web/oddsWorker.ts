/**
 * The odds worker (Phase 3, Step 8): runs the Monte Carlo model off the main thread, so the page stays responsive.
 * Built by scripts/build.ts as dist/oddsWorker.js. All the logic is in `answerOddsRequest`; this file only connects it
 * to messages.
 */
import { answerOddsRequest, type OddsRequest, type OddsResponse } from "./viewModel/oddsRequests";

// tsconfig has no WebWorker library, so this is the small part of the worker scope that is used.
interface WorkerScope {
  onmessage: ((event: MessageEvent<OddsRequest>) => void) | null;
  postMessage(message: OddsResponse): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  scope.postMessage(answerOddsRequest(event.data));
};
