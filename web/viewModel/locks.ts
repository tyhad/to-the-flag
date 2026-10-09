/**
 * UI actions to Scenario (DESIGN.md section 6, session cards and position picker). Pure.
 *
 * `applyLockAction` never mutates its input. It returns the next scenario, or, when the action is not
 * allowed, the same scenario object plus a plain-words error. Every scenario it returns has passed
 * `validateScenario`, so the standings code can trust it.
 */
import {
  InvalidScenarioError,
  parseSessionKey,
  validateScenario,
  zoneSize,
  type Scenario,
  type SeasonState,
  type SessionKey,
} from "../../engine";

export type LockPreset = "contenderWins" | "rivalOut" | "clear";

export type LockAction =
  | { type: "lock"; key: SessionKey }
  | { type: "unlock"; key: SessionKey }
  /** Put a driver in a position. A driver who already has one is moved. A taken position is refused. */
  | { type: "assign"; key: SessionKey; driver: string; position: number }
  /** Clear a driver's position or out mark. */
  | { type: "unassign"; key: SessionKey; driver: string }
  /** Mark a driver out: no points. Replaces any position the driver had. */
  | { type: "out"; key: SessionKey; driver: string }
  | { type: "preset"; key: SessionKey; preset: LockPreset; contender?: string; rival?: string }
  /** Remove every lock. */
  | { type: "reset" };

export interface LockContext {
  /**
   * Drivers the owner may place in a position (contender mode). null means any active driver (full mode).
   * Marking a driver out is allowed for any active driver either way.
   */
  assignable: readonly string[] | null;
}

export interface ActionResult {
  scenario: Scenario;
  /** Plain-words reason the action was refused, or null. */
  error: string | null;
}

const LOCK_FIRST = "Lock this session first, then choose positions.";

/** The engine's error codes, in words an owner can act on. */
export function describeScenarioError(error: InvalidScenarioError): string {
  switch (error.code) {
    case "session_not_remaining":
      return "That session has already run or is not on the calendar.";
    case "session_has_results":
      return "That session already has real results, so it cannot be locked.";
    case "unknown_driver":
      return "One of those drivers is not in this season's data.";
    case "inactive_driver":
      return "A driver who is not racing any more cannot score.";
    case "position_out_of_zone":
      return "Only points positions can be set: P1 to P10 in races, P1 to P8 in sprints. Use Out for anyone else.";
    case "duplicate_position":
      return "Two drivers cannot share a position.";
    case "invalid_tier":
      return "That race distance is not recognised.";
  }
}

function driverProblem(state: SeasonState, driver: string): string | null {
  const info = state.drivers.find((d) => d.code === driver);
  if (!info) return `${driver} is not a driver in this season's data.`;
  if (!info.active) return `${driver} is not racing any more and cannot score.`;
  return null;
}

function notAssignable(context: LockContext, driver: string): string | null {
  if (context.assignable === null || context.assignable.includes(driver)) return null;
  return `${driver} is not one of your contenders. Add them to your contenders, or switch to all drivers.`;
}

/** The next scenario, or a plain-words refusal. Not yet checked by validateScenario. */
function step(state: SeasonState, scenario: Scenario, action: LockAction, context: LockContext): Scenario | string {
  if (action.type === "reset") {
    return Object.keys(scenario.locks).length === 0 ? scenario : { locks: {} };
  }

  const { key } = action;
  const lock = scenario.locks[key];

  if (action.type === "lock") {
    return lock ? scenario : { locks: { ...scenario.locks, [key]: { fixed: {} } } };
  }
  if (action.type === "unlock") {
    if (!lock) return scenario;
    const { [key]: _removed, ...rest } = scenario.locks;
    return { locks: rest };
  }

  if (!lock) return LOCK_FIRST;
  const withFixed = (fixed: Record<string, number | "out">): Scenario => ({
    locks: { ...scenario.locks, [key]: { ...lock, fixed } },
  });

  switch (action.type) {
    case "assign": {
      const problem = driverProblem(state, action.driver);
      if (problem) return problem;
      const kind = parseSessionKey(key).kind;
      const zone = zoneSize(kind);
      const { position, driver } = action;
      if (!Number.isInteger(position) || position < 1 || position > zone) {
        return `${kind === "race" ? "Races" : "Sprints"} score points for P1 to P${zone}.`;
      }
      const blocked = notAssignable(context, driver);
      if (blocked) return blocked;
      const holder = Object.entries(lock.fixed).find(([d, p]) => p === position && d !== driver)?.[0];
      if (holder) return `P${position} already belongs to ${holder}. Move ${holder} first.`;
      return withFixed({ ...lock.fixed, [driver]: position });
    }
    case "out": {
      const problem = driverProblem(state, action.driver);
      if (problem) return problem;
      return withFixed({ ...lock.fixed, [action.driver]: "out" });
    }
    case "unassign": {
      if (!(action.driver in lock.fixed)) return scenario;
      const { [action.driver]: _removed, ...rest } = lock.fixed;
      return withFixed(rest);
    }
    case "preset": {
      if (action.preset === "clear") {
        return Object.keys(lock.fixed).length === 0 ? scenario : withFixed({});
      }
      if (action.preset === "contenderWins") {
        const driver = action.contender;
        if (!driver) return "Pick a contender first.";
        const problem = driverProblem(state, driver) ?? notAssignable(context, driver);
        if (problem) return problem;
        const kept = Object.fromEntries(Object.entries(lock.fixed).filter(([d, p]) => d !== driver && p !== 1));
        return withFixed({ ...kept, [driver]: 1 });
      }
      const rival = action.rival;
      if (!rival) return "Pick a rival first.";
      const problem = driverProblem(state, rival);
      if (problem) return problem;
      return withFixed({ ...lock.fixed, [rival]: "out" });
    }
  }
}

export function applyLockAction(
  state: SeasonState,
  scenario: Scenario,
  action: LockAction,
  context: LockContext,
): ActionResult {
  const next = step(state, scenario, action, context);
  if (typeof next === "string") return { scenario, error: next };
  if (next === scenario) return { scenario, error: null };
  try {
    validateScenario(state, next);
  } catch (error) {
    if (error instanceof InvalidScenarioError) return { scenario, error: describeScenarioError(error) };
    throw error;
  }
  return { scenario: next, error: null };
}
