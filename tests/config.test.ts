import { describe, expect, test } from "bun:test";
import { DEFAULTS, loadConfig } from "../config";

describe("loadConfig", () => {
  test("uses defaults when env is empty", () => {
    expect(loadConfig({})).toEqual({
      f1gstatsDb: "../F1GStats/f1gstats.sqlite",
      port: 3100,
      host: "127.0.0.1",
    });
  });

  test("defaults match the documented values", () => {
    expect(DEFAULTS.port).toBe(3100);
    expect(DEFAULTS.host).toBe("127.0.0.1");
  });

  test("env overrides defaults", () => {
    const cfg = loadConfig({ F1GSTATS_DB: "D:/data/f1.sqlite", PORT: "4000", HOST: "0.0.0.0" });
    expect(cfg).toEqual({ f1gstatsDb: "D:/data/f1.sqlite", port: 4000, host: "0.0.0.0" });
  });

  test("blank values fall back to defaults", () => {
    const cfg = loadConfig({ F1GSTATS_DB: "  ", PORT: "", HOST: "" });
    expect(cfg.f1gstatsDb).toBe(DEFAULTS.f1gstatsDb);
    expect(cfg.port).toBe(DEFAULTS.port);
    expect(cfg.host).toBe(DEFAULTS.host);
  });

  test("invalid PORT throws RangeError", () => {
    expect(() => loadConfig({ PORT: "abc" })).toThrow(RangeError);
    expect(() => loadConfig({ PORT: "0" })).toThrow(RangeError);
    expect(() => loadConfig({ PORT: "70000" })).toThrow(RangeError);
    expect(() => loadConfig({ PORT: "31.5" })).toThrow(RangeError);
  });
});
