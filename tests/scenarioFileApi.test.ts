/** Scenario export and import through the API (Phase 10, Step 3, D58). */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetWriteRateLimits } from "../api/guard";
import { createApp } from "../api/server";
import { MAX_FILE_BYTES } from "../api/scenarioFile";
import { buildFixtureDb, cleanupDbs } from "./dbHelpers";

const BASE = "http://127.0.0.1:3100";
const TOKEN = "test-secret-token-123456789";

let dbPath = "";
let dir = "";
let n = 0;
beforeAll(() => {
  dbPath = buildFixtureDb();
  dir = mkdtempSync(join(tmpdir(), "ttf-file-test-"));
});
afterAll(() => {
  cleanupDbs();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows file handle cleanup
  }
});
beforeEach(() => resetWriteRateLimits());

type App = ReturnType<typeof createApp>;
const makeApp = (token: string | null = null, clientIp = () => "127.0.0.1" as string | null): App =>
  createApp({ dbPath, ttfDbPath: join(dir, `s-${++n}.sqlite`), token, clientIp });

const json = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
const call = async (app: App, req: Request) => {
  const res = await app.handle(req);
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, body: text ? JSON.parse(text) : null };
};
const create = (app: App, name: string, locks: unknown, contenders?: string[]) =>
  call(app, json("POST", "/api/scenarios", { name, locks, contenders }));

const L1 = { "17:race": { fixed: { NOR: 1 } } };
const L2 = { "17:race": { fixed: { PIA: 1, NOR: 2 } }, "17:sprint": { fixed: { NOR: 3, VER: "out" }, tier: "full" } };

describe("GET /api/scenarios/export", () => {
  test("a file with the format, the version and every saved scenario", async () => {
    const app = makeApp();
    await create(app, "One", L1, ["NOR"]);
    await create(app, "Two", L2);
    const res = await call(app, json("GET", "/api/scenarios/export"));
    expect(res.status).toBe(200);
    expect(res.body.format).toBe("to-the-flag-scenarios");
    expect(res.body.version).toBe(1);
    expect(res.body.scenarios.map((s: { name: string }) => s.name)).toEqual(["One", "Two"]);
    expect(res.body.scenarios[0]).toEqual({ name: "One", season: 2026, asOfRound: 16, locks: L1, contenders: ["NOR"] });
  });

  test("the file name has the season and the round, and the browser is told to save it", async () => {
    const res = await call(makeApp(), json("GET", "/api/scenarios/export"));
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="to-the-flag-scenarios-2026-r16.json"');
  });

  test("it is a read route: no token needed, even from another computer, and any Host", async () => {
    const app = makeApp(TOKEN, () => "192.168.1.50");
    const res = await call(app, json("GET", "/api/scenarios/export", undefined, { host: "evil.example" }));
    expect(res.status).toBe(200);
  });

  test("it is not mistaken for a scenario id", async () => {
    const res = await call(makeApp(), json("GET", "/api/scenarios/export"));
    expect(res.body.error).toBeUndefined();
  });

  test("nothing in the file points at this server: no id, time, token, address or path", async () => {
    const app = makeApp(TOKEN);
    await create(app, "Secret?", L1, ["NOR"]);
    const created = await call(app, json("POST", "/api/scenarios", { name: "X", locks: L1 }, { authorization: `Bearer ${TOKEN}` }));
    const res = await call(app, json("GET", "/api/scenarios/export"));
    const text = res.text;
    for (const leak of [TOKEN, created.body?.id ?? "no-id", "createdAt", "updatedAt", "127.0.0.1", "3100", "sqlite", dir, "http"]) {
      expect(text).not.toContain(leak);
    }
    expect(Object.keys(res.body).sort()).toEqual(["format", "scenarios", "version"]);
    for (const s of res.body.scenarios) expect(Object.keys(s).sort()).toEqual(["asOfRound", "contenders", "locks", "name", "season"].filter((k) => k in s));
  });

  test("an empty store exports an empty list", async () => {
    const res = await call(makeApp(), json("GET", "/api/scenarios/export"));
    expect(res.body.scenarios).toEqual([]);
  });
});

