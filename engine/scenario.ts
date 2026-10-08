/** Scenario validation (decision g and the locking rules). Pure. */
import { zoneSize } from "./points";
import { parseSessionKey, remainingSessions } from "./sessions";
import type { Scenario, SeasonState } from "./types";

export type InvalidScenarioCode =
  | "session_not_remaining"
  | "session_has_results"
  | "unknown_driver"
  | "inactive_driver"
  | "position_out_of_zone"
  | "duplicate_position"
  | "invalid_tier";

export class InvalidScenarioError extends Error {
  constructor(
    readonly code: InvalidScenarioCode,
    message: string,
  ) {
    super(message);
    this.name = "InvalidScenarioError";
  }
}

const TIERS: readonly string[] = ["lt25", "ge25", "ge50", "full"];

/** Throws InvalidScenarioError on the first problem found. Returns nothing when the scenario is valid. */
export function validateScenario(state: SeasonState, scenario: Scenario): void {
  const remaining = new Set<string>(remainingSessions(state));
  const hasResults = new Set<string>(state.results.map((r) => `${r.round}:${r.kind}`));
  const drivers = new Map(state.drivers.map((d) => [d.code, d]));

  for (const [key, lock] of Object.entries(scenario.locks)) {
    let kind;
    try {
      kind = parseSessionKey(key).kind;
    } catch {
      throw new InvalidScenarioError("session_not_remaining", `"${key}" is not a valid session key`);
    }
    if (hasResults.has(key)) {
      throw new InvalidScenarioError("session_has_results", `${key} already has results and cannot be locked`);
    }
    if (!remaining.has(key)) {
      throw new InvalidScenarioError("session_not_remaining", `${key} is not a remaining session`);
    }
    if (lock.tier !== undefined && !TIERS.includes(lock.tier)) {
      throw new InvalidScenarioError("invalid_tier", `${key}: unknown tier "${String(lock.tier)}"`);
    }

    const zone = zoneSize(kind);
    const taken = new Map<number, string>();
    for (const [driver, fixed] of Object.entries(lock.fixed)) {
      const info = drivers.get(driver);
      if (!info) throw new InvalidScenarioError("unknown_driver", `${key}: unknown driver ${driver}`);
      if (!info.active) {
        throw new InvalidScenarioError("inactive_driver", `${key}: driver ${driver} is not active and cannot score`);
      }
      if (fixed === "out") continue;
      if (typeof fixed !== "number" || !Number.isInteger(fixed) || fixed < 1 || fixed > zone) {
        throw new InvalidScenarioError(
          "position_out_of_zone",
          `${key}: ${driver} position ${String(fixed)} is outside the points zone (1-${zone}); use "out" instead`,
        );
      }
      const other = taken.get(fixed);
      if (other !== undefined) {
        throw new InvalidScenarioError(
          "duplicate_position",
          `${key}: ${driver} and ${other} are both locked to position ${fixed}`,
        );
      }
      taken.set(fixed, driver);
    }
  }
}
