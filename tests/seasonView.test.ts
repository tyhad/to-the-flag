/** Phase 2 Step 5: turning the /api/season response into a load state (pure). */
import { describe, expect, test } from "bun:test";
import { loadMessage, parseSeasonResponse } from "../web/viewModel/season";
import { makeState } from "./helpers";

const state = () =>
  makeState({
    rounds: 3,
    completed: 1,
    teams: { t: ["AAA", "BBB"] },
    results: { "1:race": ["AAA", "BBB"] },
  });

describe("parseSeasonResponse", () => {
  test("a good snapshot becomes a ready state carrying it unchanged", () => {
    const s = state();
    expect(parseSeasonResponse(true, s)).toEqual({ status: "ready", state: s });
  });

  test("an error response keeps the server's plain-words message and adds how to fix a missing file", () => {
    expect(parseSeasonResponse(false, { error: "data_file_missing", message: "The season data file is missing." })).toEqual({
      status: "error",
      message: "The season data file is missing. Set F1GSTATS_DB in your .env file to point at it, then try again.",
    });
  });

  test("an error code the app does not know keeps the server's words as they are", () => {
    expect(parseSeasonResponse(false, { error: "something_new", message: "Try later." })).toEqual({
      status: "error",
      message: "Try later.",
    });
  });

  test("an error without a usable body has no message", () => {
    expect(parseSeasonResponse(false, null)).toEqual({ status: "error", message: null });
    expect(parseSeasonResponse(false, { error: "x" })).toEqual({ status: "error", message: null });
  });

  test("an ok response with the wrong shape is an error, not a crash", () => {
    expect(parseSeasonResponse(true, null)).toEqual({ status: "error", message: null });
    expect(parseSeasonResponse(true, { season: 2026 })).toEqual({ status: "error", message: null });
    expect(parseSeasonResponse(true, { ...state(), results: "nope" })).toEqual({ status: "error", message: null });
    expect(parseSeasonResponse(true, { ...state(), drivers: undefined })).toEqual({ status: "error", message: null });
  });
});

describe("loadMessage", () => {
  test("says what is happening, or what failed and what to do", () => {
    expect(loadMessage({ status: "loading" })).toBe("Loading season data");
    expect(loadMessage({ status: "error", message: "The season data file is missing." })).toBe(
      "The season data file is missing.",
    );
    expect(loadMessage({ status: "error", message: null })).toBe(
      "Could not load the season data. Check that the server is running (bun run dev), then try again.",
    );
  });
});