describe("POST /api/scenarios/import", () => {
  test("round trip: export, delete all, import restores names, locks and contenders", async () => {
    const app = makeApp();
    await create(app, "One", L1, ["NOR"]);
    await create(app, "Two", L2, ["NOR", "PIA"]);
    const exported = await call(app, json("GET", "/api/scenarios/export"));
    const before = (await call(app, json("GET", "/api/scenarios"))).body;
    for (const s of before) await call(app, json("DELETE", `/api/scenarios/${s.id}`));
    expect((await call(app, json("GET", "/api/scenarios"))).body).toEqual([]);

    const res = await call(app, json("POST", "/api/scenarios/import", exported.text));
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(2);
    expect(res.body.skipped).toBe(0);
    const after = (await call(app, json("GET", "/api/scenarios"))).body;
    const strip = (list: any[]) => list.map(({ name, season, asOfRound, locks, contenders, valid }) => ({ name, season, asOfRound, locks, contenders, valid }));
    expect(strip(after)).toEqual(strip(before));
    // new ids, never the old ones
    expect(after.map((s: any) => s.id).some((id: string) => before.some((b: any) => b.id === id))).toBe(false);
  });

  test("importing into the same store never overwrites: the copies are renamed", async () => {
    const app = makeApp();
    await create(app, "One", L1, ["NOR"]);
    const exported = await call(app, json("GET", "/api/scenarios/export"));
    const res = await call(app, json("POST", "/api/scenarios/import", exported.text));
    expect(res.body.imported).toBe(1);
    expect(res.body.renamed).toEqual([{ from: "One", to: "One (2)" }]);
    const list = (await call(app, json("GET", "/api/scenarios"))).body;
    expect(list.map((s: any) => s.name)).toEqual(["One", "One (2)"]);
    // and again
    const again = await call(app, json("POST", "/api/scenarios/import", exported.text));
    expect(again.body.renamed).toEqual([{ from: "One", to: "One (3)" }]);
  });

  test("the answer says how many came in, how many were skipped, and why", async () => {
    const app = makeApp();
    const file = {
      format: "to-the-flag-scenarios",
      version: 1,
      scenarios: [
        { name: "Good", season: 2026, asOfRound: 16, locks: L1 },
        { name: "Old", season: 2025, asOfRound: 24, locks: {} },
        { name: "Bad lock", season: 2026, asOfRound: 16, locks: { "17:race": { fixed: { ZZZ: 1 } } } },
      ],
    };
    const res = await call(app, json("POST", "/api/scenarios/import", file));
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.skipped).toBe(2);
    expect(res.body.skippedItems.map((s: any) => [s.index, s.name])).toEqual([[2, "Old"], [3, "Bad lock"]]);
    expect(res.body.skippedItems[0].reason).toContain("2025");
    expect(res.body.skippedItems[1].reason).toContain("ZZZ");
    expect(res.body.scenarios[0].name).toBe("Good");
  });

  test("ids, timestamps and other fields in the file are ignored", async () => {
    const app = makeApp();
    const file = {
      format: "to-the-flag-scenarios",
      version: 1,
      scenarios: [{ id: "chosen-id", createdAt: "2001-01-01T00:00:00.000Z", name: "A", season: 2026, asOfRound: 16, locks: L1 }],
    };
    const res = await call(app, json("POST", "/api/scenarios/import", file));
    expect(res.body.scenarios[0].id).not.toBe("chosen-id");
    expect(res.body.scenarios[0].createdAt).not.toBe("2001-01-01T00:00:00.000Z");
    expect((await call(app, json("GET", "/api/scenarios/chosen-id"))).status).toBe(404);
  });

  test("the active overlay scenario is not touched", async () => {
    const app = makeApp();
    const a = await create(app, "Live", L1);
    await call(app, json("PUT", "/api/active-scenario", { id: a.body.id }));
    await call(app, json("POST", "/api/scenarios/import", { format: "to-the-flag-scenarios", version: 1, scenarios: [{ name: "Live", season: 2026, asOfRound: 16, locks: L1 }] }));
    expect((await call(app, json("GET", "/api/active-scenario"))).body.id).toBe(a.body.id);
  });

  test.each([
    ["not JSON", "{ nope", 422, "not_json"],
    ["another format", { format: "x", version: 1, scenarios: [] }, 422, "wrong_format"],
    ["version 2", { format: "to-the-flag-scenarios", version: 2, scenarios: [] }, 422, "unsupported_version"],
    ["scenarios not a list", { format: "to-the-flag-scenarios", version: 1, scenarios: {} }, 422, "wrong_type"],
    ["a list", [], 422, "wrong_format"],
  ])("a file that is %s is refused in words and nothing is saved", async (_l, body, status, error) => {
    const app = makeApp();
    const res = await call(app, json("POST", "/api/scenarios/import", body));
    expect(res.status).toBe(status);
    expect(res.body.error).toBe(error);
    expect(typeof res.body.message).toBe("string");
    expect((await call(app, json("GET", "/api/scenarios"))).body).toEqual([]);
  });

  test("more than 200 scenarios is refused and nothing is saved", async () => {
    const app = makeApp();
    const scenarios = Array.from({ length: 201 }, (_, i) => ({ name: `S${i}`, season: 2026, asOfRound: 16, locks: {} }));
    const res = await call(app, json("POST", "/api/scenarios/import", { format: "to-the-flag-scenarios", version: 1, scenarios }));
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("too_many");
    expect((await call(app, json("GET", "/api/scenarios"))).body).toEqual([]);
  });

  test("exactly 200 is fine", async () => {
    const app = makeApp();
    const scenarios = Array.from({ length: 200 }, (_, i) => ({ name: `S${i}`, season: 2026, asOfRound: 16, locks: {} }));
    const res = await call(app, json("POST", "/api/scenarios/import", { format: "to-the-flag-scenarios", version: 1, scenarios }));
    expect(res.body.imported).toBe(200);
  });

  test("a file over 1 MB is refused with 413, by its declared size and by its real size", async () => {
    const app = makeApp();
    const big = JSON.stringify({ format: "to-the-flag-scenarios", version: 1, scenarios: [], pad: "x".repeat(MAX_FILE_BYTES) });
    const declared = await call(app, json("POST", "/api/scenarios/import", big));
    expect(declared.status).toBe(413);
    expect(declared.body.error).toBe("too_large");
    // a body that lies about its size: the content-length is small, the stream is large
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const chunk = new TextEncoder().encode("x".repeat(64 * 1024));
        for (let i = 0; i < 20; i++) controller.enqueue(chunk);
        controller.close();
      },
    });
    const lying = await app.handle(
      new Request(`${BASE}/api/scenarios/import`, {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": "10" },
        body: stream,
        // @ts-expect-error Bun needs this for a streamed request body
        duplex: "half",
      }),
    );
    expect(lying.status).toBe(413);
  });

  test("a body of exactly the limit is not refused for its size", async () => {
    const app = makeApp();
    const head = '{"format":"to-the-flag-scenarios","version":1,"scenarios":[],"pad":"';
    const tail = '"}';
    const text = head + "x".repeat(MAX_FILE_BYTES - head.length - tail.length) + tail;
    expect(Buffer.byteLength(text)).toBe(MAX_FILE_BYTES);
    const res = await call(app, json("POST", "/api/scenarios/import", text));
    expect(res.status).toBe(200);
  });

  test("__proto__ and constructor keys skip the scenario and do not pollute anything", async () => {
    const app = makeApp();
    const text =
      '{"format":"to-the-flag-scenarios","version":1,"scenarios":[' +
      '{"name":"P","season":2026,"asOfRound":16,"locks":{"17:race":{"fixed":{"__proto__":1}}}},' +
      '{"name":"C","season":2026,"asOfRound":16,"locks":{},"constructor":{"prototype":{"x":1}}},' +
      '{"name":"Fine","season":2026,"asOfRound":16,"locks":{}}]}';
    const res = await call(app, json("POST", "/api/scenarios/import", text));
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.skipped).toBe(2);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  test("garbage never gives a 500", async () => {
    const app = makeApp();
    for (const body of ["", "null", "0", '"text"', "[1,2,3]", "{}", '{"format":"to-the-flag-scenarios"}', "\u0000\u0001", "{".repeat(10000)]) {
      const res = await call(app, json("POST", "/api/scenarios/import", body).clone());
      expect(res.status).toBeLessThan(500);
    }
  });
});

