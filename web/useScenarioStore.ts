import { useCallback, useEffect, useState } from "react";
import { scenarioApi, type ApiResult, type ScenarioInput } from "./scenarioApi";
import type { SavedScenario } from "./viewModel/scenarios";

export interface ScenarioStore {
  status: "loading" | "ready" | "error";
  /** Why the list could not be loaded. */
  loadMessage: string | null;
  scenarios: SavedScenario[];
  /** The scenario the overlay feed is showing, or null for the real standings. */
  activeId: string | null;
  /** A request is in flight. */
  busy: boolean;
  create(input: ScenarioInput): Promise<ApiResult<SavedScenario>>;
  update(
    id: string,
    patch: Parameters<typeof scenarioApi.update>[1],
  ): Promise<ApiResult<SavedScenario>>;
  remove(id: string): Promise<ApiResult<null>>;
  setActive(id: string | null): Promise<ApiResult<string | null>>;
}

/** Saved scenarios and the overlay's active scenario, loaded once and kept in step with every change. */
export function useScenarioStore(): ScenarioStore {
  const [status, setStatus] = useState<ScenarioStore["status"]>("loading");
  const [loadMessage, setLoadMessage] = useState<string | null>(null);
  const [scenarios, setScenarios] = useState<SavedScenario[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [list, active] = await Promise.all([scenarioApi.list(), scenarioApi.getActive()]);
      if (cancelled) return;
      if (!list.ok) {
        setStatus("error");
        setLoadMessage(list.message);
        return;
      }
      setScenarios(list.data);
      setActiveId(active.ok ? active.data : null);
      setStatus("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const track = useCallback(async <T,>(work: () => Promise<T>): Promise<T> => {
    setPending((n) => n + 1);
    try {
      return await work();
    } finally {
      setPending((n) => n - 1);
    }
  }, []);

  const create = useCallback(
    (input: ScenarioInput) =>
      track(async () => {
        const r = await scenarioApi.create(input);
        if (r.ok) setScenarios((list) => [...list, r.data]);
        return r;
      }),
    [track],
  );

  const update = useCallback(
    (id: string, patch: Parameters<typeof scenarioApi.update>[1]) =>
      track(async () => {
        const r = await scenarioApi.update(id, patch);
        if (r.ok) setScenarios((list) => list.map((s) => (s.id === id ? r.data : s)));
        return r;
      }),
    [track],
  );

  const remove = useCallback(
    (id: string) =>
      track(async () => {
        const r = await scenarioApi.remove(id);
        if (r.ok) {
          setScenarios((list) => list.filter((s) => s.id !== id));
          // The server clears the active scenario if it was this one.
          setActiveId((current) => (current === id ? null : current));
        }
        return r;
      }),
    [track],
  );

  const setActive = useCallback(
    (id: string | null) =>
      track(async () => {
        const r = await scenarioApi.setActive(id);
        if (r.ok) setActiveId(r.data);
        return r;
      }),
    [track],
  );

  return { status, loadMessage, scenarios, activeId, busy: pending > 0, create, update, remove, setActive };
}
