/**
 * Contenders: the drivers the owner follows in the title fight (DESIGN.md section 6). Pure.
 * Positions can only be given to contenders in contender mode.
 */
import {
  activeDrivers,
  computeDriverStandings,
  driverStatus,
  type Scenario,
  type SeasonState,
} from "../../engine";

export const DEFAULT_CONTENDER_COUNT = 5;
export const MAX_CONTENDERS = 8;

/** Active drivers who can still win the title, in table order. Uses the real results, not the locks. */
export function contenderPool(state: SeasonState): string[] {
  const alive = new Set(driverStatus(state).filter((s) => s.status !== "eliminated").map((s) => s.driver));
  const active = new Set(activeDrivers(state));
  return computeDriverStandings(state)
    .map((row) => row.id)
    .filter((id) => alive.has(id) && active.has(id));
}

/** The top five of the pool. */
export function defaultContenders(state: SeasonState): string[] {
  return contenderPool(state).slice(0, DEFAULT_CONTENDER_COUNT);
}

export interface ToggleResult {
  contenders: string[];
  /** Plain-words reason nothing changed, or null. When set, `contenders` is the same array you passed in. */
  error: string | null;
}

/** Add a driver to the contenders, or remove one. Keeps table order, at least one, at most eight. */
export function toggleContender(state: SeasonState, current: readonly string[], driver: string): ToggleResult {
  const same = current as string[];
  if (current.includes(driver)) {
    if (current.length <= 1) return { contenders: same, error: "Keep at least one contender." };
    return { contenders: current.filter((d) => d !== driver), error: null };
  }
  const pool = contenderPool(state);
  if (!pool.includes(driver)) {
    return { contenders: same, error: `${driver} can no longer win the title, so they cannot be a contender.` };
  }
  if (current.length >= MAX_CONTENDERS) {
    return { contenders: same, error: `You can follow up to ${MAX_CONTENDERS} contenders.` };
  }
  const order = new Map(pool.map((d, i) => [d, i]));
  const next = [...current, driver].sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999));
  return { contenders: next, error: null };
}

/** The contender the presets work on by default: the driver in second place, if followed, else the first contender. */
export function defaultFocus(state: SeasonState, contenders: readonly string[]): string | null {
  const second = computeDriverStandings(state)[1]?.id;
  if (second !== undefined && contenders.includes(second)) return second;
  return contenders[0] ?? null;
}

/** The rival for "Rival out": the best-placed active driver in the projected table other than the focus. */
export function defaultRival(state: SeasonState, scenario: Scenario | undefined, focus: string | null): string | null {
  const active = new Set(activeDrivers(state));
  const row = computeDriverStandings(state, scenario).find((r) => active.has(r.id) && r.id !== focus);
  return row?.id ?? null;
}

/** A list of drivers from outside (a shared link, a saved scenario) made safe: only drivers who can still win, in table order, once each, at most eight. */
export function sanitizeContenders(state: SeasonState, wanted: readonly string[]): string[] {
  const pool = contenderPool(state);
  const keep = new Set(wanted);
  return pool.filter((d) => keep.has(d)).slice(0, MAX_CONTENDERS);
}
