import { useEffect, useState } from "react";
import { parseHealthResponse, type HealthState } from "./viewModel/health";

/** Reads `/api/health` once. Same-origin, relative URL: no external requests. */
export function useHealth(): HealthState {
  const [state, setState] = useState<HealthState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/health", { signal: controller.signal });
        const body: unknown = await res.json().catch(() => null);
        setState(parseHealthResponse(res.ok, body));
      } catch {
        if (!controller.signal.aborted) setState({ status: "error", message: null });
      }
    })();
    return () => controller.abort();
  }, []);

  return state;
}
