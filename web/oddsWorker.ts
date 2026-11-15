/**
 * The odds worker (Phase 3, Step 8): runs the Monte Carlo model off the main thread, so the page stays responsive.
 * It answers two kinds of request: the championship odds and (Phase 8) the forecast of the next race.
 * Built by scripts/build.ts as dist/oddsWorker.js. All the logic is in `answerWorkerRequest`; this file only connects
 * it to messages.
 */
import { answerWorkerRequest, type ForecastResponse, type WorkerRequest } from "./viewModel/forecastRequests";
import type { OddsResponse } from "./viewModel/oddsRequests";

// tsconfig has no WebWorker library, so this is the small part of the worker scope that is used.
interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: OddsResponse | ForecastResponse): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  scope.postMessage(answerWorkerRequest(event.data));
};
