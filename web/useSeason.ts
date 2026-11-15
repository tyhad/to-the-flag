import { useCallback, useEffect, useState } from "react";
import { parseSeasonResponse, type SeasonLoad } from "./viewModel/season";

/**
 * Fetches the season snapshot once. Same-origin, relative URL: no external requests.
 * Every lock change after this is computed in the browser, with no further round trips.
 *
 * `reload` fetches it again without leaving the page: the scenario and the other choices stay as they are. It is for
 * changes the server made to the season itself (the starting grid). It resolves to true when a fresh season arrived;
 * when it fails the page keeps the season it has.
 */
export function useSeason(): [SeasonLoad, () => Promise<boolean>] {
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

  const reload = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/season");
      const body: unknown = await res.json().catch(() => null);
      const next = parseSeasonResponse(res.ok, body);
      if (next.status !== "ready") return false;
      setLoad(next);
      return true;
    } catch {
      return false;
    }
  }, []);

  return [load, reload];
}
