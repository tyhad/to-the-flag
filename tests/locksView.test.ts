/** Phase 2 Step 6: turning UI actions into a Scenario (pure). */
import { describe, expect, test } from "bun:test";
import { InvalidScenarioError, validateScenario, type Scenario, type SeasonState } from "../engine";
import {
  applyLockAction,
  describeScenarioError,
  type ActionResult,
  type LockAction,
  type LockContext,
} from "../web/viewModel/locks";
import { makeState } from "./helpers";

// After 3 races. AAA 75, BBB 54, CCC 45, DDD 36, EEE 20 (raced twice, not in round 3: inactive).
// Remaining: 4:sprint, 4:race, 5:race.
const state = (): SeasonState =>
  makeState({
    rounds: 5,
    completed: 3,
    sprints: [4],
    teams: { red: ["AAA", "BBB"], blue: ["CCC", "DDD", "EEE"] },
    results: {
      "1:race": ["AAA", "BBB", "CCC", "DDD", "EEE"],
      "2:race": ["AAA", "BBB", "CCC", "DDD", "EEE"],
      "3:race": ["AAA", "BBB", "CCC", "DDD"],
    },
  });

const EMPTY: Scenario = { locks: {} };
const ANY: LockContext = { assignable: null };
const ONLY_AAA_BBB: LockContext = { assignable: ["AAA", "BBB"] };

function run(scenario: Scenario, action: LockAction, context: LockContext = ANY): ActionResult {
  return applyLockAction(state(), scenario, action, context);
}

/** Apply actions in order; every step must succeed. */
function chain(actions: LockAction[], context: LockContext = ANY): Scenario {
  let scenario = EMPTY;
  for (const action of actions) {
    const result = run(scenario, action, context);
    expect(result.error).toBeNull();
    scenario = result.scenario;
  }
  return scenario;
}

describe("lock and unlock", () => {
  test("locking an open session adds an empty lock", () => {
    const r = run(EMPTY, { type: "lock", key: "4:race" });
    expect(r.error).toBeNull();
    expect(r.scenario).toEqual({ locks: { "4:race": { fixed: {} } } });
  });

  test("locking twice changes nothing and keeps the choices", () => {
    const once = chain([
      { type: "lock", key: "4:race" },
      { type: "assign", key: "4:race", driver: "BBB", position: 1 },
    ]);
    const again = run(once, { type: "lock", key: "4:race" });
    expect(again.error).toBeNull();
    expect(again.scenario).toBe(once);
  });

  test("unlocking removes the lock and everything chosen in it", () => {
    const locked = chain([
      { type: "lock", key: "4:race" },
      { type: "lock", key: "5:race" },
      { type: "assign", key: "4:race", driver: "BBB", position: 1 },
    ]);
    const r = run(locked, { type: "unlock", key: "4:race" });
    expect(r.error).toBeNull();
    expect(r.scenario).toEqual({ locks: { "5:race": { fixed: {} } } });
  });

  test("unlocking a session that is not locked is a quiet no-op", () => {
    const r = run(EMPTY, { type: "unlock", key: "4:race" });
    expect(r.error).toBeNull();
    expect(r.scenario).toBe(EMPTY);
  });

  test("a session that already ran cannot be locked, and the error is in plain words", () => {
    const r = run(EMPTY, { type: "lock", key: "2:race" });
    expect(r.scenario).toBe(EMPTY);
    expect(r.error).toBe("That session already has real results, so it cannot be locked.");
  });

  test("a session that is not on the calendar cannot be locked either", () => {
    const r = run(EMPTY, { type: "lock", key: "9:race" });
    expect(r.scenario).toBe(EMPTY);
    expect(r.error).toBe("That session has already run or is not on the calendar.");
  });
});

