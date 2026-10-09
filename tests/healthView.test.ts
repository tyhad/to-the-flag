/** Phase 2 Step 4: the header's data-status view-model (pure). */
import { describe, expect, test } from "bun:test";
import { headerLabel, parseHealthResponse } from "../web/viewModel/health";

describe("parseHealthResponse", () => {
  test("a good payload becomes a ready state", () => {
    const state = parseHealthResponse(true, {
      ok: true,
      season: 2026,
      asOfRound: 16,
      dataStatus: "ok",
      checkedAt: "2026-09-01T10:00:00Z",
      schemaVersion: 2,
    });
    expect(state).toEqual({ status: "ready", season: 2026, asOfRound: 16, dataStatus: "ok" });
  });

  test("keeps warn and fail data statuses", () => {
    const base = { ok: true, season: 2026, asOfRound: 3, checkedAt: "x", schemaVersion: 2 };
    expect(parseHealthResponse(true, { ...base, dataStatus: "warn" })).toMatchObject({ dataStatus: "warn" });
    expect(parseHealthResponse(true, { ...base, dataStatus: "fail" })).toMatchObject({ dataStatus: "fail" });
  });

  test("a 503 carries the server's plain-words message", () => {
    const state = parseHealthResponse(false, { error: "data_unavailable", message: "The season data file is missing." });
    expect(state).toEqual({ status: "error", message: "The season data file is missing." });
  });

  test("an error without a usable body has no message", () => {
    expect(parseHealthResponse(false, null)).toEqual({ status: "error", message: null });
    expect(parseHealthResponse(false, { error: "x" })).toEqual({ status: "error", message: null });
  });

  test("an ok response with the wrong shape is an error, not a crash", () => {
    expect(parseHealthResponse(true, null)).toEqual({ status: "error", message: null });
    expect(parseHealthResponse(true, { season: "2026", asOfRound: 16, dataStatus: "ok" })).toEqual({
      status: "error",
      message: null,
    });
    expect(parseHealthResponse(true, { season: 2026, asOfRound: 16, dataStatus: "great" })).toEqual({
      status: "error",
      message: null,
    });
  });
});

describe("headerLabel", () => {
  test("ready shows season and the round the data is as of", () => {
    expect(headerLabel({ status: "ready", season: 2026, asOfRound: 16, dataStatus: "ok" })).toBe(
      "Season 2026 · as of Round 16",
    );
  });

  test("loading and error say what is happening", () => {
    expect(headerLabel({ status: "loading" })).toBe("Loading season data");
    expect(headerLabel({ status: "error", message: "The season data file is missing." })).toBe(
      "The season data file is missing.",
    );
    expect(headerLabel({ status: "error", message: null })).toBe(
      "Season data not loaded. Check that the server is running.",
    );
  });
});
