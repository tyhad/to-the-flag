import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { verifyBaseStandings } from "../scripts/verifyStandings";
import { buildDb, cleanupDbs } from "./dbHelpers";

afterAll(cleanupDbs);

describe("verifyBaseStandings", () => {
  test("engine base table equals driver_standings on a consistent database", () => {
    const r = verifyBaseStandings(buildDb());
    expect(r.mismatches).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.compared).toBe(4);
  });

  test("reports an order difference", () => {
    const path = buildDb();
    const db = new Database(path);
    db.run("UPDATE driver_standings SET position = CASE driver_abbr WHEN 'AAA' THEN 2 WHEN 'BBB' THEN 1 ELSE position END");
    db.close();
    const r = verifyBaseStandings(path);
    expect(r.ok).toBe(false);
    expect(r.mismatches.join("\n")).toContain("AAA");
  });
});
