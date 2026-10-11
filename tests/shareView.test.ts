/** Phase 2 Step 8: share links (pure parts plus the codec round trip). */
import { describe, expect, test } from "bun:test";
import { decodeScenario, encodeScenario } from "../shared/shareCodec";
import type { Scenario, SeasonState } from "../engine";
import { assessImport, buildShareHash, importFromHash, parseShareHash } from "../web/viewModel/share";
import { makeState } from "./helpers";

const state = (): SeasonState =>
  makeState({
    rounds: 5,
    completed: 3,
    teams: { red: ["AAA", "BBB"], blue: ["CCC", "DDD"] },
    results: {
      "1:race": ["AAA", "BBB", "CCC", "DDD"],
      "2:race": ["AAA", "BBB", "CCC", "DDD"],
      "3:race": ["AAA", "BBB", "CCC", "DDD"],
    },
  });

const good: Scenario = { locks: { "4:race": { fixed: { DDD: 1, CCC: 2 } } } };

describe("buildShareHash and parseShareHash", () => {
  test("the hash carries the code and the round the data was at", () => {
    expect(buildShareHash("v1.abc", 16)).toBe("#s=v1.abc&r=16");
  });

  test("parses both parts, in either order", () => {
    expect(parseShareHash("#s=v1.abc&r=16")).toEqual({ code: "v1.abc", asOfRound: 16 });
    expect(parseShareHash("#r=16&s=v1.abc")).toEqual({ code: "v1.abc", asOfRound: 16 });
  });

  test("a link without a round still works, with no round to compare", () => {
    expect(parseShareHash("#s=v1.abc")).toEqual({ code: "v1.abc", asOfRound: null });
    expect(parseShareHash("#s=v1.abc&r=soon")).toEqual({ code: "v1.abc", asOfRound: null });
  });

  test("anything that is not a share link is ignored", () => {
    for (const hash of ["", "#", "#standings", "#foo=1", "#s=", "#s=&r=3", "#r=16"]) {
      expect(parseShareHash(hash)).toBeNull();
    }
  });

  test("works with and without the leading #", () => {
    expect(parseShareHash("s=v1.abc&r=2")).toEqual({ code: "v1.abc", asOfRound: 2 });
  });
});

describe("the whole trip: encode, hash, parse, decode", () => {
  test("a scenario and its contenders come back unchanged", async () => {
    const code = await encodeScenario(good, ["AAA", "DDD"]);
    const parsed = parseShareHash(buildShareHash(code, 3));
    expect(parsed).not.toBeNull();
    const decoded = await decodeScenario(parsed!.code);
    expect(decoded.scenario).toEqual(good);
    expect(decoded.contenders).toEqual(["AAA", "DDD"]);
  });
});

describe("assessImport", () => {
  const decoded = { scenario: good, contenders: ["AAA", "DDD"] };

  test("a link from the same round imports with no warning", () => {
    const s = state();
    expect(assessImport(s, decoded, s.asOfRound)).toEqual({
      ok: true,
      scenario: good,
      contenders: ["AAA", "DDD"],
      warning: null,
    });
  });

  test("a link without a round imports with no warning", () => {
    expect(assessImport(state(), decoded, null)).toMatchObject({ ok: true, warning: null });
  });

  test("a link from an older round warns that results may differ", () => {
    const s = state();
    const r = assessImport(s, decoded, s.asOfRound - 1);
    expect(r).toMatchObject({ ok: true });
    expect(r.ok && r.warning).toBe(
      `This link was made at Round ${s.asOfRound - 1}. Data is now at Round ${s.asOfRound}, so the results may differ.`,
    );
  });

  test("a link from a newer round warns too", () => {
    const s = state();
    const r = assessImport(s, decoded, s.asOfRound + 2);
    expect(r.ok && r.warning).toBe(
      `This link was made with newer data (Round ${s.asOfRound + 2}) than yours (Round ${s.asOfRound}). Results may differ.`,
    );
  });

  test("a scenario that no longer fits is not imported, and the reason is in plain words", () => {
    const bad = { scenario: { locks: { "2:race": { fixed: { AAA: 1 } } } } };
    expect(assessImport(state(), bad, 3)).toEqual({
      ok: false,
      message: "That link does not fit the current data. That session already has real results, so it cannot be locked.",
    });
  });

  test("contenders are optional", () => {
    const r = assessImport(state(), { scenario: good }, 3);
    expect(r.ok && r.contenders).toBeUndefined();
  });
});

describe("importFromHash", () => {
  test("no share link in the hash: nothing to do", async () => {
    expect(await importFromHash(state(), "")).toBeNull();
    expect(await importFromHash(state(), "#standings")).toBeNull();
  });

  test("a real link imports", async () => {
    const s = state();
    const code = await encodeScenario(good, ["AAA", "DDD"]);
    const r = await importFromHash(s, buildShareHash(code, s.asOfRound));
    expect(r).toMatchObject({ ok: true, scenario: good, contenders: ["AAA", "DDD"], warning: null });
  });

  test("a link that was cut short or damaged says so, without technical detail", async () => {
    const message = "That link is not valid. Ask for a new one.";
    expect(await importFromHash(state(), "#s=garbage")).toEqual({ ok: false, message });
    expect(await importFromHash(state(), "#s=v1.@@@@")).toEqual({ ok: false, message });
    const code = await encodeScenario(good);
    expect(await importFromHash(state(), `#s=${code.slice(0, 12)}`)).toEqual({ ok: false, message });
  });
});