describe("import is a write: the write guard applies", () => {
  const file = { format: "to-the-flag-scenarios", version: 1, scenarios: [{ name: "A", season: 2026, asOfRound: 16, locks: L1 }] };

  test("a token is required in LAN mode, and a remote client without one is refused", async () => {
    const app = makeApp(TOKEN, () => "192.168.1.50");
    expect((await call(app, json("POST", "/api/scenarios/import", file))).status).toBe(401);
    expect((await call(app, json("POST", "/api/scenarios/import", file, { authorization: "Bearer wrong-wrong-wrong-1" }))).status).toBe(401);
    const ok = await call(app, json("POST", "/api/scenarios/import", file, { authorization: `Bearer ${TOKEN}` }));
    expect(ok.status).toBe(200);
  });

  test("with no token, only this computer may import", async () => {
    const remote = makeApp(null, () => "192.168.1.50");
    const res = await call(remote, json("POST", "/api/scenarios/import", file));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("local_only");
  });

  test("the Host allowlist applies", async () => {
    const app = makeApp();
    const res = await call(app, json("POST", "/api/scenarios/import", file, { host: "evil.example" }));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden_host");
  });

  test("a page on another site cannot import (Origin)", async () => {
    const res = await call(makeApp(), json("POST", "/api/scenarios/import", file, { origin: "http://evil.example" }));
    expect(res.status).toBe(403);
  });

  test("the body must say it is JSON", async () => {
    const res = await call(makeApp(), json("POST", "/api/scenarios/import", JSON.stringify(file), { "content-type": "text/plain" }));
    expect(res.status).toBe(415);
  });

  test("a refused import saves nothing", async () => {
    const app = makeApp(TOKEN, () => "192.168.1.50");
    await call(app, json("POST", "/api/scenarios/import", file));
    const list = await call(app, json("GET", "/api/scenarios"));
    expect(list.body).toEqual([]);
  });

  test("the token never appears in a response", async () => {
    const app = makeApp(TOKEN, () => "192.168.1.50");
    const res = await call(app, json("POST", "/api/scenarios/import", file, { authorization: `Bearer ${TOKEN}` }));
    expect(res.text).not.toContain(TOKEN);
  });
});

