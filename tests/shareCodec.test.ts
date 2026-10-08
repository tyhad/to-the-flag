/**
 * Tests for shared/shareCodec.ts.
 */
import { describe, expect, test } from "bun:test";
import { encodeScenario, decodeScenario } from "../shared/shareCodec";
import type { Scenario } from "../engine/types";

describe("Scenario Share Codec (Step 2)", () => {
  test("codec round trip with locks and contenders", async () => {
    const scenario: Scenario = {
      locks: {
        "17:race": { fixed: { NOR: 1, VER: 2, HAM: "out" } },
        "17:sprint": { fixed: { RUS: 1 } },
      },
    };
    const contenders = ["NOR", "VER", "HAM", "RUS", "ANT"];

    const encoded = await encodeScenario(scenario, contenders);
    expect(encoded.startsWith("v1.")).toBe(true);

    const decoded = await decodeScenario(encoded);
    expect(decoded.scenario).toEqual(scenario);
    expect(decoded.contenders).toEqual(contenders);
  });

  test("codec round trip with empty contenders", async () => {
    const scenario: Scenario = {
      locks: {
        "17:race": { fixed: { NOR: 1 } },
      },
    };

    const encoded = await encodeScenario(scenario);
    expect(encoded.startsWith("v1.")).toBe(true);

    const decoded = await decodeScenario(encoded);
    expect(decoded.scenario).toEqual(scenario);
    expect(decoded.contenders).toBeUndefined();
  });

  test("rejects garbage strings", async () => {
    await expect(decodeScenario("v1.not-valid-base64-!!!")).rejects.toThrow();
    await expect(decodeScenario("v1.AAAA")).rejects.toThrow();
  });

  test("rejects unknown or missing version prefix", async () => {
    await expect(decodeScenario("v2.something")).rejects.toThrow("Unsupported or missing version prefix");
    await expect(decodeScenario("something_without_version")).rejects.toThrow("Unsupported or missing version prefix");
  });

  test("8-session scenario encodes to under 600 characters", async () => {
    const scenario: Scenario = {
      locks: {
        "17:race": { fixed: { NOR: 1, VER: 2, HAM: 3, RUS: 4, ANT: 5, LEC: 6, PIA: 7, SAI: 8 } },
        "17:sprint": { fixed: { NOR: 1, VER: 2, HAM: 3 } },
        "18:race": { fixed: { NOR: 2, VER: 1 } },
        "19:race": { fixed: { NOR: 1, VER: 3 } },
        "20:race": { fixed: { HAM: 1, RUS: 2 } },
        "21:race": { fixed: { VER: 1, NOR: 2 } },
        "22:race": { fixed: { NOR: 1, VER: 2 } },
        "23:race": { fixed: { NOR: 1, VER: 2 } },
      },
    };
    const contenders = ["NOR", "VER", "HAM", "RUS", "ANT", "LEC", "PIA", "SAI"];

    const encoded = await encodeScenario(scenario, contenders);
    expect(encoded.length).toBeLessThan(600);
  });
});
