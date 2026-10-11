import { useEffect, useState } from "react";
import { parseSeasonResponse, type SeasonLoad } from "./viewModel/season";

/**
 * Fetches the season snapshot once. Same-origin, relative URL: no external requests.
 * Every lock change after this is computed in the browser, with no further round trips.
 */
export function useSeason(): SeasonLoad {
  const [load, setLoad] = useState<SeasonLoad>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/season", { signal: controller.signal });
        const body: unknown = await res.json().catch(() => null);
        setLoad(parseSeasonResponse(res.ok, body));
      } catch {
        if (!controller.signal.aborted) setLoad({ status: "error", message: null });
      }
    })();
    return () => controller.abort();
  }, []);

  return load;
}