describe("over a real socket", () => {
  test("export, then import, then a body that is too large", async () => {
    const app = createApp({ dbPath, ttfDbPath: join(dir, `s-${++n}.sqlite`), token: null });
    app.listen({ port: 0, hostname: "127.0.0.1" });
    try {
      const base = `http://127.0.0.1:${app.server!.port}`;
      const headers = { "content-type": "application/json" };
      const file = { format: "to-the-flag-scenarios", version: 1, scenarios: [{ name: "Net", season: 2026, asOfRound: 16, locks: L1 }] };
      const imported = await fetch(`${base}/api/scenarios/import`, { method: "POST", headers, body: JSON.stringify(file) });
      expect(imported.status).toBe(200);
      expect(((await imported.json()) as { imported: number }).imported).toBe(1);

      const exported = await fetch(`${base}/api/scenarios/export`);
      expect(exported.headers.get("content-disposition")).toContain("to-the-flag-scenarios-2026-r16.json");
      expect(((await exported.json()) as { scenarios: unknown[] }).scenarios).toHaveLength(1);

      const huge = await fetch(`${base}/api/scenarios/import`, { method: "POST", headers, body: "x".repeat(MAX_FILE_BYTES + 1) });
      expect(huge.status).toBe(413);
    } finally {
      await app.stop(true);
    }
  });
});
