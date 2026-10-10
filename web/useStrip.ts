import { useCallback, useEffect, useState, type Dispatch } from "react";
import { InvalidScenarioError, validateScenario, type SeasonState } from "../engine";
import { encodeScenario } from "../shared/shareCodec";
import type { ScenarioStore } from "./useScenarioStore";
import { defaultCompareSides, type SideId } from "./viewModel/compare";
import { describeScenarioError } from "./viewModel/locks";
import { isDirty, toScenario, validateScenarioName } from "./viewModel/scenarios";
import { buildShareHash, importFromHash } from "./viewModel/share";
import type { Workspace, WorkspaceMessage } from "./viewModel/workspace";

export interface Banner {
  tone: "info" | "warn" | "error";
  text: string;
}

export interface CompareState {
  open: boolean;
  left: SideId;
  right: SideId;
}

export interface Strip {
  /** The saved scenario the sandbox is bound to. Null means Base or an unsaved sandbox. */
  selectedId: string | null;
  banner: Banner | null;
  /** A link the browser would not copy for us, shown so the owner can copy it by hand. */
  manualLink: string | null;
  compare: CompareState;
  selectChip(id: string | null): void;
  /** Resolves to a message to show in the form, or null when it worked. */
  saveNew(name: string): Promise<string | null>;
  saveChanges(): Promise<void>;
  rename(name: string): Promise<string | null>;
  removeSelected(): Promise<void>;
  copyLink(): Promise<void>;
  toggleOverlay(): Promise<void>;
  toggleCompare(): void;
  setCompareSide(side: "left" | "right", id: SideId): void;
  dismissBanner(): void;
}

/** Everything the scenario strip does. The rules live in the view-models; this wires them to the browser and the API. */
export function useStrip(
  state: SeasonState,
  workspace: Workspace,
  dispatch: Dispatch<WorkspaceMessage>,
  store: ScenarioStore,
): Strip {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [manualLink, setManualLink] = useState<string | null>(null);
  const [compare, setCompare] = useState<CompareState>({ open: false, left: "base", right: "sandbox" });

  const selected = store.scenarios.find((s) => s.id === selectedId);
  const say = useCallback((tone: Banner["tone"], text: string) => {
    setBanner({ tone, text });
    setManualLink(null);
  }, []);

  // Open a shared link: when the page loads, and when a link is pasted into the address bar later.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const result = await importFromHash(state, window.location.hash);
      if (cancelled || result === null) return;
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      if (!result.ok) {
        say("error", result.message);
        return;
      }
      dispatch({
        type: "loadScenario",
        scenario: result.scenario,
        ...(result.contenders ? { contenders: result.contenders } : {}),
        scope: "strip",
      });
      setSelectedId(null);
      say(
        result.warning ? "warn" : "info",
        result.warning ? `Opened a shared scenario. ${result.warning}` : "Opened a shared scenario. Save it to keep it.",
      );
    };
    void run();
    const onHashChange = () => void run();
    window.addEventListener("hashchange", onHashChange);
    return () => {
      cancelled = true;
      window.removeEventListener("hashchange", onHashChange);
    };
  }, [state, dispatch, say]);

  const selectChip = useCallback(
    (id: string | null) => {
      setManualLink(null);
      if (id === null) {
        dispatch({ type: "loadScenario", scenario: { locks: {} }, scope: "strip" });
        setSelectedId(null);
        setBanner(null);
        return;
      }
      const saved = store.scenarios.find((s) => s.id === id);
      if (!saved) return;
      setSelectedId(id);
      if (!saved.valid) {
        setBanner(null);
        return;
      }
      const scenario = toScenario(saved);
      try {
        validateScenario(state, scenario);
      } catch (error) {
        if (error instanceof InvalidScenarioError) {
          say("error", `"${saved.name}" cannot be loaded. ${describeScenarioError(error)}`);
          return;
        }
        throw error;
      }
      dispatch({
        type: "loadScenario",
        scenario,
        ...(saved.contenders ? { contenders: saved.contenders } : {}),
        scope: "strip",
      });
      setBanner(null);
    },
    [dispatch, state, store.scenarios, say],
  );

  const saveNew = useCallback(
    async (name: string) => {
      const checked = validateScenarioName(name, store.scenarios);
      if (!checked.ok) return checked.message;
      const r = await store.create({ name: checked.name, scenario: workspace.scenario, contenders: workspace.contenders });
      if (!r.ok) return r.message;
      setSelectedId(r.data.id);
      say("info", `Saved "${r.data.name}".`);
      return null;
    },
    [store, workspace.scenario, workspace.contenders, say],
  );

  const saveChanges = useCallback(async () => {
    if (!selected) return;
    const r = await store.update(selected.id, { scenario: workspace.scenario, contenders: workspace.contenders });
    say(r.ok ? "info" : "error", r.ok ? `Saved changes to "${selected.name}".` : r.message);
  }, [selected, store, workspace.scenario, workspace.contenders, say]);

  const rename = useCallback(
    async (name: string) => {
      if (!selected) return null;
      const checked = validateScenarioName(name, store.scenarios, selected.id);
      if (!checked.ok) return checked.message;
      const r = await store.update(selected.id, { name: checked.name });
      if (!r.ok) return r.message;
      say("info", `Renamed to "${checked.name}".`);
      return null;
    },
    [selected, store, say],
  );

  const removeSelected = useCallback(async () => {
    if (!selected) return;
    const r = await store.remove(selected.id);
    if (!r.ok) {
      say("error", r.message);
      return;
    }
    setSelectedId(null);
    setCompare((c) => ({
      ...c,
      left: c.left === selected.id ? "base" : c.left,
      right: c.right === selected.id ? "sandbox" : c.right,
    }));
    say("info", `Deleted "${selected.name}". The sandbox keeps what is on screen.`);
  }, [selected, store, say]);

  const copyLink = useCallback(async () => {
    const code = await encodeScenario(workspace.scenario, workspace.contenders.slice());
    const url = `${window.location.origin}${window.location.pathname}${buildShareHash(code, state.asOfRound)}`;
    try {
      await navigator.clipboard.writeText(url);
      say("info", "Link copied. Opening it imports this scenario.");
    } catch {
      setBanner({ tone: "warn", text: "Could not copy automatically. Select the link below and copy it." });
      setManualLink(url);
    }
  }, [workspace.scenario, workspace.contenders, state.asOfRound, say]);

  const toggleOverlay = useCallback(async () => {
    if (!selected || !selected.valid || isDirty(workspace.scenario, workspace.contenders, selected)) return;
    const turnOff = store.activeId === selected.id;
    const r = await store.setActive(turnOff ? null : selected.id);
    if (!r.ok) say("error", r.message);
    else say("info", turnOff ? "The overlay is back to the real standings." : `Showing "${selected.name}" on the overlay.`);
  }, [selected, store, workspace.scenario, workspace.contenders, say]);

  const toggleCompare = useCallback(() => {
    setCompare((c) =>
      c.open ? { ...c, open: false } : { open: true, ...defaultCompareSides(selectedId, store.scenarios) },
    );
  }, [selectedId, store.scenarios]);

  const setCompareSide = useCallback((side: "left" | "right", id: SideId) => {
    setCompare((c) => ({ ...c, [side]: id }));
  }, []);

  return {
    selectedId,
    banner,
    manualLink,
    compare,
    selectChip,
    saveNew,
    saveChanges,
    rename,
    removeSelected,
    copyLink,
    toggleOverlay,
    toggleCompare,
    setCompareSide,
    dismissBanner: () => {
      setBanner(null);
      setManualLink(null);
    },
  };
}