describe("assign a position", () => {
  const locked = chain([{ type: "lock", key: "4:race" }]);

  test("puts a driver in a slot", () => {
    const r = run(locked, { type: "assign", key: "4:race", driver: "BBB", position: 1 });
    expect(r.error).toBeNull();
    expect(r.scenario.locks["4:race"]?.fixed).toEqual({ BBB: 1 });
  });

  test("moving a driver to another slot replaces his old one", () => {
    const first = run(locked, { type: "assign", key: "4:race", driver: "BBB", position: 1 }).scenario;
    const r = run(first, { type: "assign", key: "4:race", driver: "BBB", position: 3 });
    expect(r.error).toBeNull();
    expect(r.scenario.locks["4:race"]?.fixed).toEqual({ BBB: 3 });
  });

  test("a slot takes one driver: a duplicate position is rejected and nothing changes", () => {
    const first = run(locked, { type: "assign", key: "4:race", driver: "BBB", position: 1 }).scenario;
    const r = run(first, { type: "assign", key: "4:race", driver: "AAA", position: 1 });
    expect(r.scenario).toBe(first);
    expect(r.error).toBe("P1 already belongs to BBB. Move BBB first.");
  });

  test("slots run P1 to P10 in a race and P1 to P8 in a sprint", () => {
    const both = chain([
      { type: "lock", key: "4:race" },
      { type: "lock", key: "4:sprint" },
    ]);
    expect(run(both, { type: "assign", key: "4:race", driver: "AAA", position: 10 }).error).toBeNull();
    expect(run(both, { type: "assign", key: "4:sprint", driver: "AAA", position: 8 }).error).toBeNull();
    expect(run(both, { type: "assign", key: "4:race", driver: "AAA", position: 11 }).error).toBe(
      "Races score points for P1 to P10.",
    );
    expect(run(both, { type: "assign", key: "4:sprint", driver: "AAA", position: 9 }).error).toBe(
      "Sprints score points for P1 to P8.",
    );
    expect(run(both, { type: "assign", key: "4:race", driver: "AAA", position: 0 }).error).not.toBeNull();
    expect(run(both, { type: "assign", key: "4:race", driver: "AAA", position: 1.5 }).error).not.toBeNull();
  });

  test("positions can only be chosen in a locked session", () => {
    const r = run(EMPTY, { type: "assign", key: "4:race", driver: "AAA", position: 1 });
    expect(r.scenario).toBe(EMPTY);
    expect(r.error).toBe("Lock this session first, then choose positions.");
  });

  test("contender mode: only contenders can be placed", () => {
    const r = run(locked, { type: "assign", key: "4:race", driver: "CCC", position: 1 }, ONLY_AAA_BBB);
    expect(r.scenario).toBe(locked);
    expect(r.error).toBe(
      "CCC is not one of your contenders. Add them to your contenders, or switch to all drivers.",
    );
    expect(run(locked, { type: "assign", key: "4:race", driver: "BBB", position: 1 }, ONLY_AAA_BBB).error).toBeNull();
  });

  test("full mode: any active driver can take any slot", () => {
    const r = run(locked, { type: "assign", key: "4:race", driver: "DDD", position: 2 }, ANY);
    expect(r.error).toBeNull();
    expect(r.scenario.locks["4:race"]?.fixed).toEqual({ DDD: 2 });
  });

  test("a driver who is not racing cannot be placed, and an unknown code is refused", () => {
    expect(run(locked, { type: "assign", key: "4:race", driver: "EEE", position: 1 }).error).toBe(
      "EEE is not racing any more and cannot score.",
    );
    expect(run(locked, { type: "assign", key: "4:race", driver: "ZZZ", position: 1 }).error).toBe(
      "ZZZ is not a driver in this season's data.",
    );
  });
});

describe("mark a driver out", () => {
  const locked = chain([{ type: "lock", key: "4:race" }]);

  test("out scores nothing and replaces any position the driver had", () => {
    const placed = run(locked, { type: "assign", key: "4:race", driver: "AAA", position: 1 }).scenario;
    const r = run(placed, { type: "out", key: "4:race", driver: "AAA" });
    expect(r.error).toBeNull();
    expect(r.scenario.locks["4:race"]?.fixed).toEqual({ AAA: "out" });
  });

  test("any active driver can be marked out, contender or not", () => {
    const r = run(locked, { type: "out", key: "4:race", driver: "DDD" }, ONLY_AAA_BBB);
    expect(r.error).toBeNull();
    expect(r.scenario.locks["4:race"]?.fixed).toEqual({ DDD: "out" });
  });

  test("a driver who is not racing cannot be marked out", () => {
    expect(run(locked, { type: "out", key: "4:race", driver: "EEE" }).error).toBe(
      "EEE is not racing any more and cannot score.",
    );
  });

  test("a driver who is out frees the slot he used to hold", () => {
    const placed = run(locked, { type: "assign", key: "4:race", driver: "AAA", position: 1 }).scenario;
    const out = run(placed, { type: "out", key: "4:race", driver: "AAA" }).scenario;
    expect(run(out, { type: "assign", key: "4:race", driver: "BBB", position: 1 }).error).toBeNull();
  });

  test("only in a locked session", () => {
    expect(run(EMPTY, { type: "out", key: "4:race", driver: "AAA" }).error).toBe(
      "Lock this session first, then choose positions.",
    );
  });
});

