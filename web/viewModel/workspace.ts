/**
 * Workspace state for the sessions rail: the scenario plus the settings that shape how it is edited.
 * A pure reducer, so every rule is testable without a DOM. The standings read `scenario` from here.
 */
import { InvalidScenarioError, validateScenario, type Scenario, type SeasonState, type SessionKey } from "../../engine";
import { defaultContenders, defaultFocus, defaultRival, toggleContender } from "./contenders";
import { applyLockAction, describeScenarioError, type LockContext, type LockPreset } from "./locks";

/** "contenders": only contenders can take a position. "all": any active driver can. */
export type WorkspaceMode = "contenders" | "all";

export interface Notice {
  /** Where to show the message: under one session card, at the contender list, or in the Possible? panel. */
  scope: SessionKey | "contenders" | "path";
  message: string;
}

export interface Workspace {
  scenario: Scenario;
  contenders: string[];
  mode: WorkspaceMode;
  /** The contender the "Contender wins" preset works on. Always one of `contenders`, or null. */
  focus: string | null;
  notice: Notice | null;
}

export type WorkspaceMessage =
  | { type: "lock"; key: SessionKey }
  | { type: "unlock"; key: SessionKey }
  | { type: "assign"; key: SessionKey; driver: string; position: number }
  | { type: "unassign"; key: SessionKey; driver: string }
  | { type: "out"; key: SessionKey; driver: string }
  | { type: "preset"; key: SessionKey; preset: LockPreset }
  | { type: "reset" }
  /** Replace the scenario with a ready-made one, such as the easiest path. It must pass validateScenario. */
  | { type: "loadScenario"; scenario: Scenario }
  | { type: "setMode"; mode: WorkspaceMode }
  | { type: "toggleContender"; driver: string }
  | { type: "setFocus"; driver: string }
  | { type: "dismissNotice" };

export function initialWorkspace(state: SeasonState): Workspace {
  const contenders = defaultContenders(state);
  return {
    scenario: { locks: {} },
    contenders,
    mode: "contenders",
    focus: defaultFocus(state, contenders),
    notice: null,
  };
}

/** Who the presets point at right now: the focus contender and the best-placed other driver. */
export function presetTargets(state: SeasonState, ws: Workspace): { contender: string | null; rival: string | null } {
  return { contender: ws.focus, rival: defaultRival(state, ws.scenario, ws.focus) };
}

export function lockContext(ws: Pick<Workspace, "mode" | "contenders">): LockContext {
  return { assignable: ws.mode === "all" ? null : ws.contenders };
}

export function workspaceReducer(state: SeasonState, ws: Workspace, message: WorkspaceMessage): Workspace {
  switch (message.type) {
    case "setMode":
      return { ...ws, mode: message.mode, notice: null };

    case "setFocus":
      return ws.contenders.includes(message.driver) ? { ...ws, focus: message.driver, notice: null } : ws;

    case "dismissNotice":
      return ws.notice ? { ...ws, notice: null } : ws;

    case "toggleContender": {
      const result = toggleContender(state, ws.contenders, message.driver);
      if (result.error) return { ...ws, notice: { scope: "contenders", message: result.error } };
      const focus = result.contenders.includes(ws.focus ?? "") ? ws.focus : defaultFocus(state, result.contenders);
      return { ...ws, contenders: result.contenders, focus, notice: null };
    }

    case "loadScenario": {
      try {
        validateScenario(state, message.scenario);
      } catch (error) {
        if (error instanceof InvalidScenarioError) {
          return { ...ws, notice: { scope: "path", message: describeScenarioError(error) } };
        }
        throw error;
      }
      return { ...ws, scenario: message.scenario, notice: null };
    }

    case "reset": {
      const result = applyLockAction(state, ws.scenario, { type: "reset" }, lockContext(ws));
      return { ...ws, scenario: result.scenario, notice: null };
    }

    case "preset": {
      const { contender, rival } = presetTargets(state, ws);
      const action = { ...message, ...(contender ? { contender } : {}), ...(rival ? { rival } : {}) };
      return afterLockAction(ws, applyLockAction(state, ws.scenario, action, lockContext(ws)), message.key);
    }

    default:
      return afterLockAction(ws, applyLockAction(state, ws.scenario, message, lockContext(ws)), message.key);
  }
}

function afterLockAction(
  ws: Workspace,
  result: { scenario: Scenario; error: string | null },
  key: SessionKey,
): Workspace {
  if (result.error) return { ...ws, notice: { scope: key, message: result.error } };
  return { ...ws, scenario: result.scenario, notice: null };
}
