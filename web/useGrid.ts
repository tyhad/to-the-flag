import { useCallback, useEffect, useReducer } from "react";
import { gridApi } from "./scenarioApi";
import {
  gridReducer,
  gridSignature,
  initialGridState,
  readDismissedGrid,
  resolveGridNoticeStorage,
  writeDismissedGrid,
  type GridNoticeStorage,
  type GridState,
} from "./viewModel/grid";

export interface GridControls {
  state: GridState;
  /** "Keep mine": hides the notice until OpenF1's grid changes. */
  keepMine: () => void;
  /** "Use OpenF1 grid": removes the manual grid on the server, then refreshes the season so the odds follow. */
  chooseOpenF1: () => Promise<void>;
}

const REFRESH_FAILED = "The manual grid was removed, but the page could not refresh. Reload the page.";

/**
 * Which starting grid is in use (`GET /api/grid`), and what the owner did with the "OpenF1 has a different grid" notice.
 * `refreshSeason` fetches the season again (it carries the grid the odds are computed with).
 * `storage` is only for tests; the page uses the browser's localStorage.
 */
export function useGrid(refreshSeason: () => Promise<boolean>, storage?: GridNoticeStorage): GridControls {
  const [state, dispatch] = useReducer(gridReducer, undefined, () =>
    initialGridState(readDismissedGrid(storage ?? resolveGridNoticeStorage())),
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await gridApi.get();
      if (!cancelled) dispatch({ type: "loaded", info: res.ok ? res.data : null });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signature = gridSignature(state.info);
  const keepMine = useCallback(() => {
    dispatch({ type: "keepMine" });
    if (signature !== null) writeDismissedGrid(signature, storage ?? resolveGridNoticeStorage());
  }, [signature, storage]);

  const chooseOpenF1 = useCallback(async () => {
    dispatch({ type: "clearStarted" });
    const res = await gridApi.clear();
    if (!res.ok) {
      dispatch({ type: "clearFailed", message: res.message });
      return;
    }
    dispatch({ type: "cleared", info: res.data });
    if (!(await refreshSeason())) dispatch({ type: "clearFailed", message: REFRESH_FAILED });
  }, [refreshSeason]);

  return { state, keepMine, chooseOpenF1 };
}