describe("unassign", () => {
  test("clears a driver's position or out mark; others stay", () => {
    const s = chain([
      { type: "lock", key: "4:race" },
      { type: "assign", key: "4:race", driver: "AAA", position: 1 },
      { type: "out", key: "4:race", driver: "BBB" },
    ]);
    expect(run(s, { type: "unassign", key: "4:race", driver: "AAA" }).scenario.locks["4:race"]?.fixed).toEqual({
      BBB: "out",
    });
    expect(run(s, { type: "unassign", key: "4:race", driver: "BBB" }).scenario.locks["4:race"]?.fixed).toEqual({
      AAA: 1,
    });
  });

  test("a driver with nothing set is a no-op", () => {
    const s = chain([{ type: "lock", key: "4:race" }]);
    expect(run(s, { type: "unassign", key: "4:race", driver: "AAA" }).scenario).toBe(s);
  });
});

describe("presets", () => {
  const base = chain([{ type: "lock", key: "4:race" }]);

  test("Contender wins puts the contender on P1", () => {
    const r = run(base, { type: "preset", key: "4:race", preset: "contenderWins", contender: "BBB" });
    expect(r.error).toBeNull();
    expect(r.scenario.locks["4:race"]?.fixed).toEqual({ BBB: 1 });
  });

  test("Contender wins takes P1 from whoever held it and keeps the other choices", () => {
    const s = chain([
      { type: "lock", key: "4:race" },
      { type: "assign", key: "4:race", driver: "AAA", position: 1 },
      { type: "assign", key: "4:race", driver: "CCC", position: 2 },
    ]);
    const r = run(s, { type: "preset", key: "4:race", preset: "contenderWins", contender: "BBB" });
    expect(r.error).toBeNull();
    expect(r.scenario.locks["4:race"]?.fixed).toEqual({ BBB: 1, CCC: 2 });
  });

  test("Contender wins moves a contender who already had another slot", () => {
    const s = chain([
      { type: "lock", key: "4:race" },
      { type: "assign", key: "4:race", driver: "BBB", position: 4 },
    ]);
    const r = run(s, { type: "preset", key: "4:race", preset: "contenderWins", contender: "BBB" });
    expect(r.scenario.locks["4:race"]?.fixed).toEqual({ BBB: 1 });
  });

  test("Contender wins needs a contender, and in contender mode an assignable one", () => {
    expect(run(base, { type: "preset", key: "4:race", preset: "contenderWins" }).error).toBe(
      "Pick a contender first.",
    );
    const r = run(base, { type: "preset", key: "4:race", preset: "contenderWins", contender: "CCC" }, ONLY_AAA_BBB);
    expect(r.scenario).toBe(base);
    expect(r.error).toMatch(/not one of your contenders/);
  });

  test("Rival out marks the rival out and drops any position he had", () => {
    const s = chain([
      { type: "lock", key: "4:race" },
      { type: "assign", key: "4:race", driver: "AAA", position: 1 },
      { type: "assign", key: "4:race", driver: "BBB", position: 2 },
    ]);
    const r = run(s, { type: "preset", key: "4:race", preset: "rivalOut", rival: "AAA" });
    expect(r.error).toBeNull();
    expect(r.scenario.locks["4:race"]?.fixed).toEqual({ AAA: "out", BBB: 2 });
  });

  test("Rival out needs a rival", () => {
    expect(run(base, { type: "preset", key: "4:race", preset: "rivalOut" }).error).toBe("Pick a rival first.");
  });

  test("Clear empties the session but keeps it locked", () => {
    const s = chain([
      { type: "lock", key: "4:race" },
      { type: "assign", key: "4:race", driver: "AAA", position: 1 },
      { type: "out", key: "4:race", driver: "BBB" },
    ]);
    const r = run(s, { type: "preset", key: "4:race", preset: "clear" });
    expect(r.error).toBeNull();
    expect(r.scenario).toEqual({ locks: { "4:race": { fixed: {} } } });
  });

  test("presets work only in a locked session", () => {
    expect(run(EMPTY, { type: "preset", key: "4:race", preset: "clear" }).error).toBe(
      "Lock this session first, then choose positions.",
    );
  });
});

