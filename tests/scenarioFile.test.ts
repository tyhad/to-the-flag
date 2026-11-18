/** The scenario file, pure part (Phase 10, Step 3, D58): what goes out, and what a file may bring in. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SeasonState } from "../engine";
import {
  buildScenarioFile,
  type ExportableScenario,
  exportFileName,
  FILE_FORMAT,
  MAX_FILE_BYTES,
  MAX_NAME_LENGTH,
  MAX_SCENARIOS,
  parseScenarioFile,
  uniqueName,
  type ScenarioFile,
} from "../api/scenarioFile";

const state = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "season-2026-r16.json"), "utf8")) as SeasonState;

const good = (over: Record<string, unknown> = {}) => ({
  name: "Norris wins both",
  season: 2026,
  asOfRound: 16,
  locks: { "17:race": { fixed: { NOR: 1 } }, "17:sprint": { fixed: { NOR: 1, PIA: "out" }, tier: "full" } },
  contenders: ["NOR", "PIA"],
  ...over,
});
const file = (scenarios: unknown[], over: Record<string, unknown> = {}) =>
  JSON.stringify({ format: FILE_FORMAT, version: 1, scenarios, ...over });
const parse = (text: string, names: string[] = []) => parseScenarioFile(text, state, names);

describe("buildScenarioFile", () => {
  const stored: (ExportableScenario & Record<string, unknown>)[] = [
    {
      id: "a-secret-id",
      name: "One",
      season: 2026,
      asOfRound: 16,
      locks: { "17:race": { fixed: { NOR: 1 } } },
      contenders: ["NOR"],
      valid: true,
      stale: false,
      createdAt: "2026-07-01T10:00:00.000Z",
      updatedAt: "2026-07-02T10:00:00.000Z",
    },
    { id: "b", name: "Old season", season: 2025, asOfRound: 24, locks: {}, valid: false, stale: true, createdAt: "x", updatedAt: "y" },
    { id: "c", name: "No contenders", season: 2026, asOfRound: 15, locks: {}, valid: true, stale: true, createdAt: "x", updatedAt: "y" },
  ];

  test("has the format and version, and the scenarios of this season only, with five fields each", () => {
    const out = buildScenarioFile(stored, state);
    expect(out.format).toBe("to-the-flag-scenarios");
    expect(out.version).toBe(1);
    expect(out.scenarios).toEqual([
      { name: "One", season: 2026, asOfRound: 16, locks: { "17:race": { fixed: { NOR: 1 } } }, contenders: ["NOR"] },
      { name: "No contenders", season: 2026, asOfRound: 15, locks: {} },
    ]);
  });

  test("carries no id, timestamp, token, address or path", () => {
    const text = JSON.stringify(buildScenarioFile(stored, state));
    for (const leak of ["a-secret-id", "createdAt", "updatedAt", "2026-07", "id\"", "token", "http", "127.0.0.1", "sqlite", "\\\\", "valid", "stale"]) {
      expect(text).not.toContain(leak);
    }
  });

  test("an empty list is a valid file", () => {
    expect(buildScenarioFile([], state).scenarios).toEqual([]);
  });

  test("the file name has the season and the round", () => {
    expect(exportFileName(state)).toBe("to-the-flag-scenarios-2026-r16.json");
  });
});

describe("parseScenarioFile: accepted", () => {
  test("a good file comes back as it was, with no extra fields", () => {
    const r = parse(file([good({ id: "ignored", createdAt: "ignored", token: "x" })]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.skipped).toEqual([]);
    expect(r.accepted).toEqual([good()] as never);
  });

  test("a scenario made at an earlier round is kept (it is only stale)", () => {
    const r = parse(file([good({ asOfRound: 14 })]));
    expect(r.ok && r.accepted[0]!.asOfRound).toBe(14);
  });

  test("no contenders is fine", () => {
    const { contenders: _drop, ...rest } = good();
    const r = parse(file([rest]));
    expect(r.ok && r.accepted[0]!.contenders).toBeUndefined();
  });

  test("an empty list imports nothing and says nothing is wrong", () => {
    expect(parse(file([]))).toEqual({ ok: true, accepted: [], skipped: [] });
  });
});

describe("parseScenarioFile: the whole file is refused", () => {
  test.each([
    ["not JSON", "{ nope", "not_json"],
    ["a list instead of an object", "[]", "wrong_format"],
    ["null", "null", "wrong_format"],
    ["a number", "7", "wrong_format"],
    ["another format", JSON.stringify({ format: "other", version: 1, scenarios: [] }), "wrong_format"],
    ["no format", JSON.stringify({ version: 1, scenarios: [] }), "wrong_format"],
    ["version 2", file([], { version: 2 }), "unsupported_version"],
    ["version as text", file([], { version: "1" }), "unsupported_version"],
    ["no version", JSON.stringify({ format: FILE_FORMAT, scenarios: [] }), "unsupported_version"],
    ["scenarios as an object", file([], { scenarios: {} }), "wrong_type"],
    ["scenarios as text", file([], { scenarios: "x" }), "wrong_type"],
    ["no scenarios", JSON.stringify({ format: FILE_FORMAT, version: 1 }), "wrong_type"],
  ])("%s", (_label, text, code) => {
    const r = parse(text);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe(code as never);
      expect(r.message.length).toBeGreaterThan(10);
    }
  });

  test("more than 200 scenarios", () => {
    const many = Array.from({ length: MAX_SCENARIOS + 1 }, (_, i) => good({ name: `S${i}` }));
    const r = parse(file(many));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("too_many");
    expect(parse(file(many.slice(0, MAX_SCENARIOS))).ok).toBe(true);
  });

  test("a file over 1 MB, before it is parsed", () => {
    const text = file([good()], { padding: "x".repeat(MAX_FILE_BYTES) });
    const r = parse(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("too_large");
  });

  test("the limit counts bytes, not characters", () => {
    const r = parse(file([good()], { padding: "é".repeat(MAX_FILE_BYTES / 2 + 10) }));
    expect(r.ok).toBe(false);
  });
});

describe("parseScenarioFile: one scenario is skipped, with a reason", () => {
  const skippedReason = (entry: unknown) => {
    const r = parse(file([entry]));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("refused");
    expect(r.accepted).toEqual([]);
    expect(r.skipped).toHaveLength(1);
    return r.skipped[0]!.reason;
  };

  test("another season", () => expect(skippedReason(good({ season: 2025 }))).toContain("season 2025"));
  test("a round after the data", () => expect(skippedReason(good({ asOfRound: 17 }))).toContain("round 17"));
  test("a negative round", () => expect(skippedReason(good({ asOfRound: -1 }))).toContain("round"));
  test("season as text", () => expect(skippedReason(good({ season: "2026" }))).toContain("season"));
  test("season as a decimal", () => expect(skippedReason(good({ season: 2026.5 }))).toContain("season"));
  test("no name", () => expect(skippedReason(good({ name: undefined }))).toContain("no name"));
  test("a blank name", () => expect(skippedReason(good({ name: "   " }))).toContain("no name"));
  test("a name that is not text", () => expect(skippedReason(good({ name: 5 }))).toContain("no name"));
  test("a name that is too long", () => expect(skippedReason(good({ name: "x".repeat(MAX_NAME_LENGTH + 1) }))).toContain("longer"));
  test("locks that are a list", () => expect(skippedReason(good({ locks: [] }))).toContain("locks"));
  test("locks missing", () => expect(skippedReason(good({ locks: undefined }))).toContain("locks"));
  test("a lock that is not an object", () => expect(skippedReason(good({ locks: { "17:race": 1 } }))).toContain("17:race"));
  test("a lock with no fixed", () => expect(skippedReason(good({ locks: { "17:race": {} } }))).toContain("shape"));
  test("a position that is text", () => expect(skippedReason(good({ locks: { "17:race": { fixed: { NOR: "1" } } } }))).toContain("NOR"));
  test("a position with decimals", () => expect(skippedReason(good({ locks: { "17:race": { fixed: { NOR: 1.5 } } } }))).toContain("NOR"));
  test("a position outside the points zone", () => expect(skippedReason(good({ locks: { "17:race": { fixed: { NOR: 11 } } } }))).toContain("outside"));
  test("two drivers in one place", () => expect(skippedReason(good({ locks: { "17:race": { fixed: { NOR: 1, PIA: 1 } } } }))).toContain("both"));
  test("an unknown driver", () => expect(skippedReason(good({ locks: { "17:race": { fixed: { ZZZ: 1 } } } }))).toContain("ZZZ"));
  test("a session that already has results", () => expect(skippedReason(good({ locks: { "16:race": { fixed: { NOR: 1 } } } }))).toContain("16:race"));
  test("a session key that is not a key", () => expect(skippedReason(good({ locks: { nope: { fixed: {} } } }))).toContain("nope"));
  test("an unknown tier", () => expect(skippedReason(good({ locks: { "17:race": { fixed: {}, tier: "huge" } } }))).toContain("tier"));
  test("contenders as text", () => expect(skippedReason(good({ contenders: "NOR" }))).toContain("contenders"));
  test("contenders with a number", () => expect(skippedReason(good({ contenders: [1] }))).toContain("contenders"));
  test("an unknown contender", () => expect(skippedReason(good({ contenders: ["ZZZ"] }))).toContain("ZZZ"));
  test("an entry that is not an object", () => expect(skippedReason("text")).toContain("not a scenario"));
  test("an entry that is null", () => expect(skippedReason(null)).toContain("not a scenario"));
  test("an entry that is a list", () => expect(skippedReason([])).toContain("not a scenario"));

  test("a __proto__ key anywhere", () => {
    const text = `{"format":"${FILE_FORMAT}","version":1,"scenarios":[{"name":"P","season":2026,"asOfRound":16,"locks":{"17:race":{"fixed":{"__proto__":1}}}}]}`;
    const r = parse(text);
    expect(r.ok && r.skipped[0]!.reason).toContain("not allowed");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  test("a constructor key, at the top and deep", () => {
    expect(skippedReason({ ...good(), constructor: { prototype: {} } })).toContain("not allowed");
    expect(skippedReason(good({ locks: { "17:race": { fixed: {}, constructor: 1 } } }))).toContain("not allowed");
  });

  test("a prototype key", () => expect(skippedReason({ ...good(), prototype: 1 })).toContain("not allowed"));

  test("one bad scenario does not stop the good ones", () => {
    const r = parse(file([good({ name: "A" }), good({ name: "B", season: 2020 }), good({ name: "C" })]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.accepted.map((s) => s.name)).toEqual(["A", "C"]);
    expect(r.skipped).toEqual([{ index: 2, name: "B", reason: expect.stringContaining("2020") }]);
  });

  test("the reason names the position and the name", () => {
    const r = parse(file([null, good({ name: "Late", season: 1999 })]));
    expect(r.ok && r.skipped.map((s) => [s.index, s.name])).toEqual([[1, ""], [2, "Late"]]);
  });
});

describe("parseScenarioFile: names", () => {
  test("a duplicate of a saved scenario is renamed, case-insensitively", () => {
    const r = parse(file([good({ name: "norris wins both" })]), ["Norris wins both"]);
    expect(r.ok && r.accepted[0]!.name).toBe("norris wins both (2)");
    expect(r.ok && r.accepted[0]!.requestedName).toBe("norris wins both");
  });

  test("duplicates inside the file are numbered in order", () => {
    const r = parse(file([good(), good(), good()]));
    expect(r.ok && r.accepted.map((s) => s.name)).toEqual(["Norris wins both", "Norris wins both (2)", "Norris wins both (3)"]);
  });

  test("the first free number is used", () => {
    const r = parse(file([good()]), ["Norris wins both", "Norris wins both (2)"]);
    expect(r.ok && r.accepted[0]!.name).toBe("Norris wins both (3)");
  });

  test("a renamed long name still fits", () => {
    const long = "x".repeat(MAX_NAME_LENGTH);
    const name = uniqueName(long, new Set([long]));
    expect(name.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
    expect(name.endsWith(" (2)")).toBe(true);
  });
});

describe("parseScenarioFile: never crashes", () => {
  const nasty: unknown[] = [
    null, 0, "", [], {}, [[]], [null], { name: {} }, { name: "x", season: 2026, asOfRound: 1, locks: { "17:race": { fixed: [] } } },
    { name: "x", season: 2026, asOfRound: 1, locks: { "17:race": { fixed: null } } },
    { name: "x", season: 2026, asOfRound: 1, locks: { "17:race": { fixed: { NOR: null } } } },
    { name: "x", season: 2026, asOfRound: 1, locks: { "17:race": { fixed: { NOR: {} } } } },
    { name: "x", season: 2026, asOfRound: 1, locks: { "17:race": { fixed: {}, tier: 5 } } },
    { name: "x", season: 2026, asOfRound: 1, locks: {}, contenders: [null] },
    { name: "x", season: 2026, asOfRound: 1, locks: {}, contenders: { length: 1 } },
    { name: "x", season: null, asOfRound: null, locks: null },
    { name: "x", season: 1e999, asOfRound: NaN, locks: {} },
    { name: "x".repeat(100000), season: 2026, asOfRound: 1, locks: {} },
  ];

  test.each(nasty.map((entry, i) => [i, entry] as const))("entry %i", (_i, entry) => {
    const r = parse(file([entry]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.accepted.length + r.skipped.length).toBe(1);
  });

  test("deeply nested junk", () => {
    let deep: unknown = {};
    for (let i = 0; i < 5000; i++) deep = { a: deep };
    let text = "";
    try {
      text = file([{ name: "x", season: 2026, asOfRound: 1, locks: {}, extra: deep }]);
    } catch {
      return; // JSON.stringify refused it: nothing to parse
    }
    expect(() => parse(text)).not.toThrow();
  });

  test("the input is not modified", () => {
    const before = JSON.stringify(state);
    parse(file([good(), good()]));
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("types", () => {
  test("a built file parses back to the same scenarios", () => {
    const built: ScenarioFile = buildScenarioFile([good()] as never, state);
    const r = parse(JSON.stringify(built));
    expect(r.ok && r.accepted).toEqual(built.scenarios);
  });
});
