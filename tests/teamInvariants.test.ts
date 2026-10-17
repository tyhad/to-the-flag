/**
 * Phase 5 done-criterion 2: the invariants of the constructors' solver hold on many scenarios, not only on hand-made ones.
 * Seeded random scenarios on the real Round 16 season (some random locks, some full sweeps by one team).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { activeDrivers } from "../engine/index";
import { parseSessionKey, remainingSessions } from "../engine/sessions";
import { validateScenario } from "../engine/scenario";
import { createRng, type Rng } from "../engine/rng";
import { zoneSize } from "../engine/points";
import { computeConstructorStandings } from "../engine/standings";
import { teamCars, teamWitnessScenario } from "../engine/teams";
import { solveWcc } from "../engine/teamSolver";
import { teamStatus } from "../engine/teamStatus";
import type { Scenario, SeasonState } from "../engine/types";

const real = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "season-2026-r16.json"), "utf8")) as SeasonState;

function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

function randomScenario(state: SeasonState, rng: Rng): Scenario {
  const sessions = remainingSessions(state);
  const drivers = activeDrivers(state);
  const locks: Scenario["locks"] = {};

  if (rng.next() < 0.3) {
    // one team takes the top two places in every session it is given (a sweep): reaches clinched and eliminated
    const teams = [...teamCars(state)].filter(([, cars]) => cars.length === 2);
    const pick = teams[Math.floor(rng.next() * teams.length)];
    const [a, b] = pick?.[1] ?? [];
    if (a && b) {
      for (const key of sessions) if (rng.next() < 0.85) locks[key] = { fixed: { [a]: 1, [b]: 2 } };
    }
    return { locks };
  }

  for (const key of sessions) {
    if (rng.next() < 0.5) continue;
    const zone = zoneSize(parseSessionKey(key).kind);
    const order = shuffled(drivers, rng);
    const taken = 1 + Math.floor(rng.next() * zone);
    const fixed: Record<string, number | "out"> = {};
    order.slice(0, taken).forEach((d, i) => {
      fixed[d] = i + 1;
    });
    for (const d of order.slice(taken, taken + Math.floor(rng.next() * 3))) fixed[d] = "out";
    locks[key] = { fixed };
  }
  return { locks };
}

describe("constructors' solver: invariants on random scenarios (Round 16 season)", () => {
  const rng = createRng(2026);
  const scenarios = Array.from({ length: 30 }, () => randomScenario(real, rng));

  test("the generated scenarios are valid, and they are varied", () => {
    for (const s of scenarios) expect(() => validateScenario(real, s)).not.toThrow();
    const statuses = new Set(scenarios.flatMap((s) => teamStatus(real, s).map((r) => r.status)));
    expect(statuses.has("clinched")).toBe(true);
    expect(statuses.has("alive")).toBe(true);
    expect(statuses.has("eliminated")).toBe(true);
  });

  test("someone can always still be champion; clinched means every other team is eliminated", () => {
    for (const s of scenarios) {
      const rows = teamStatus(real, s);
      const contenders = rows.filter((r) => r.status !== "eliminated");
      expect(contenders.length).toBeGreaterThanOrEqual(1);
      const clinched = rows.filter((r) => r.status === "clinched");
      expect(clinched.length).toBeLessThanOrEqual(1);
      for (const c of clinched) expect(contenders).toEqual([c]);
      if (contenders.length === 1) expect(contenders[0]?.status).toBe("clinched");
    }
  });

  test("with every session locked, exactly the table leader is left, and it has clinched", () => {
    for (const s of scenarios) {
      if (remainingSessions(real).some((key) => !(key in s.locks))) continue;
      const rows = teamStatus(real, s);
      const left = rows.filter((r) => r.status !== "eliminated");
      expect(left.map((r) => r.status)).toEqual(["clinched"]);
      expect(left[0]?.team).toBe(computeConstructorStandings(real, s)[0]?.id as string);
    }
  });

  test("an eliminated team has null path fields; otherwise easiest is valid, keeps the locks and ranks the team first", () => {
    for (const s of scenarios) {
      for (const row of teamStatus(real, s)) {
        const r = solveWcc(real, row.team, s);
        expect(r.verdict).toBe(row.status);
        if (row.status === "eliminated") {
          expect([r.pointsNeeded, r.difficulty, r.minOneTwos, r.easiest]).toEqual([null, null, null, null]);
          expect(r.rivalBudgets).toEqual([]);
          continue;
        }
        const easiest = r.easiest as Scenario;
        expect(easiest).not.toBeNull();
        expect(() => validateScenario(real, easiest)).not.toThrow();
        expect(computeConstructorStandings(real, easiest)[0]?.id).toBe(row.team);
        for (const [key, lock] of Object.entries(s.locks)) {
          expect(easiest.locks[key as keyof typeof easiest.locks]).toEqual(lock);
        }
        expect(r.pointsNeeded).toBeGreaterThanOrEqual(0);
        expect(r.difficulty).toBeGreaterThanOrEqual(0);
        expect(r.difficulty).toBeLessThanOrEqual(1);
      }
    }
  });

  test("minOneTwos is minimal: with one one-two fewer the team does not rank first", () => {
    let checked = 0;
    for (const s of scenarios) {
      for (const row of teamStatus(real, s)) {
        if (row.status !== "alive") continue;
        const r = solveWcc(real, row.team, s);
        if (!r.minOneTwos || r.minOneTwos.total === 0) continue;
        expect(r.minOneTwos.races + r.minOneTwos.sprints).toBe(r.minOneTwos.total);

        // the same shape as the solver's candidates: one-twos in the first w open sessions (races, then sprints)
        const open = remainingSessions(real).filter((key) => !(key in s.locks));
        const order = [...open.filter((k) => k.endsWith(":race")), ...open.filter((k) => k.endsWith(":sprint"))];
        const oneTwo = teamWitnessScenario(real, s, row.team, 0);
        const behind = teamWitnessScenario(real, s, row.team, 1);
        const fewer = r.minOneTwos.total - 1;
        const locks: Scenario["locks"] = { ...s.locks };
        order.forEach((key, i) => {
          const lock = (i < fewer ? oneTwo : behind).locks[key];
          if (lock) locks[key] = lock;
        });
        expect(computeConstructorStandings(real, { locks })[0]?.id).not.toBe(row.team);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