describe("reset", () => {
  test("removes every lock", () => {
    const s = chain([
      { type: "lock", key: "4:race" },
      { type: "lock", key: "5:race" },
    ]);
    expect(run(s, { type: "reset" }).scenario).toEqual({ locks: {} });
  });

  test("with nothing locked it is a no-op", () => {
    expect(run(EMPTY, { type: "reset" }).scenario).toBe(EMPTY);
  });
});

describe("every accepted scenario is valid", () => {
  test("a long run of actions always passes validateScenario", () => {
    const actions: LockAction[] = [
      { type: "lock", key: "4:sprint" },
      { type: "lock", key: "4:race" },
      { type: "lock", key: "5:race" },
      { type: "assign", key: "4:sprint", driver: "BBB", position: 1 },
      { type: "assign", key: "4:sprint", driver: "AAA", position: 2 },
      { type: "assign", key: "4:race", driver: "AAA", position: 1 },
      { type: "preset", key: "4:race", preset: "contenderWins", contender: "BBB" },
      { type: "preset", key: "5:race", preset: "rivalOut", rival: "AAA" },
      { type: "out", key: "5:race", driver: "DDD" },
      { type: "assign", key: "5:race", driver: "BBB", position: 1 },
      { type: "unassign", key: "4:sprint", driver: "AAA" },
    ];
    let scenario = EMPTY;
    for (const action of actions) {
      scenario = run(scenario, action).scenario;
      expect(() => validateScenario(state(), scenario)).not.toThrow();
    }
    expect(scenario.locks["4:race"]?.fixed).toEqual({ BBB: 1 });
    expect(scenario.locks["5:race"]?.fixed).toEqual({ AAA: "out", DDD: "out", BBB: 1 });
  });

  test("actions never change the scenario they were given", () => {
    const s = chain([
      { type: "lock", key: "4:race" },
      { type: "assign", key: "4:race", driver: "AAA", position: 1 },
    ]);
    const before = JSON.stringify(s);
    run(s, { type: "assign", key: "4:race", driver: "BBB", position: 2 });
    run(s, { type: "assign", key: "4:race", driver: "BBB", position: 1 });
    run(s, { type: "unlock", key: "4:race" });
    run(s, { type: "reset" });
    run(s, { type: "preset", key: "4:race", preset: "clear" });
    expect(JSON.stringify(s)).toBe(before);
  });

  test("other sessions are left alone when one changes", () => {
    const s = chain([
      { type: "lock", key: "4:race" },
      { type: "lock", key: "5:race" },
      { type: "assign", key: "5:race", driver: "AAA", position: 3 },
    ]);
    const r = run(s, { type: "assign", key: "4:race", driver: "BBB", position: 1 });
    expect(r.scenario.locks["5:race"]).toEqual({ fixed: { AAA: 3 } });
  });
});

describe("describeScenarioError", () => {
  const codes = [
    "session_not_remaining",
    "session_has_results",
    "unknown_driver",
    "inactive_driver",
    "position_out_of_zone",
    "duplicate_position",
    "invalid_tier",
  ] as const;

  test("every engine error code reads as plain words", () => {
    for (const code of codes) {
      const message = describeScenarioError(new InvalidScenarioError(code, `${code}: 4:race AAA internal text`));
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toMatch(/internal text|4:race|_/);
      expect(message.endsWith(".")).toBe(true);
    }
  });
});
