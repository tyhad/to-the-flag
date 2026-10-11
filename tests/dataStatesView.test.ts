/** Phase 2 Step 10: data health and server errors, in words an owner can act on (pure). */
import { describe, expect, test } from "bun:test";
import { dataNotice } from "../web/viewModel/dataNotice";
import { explainServerError } from "../web/viewModel/serverError";

describe("dataNotice", () => {
  test("a healthy check shows nothing", () => {
    expect(dataNotice({ status: "ok", checkedAt: "2026-10-07T02:06:22Z" }, 16)).toBeNull();
  });

  test("a warning is small: say what happened and that the numbers are shown", () => {
    expect(dataNotice({ status: "warn", checkedAt: "x" }, 16)).toEqual({
      tone: "warn",
      title: "Data check warning: the latest import flagged something to review.",
      hint: "The standings are shown as loaded.",
    });
  });

  test("a failed check names the round of the last valid data, and how to find out why", () => {
    expect(dataNotice({ status: "fail", checkedAt: "x" }, 16)).toEqual({
      tone: "fail",
      title: "Data check failed. Showing last valid data from Round 16.",
      hint: "Run the F1GStats data check again to see what failed, then reload this page.",
    });
  });

  test("the round in the message follows the data", () => {
    expect(dataNotice({ status: "fail", checkedAt: "x" }, 3)?.title).toBe(
      "Data check failed. Showing last valid data from Round 3.",
    );
  });
});

describe("explainServerError", () => {
  test("a missing data file says how to point the app at it", () => {
    expect(
      explainServerError({
        error: "data_file_missing",
        message: "F1GStats database file was not found. Please ensure the database file exists.",
      }),
    ).toBe(
      "F1GStats database file was not found. Please ensure the database file exists. Set F1GSTATS_DB in your .env file to point at it, then try again.",
    );
  });

  test("a data error says to run the check", () => {
    expect(explainServerError({ error: "data_error", message: "The season data could not be read." })).toBe(
      "The season data could not be read. Run the F1GStats data check, then try again.",
    );
  });

  test("a schema problem already says what to do, so the message is kept as it is", () => {
    const message = "f1gstats.sqlite has meta.schema_version 1, but 2 or newer is required. Re-run F1GStats.";
    expect(explainServerError({ error: "schema_version_invalid", message })).toBe(message);
  });

  test("an unknown error keeps the server's own words", () => {
    expect(explainServerError({ error: "something_new", message: "Try later." })).toBe("Try later.");
  });

  test("no usable message gives null, so the caller can use its own", () => {
    expect(explainServerError(null)).toBeNull();
    expect(explainServerError("oops")).toBeNull();
    expect(explainServerError({ error: "data_file_missing" })).toBeNull();
    expect(explainServerError({ message: "" })).toBeNull();
  });
});
