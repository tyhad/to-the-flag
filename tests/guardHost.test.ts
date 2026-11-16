/**
 * Host allowlist on the write routes (Phase 10, Step 2, D57), through `app.handle` and one real socket.
 * The older guard tests (Origin, Content-Type, token, rate limit) stay in tests/guard.test.ts and pass unchanged.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetWriteRateLimits } from "../api/guard";
import { createApp } from "../api/server";
import { buildFixtureDb, cleanupDbs } from "./dbHelpers";

const TOKEN = "test-secret-token-123456789";
const BODY = JSON.stringify({ name: "Host test", locks: { "17:race": { fixed: { NOR: 1 } } }, contenders: ["NOR"] });

let dbPath = "";
let dir = "";
let n = 0;
beforeAll(() => {
  dbPath = buildFixtureDb();
  dir = mkdtempSync(join(tmpdir(), "ttf-host-test-"));
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

const makeApp = (allowedHosts: string[] = [], token: string | null = null) =>
  createApp({ dbPath, ttfDbPath: join(dir, `s-${++n}.sqlite`), allowedHosts, token, clientIp: () => "127.0.0.1" });

const post = (app: ReturnType<typeof makeApp>, host: string | null, extra: Record<string, string> = {}) => {
  const headers: Record<string, string> = { "content-type": "application/json", ...extra };
  if (host !== null) headers.host = host;
  return app.handle(new Request("http://127.0.0.1:3100/api/scenarios", { method: "POST", headers, body: BODY }));
};

describe("accepted hosts", () => {
  test.each(["127.0.0.1:3100", "localhost", "LOCALHOST:3100", "[::1]:3100", "192.168.1.20:3100"])("%s", async (host) => {
    const res = await post(makeApp(), host);
    expect(res.status).toBe(201);
  });

  test("a listed name, any case, port ignored", async () => {
    const app = makeApp(["mypc.local"]);
    expect((await post(app, "MyPC.local:3100")).status).toBe(201);
    expect((await post(app, "mypc.local")).status).toBe(201);
  });
});

describe("rejected hosts", () => {
  test.each(["evil.example:3100", "localhost.evil.example", "127.0.0.1.evil.example", "mypc.local"])("%s", async (host) => {
    const res = await post(makeApp(), host);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("forbidden_host");
    expect(body.message).toContain("TTF_ALLOWED_HOSTS");
  });

  test("PUT and DELETE are checked too", async () => {
    const app = makeApp();
    const headers = { "content-type": "application/json", host: "evil.example" };
    const put = await app.handle(new Request("http://127.0.0.1:3100/api/scenarios/x", { method: "PUT", headers, body: BODY }));
    expect(put.status).toBe(403);
    const del = await app.handle(new Request("http://127.0.0.1:3100/api/scenarios/x", { method: "DELETE", headers: { host: "evil.example" } }));
    expect(del.status).toBe(403);
  });

  test("a request with no Host header on a real socket is refused", async () => {
    const app = createApp({ dbPath, ttfDbPath: join(dir, `s-${++n}.sqlite`), allowedHosts: [], token: null });
    app.listen({ port: 0, hostname: "127.0.0.1" });
    try {
      const port = app.server!.port!;
      const reply = await new Promise<string>((resolve) => {
        const socket = net.connect(port, "127.0.0.1", () =>
          socket.write(`POST /api/scenarios HTTP/1.0\r\nContent-Type: application/json\r\nContent-Length: ${BODY.length}\r\n\r\n${BODY}`),
        );
        let data = "";
        socket.on("data", (chunk) => (data += chunk));
        socket.on("close", () => resolve(data));
        setTimeout(() => socket.destroy(), 1000);
      });
      expect(reply.split("\r\n")[0]).toContain("403");
      expect(reply).toContain("forbidden_host");
    } finally {
      await app.stop(true);
    }
  });
});

describe("reads are not restricted", () => {
  test("any Host can read", async () => {
    const app = makeApp();
    for (const path of ["/api/health", "/api/season", "/api/scenarios", "/api/access", "/api/feed/standings"]) {
      const res = await app.handle(new Request(`http://127.0.0.1:3100${path}`, { headers: { host: "evil.example:3100" } }));
      expect(res.status).toBe(200);
    }
  });
});

describe("order of the checks", () => {
  test("the host comes before the rate limiter: refused hosts never block anyone, and a blocked address still gets 403 for a bad host", async () => {
    const app = makeApp([], TOKEN);
    for (let i = 0; i < 10; i++) expect((await post(app, "evil.example")).status).toBe(403);
    // ten refused hosts are not failed attempts: a good request from the same address is not rate limited (401 = token, not 429)
    expect((await post(app, "127.0.0.1:3100")).status).toBe(401);
  });

  test("the host comes before the token: a bad host with no token gets 403, not 401", async () => {
    const res = await post(makeApp([], TOKEN), "evil.example");
    expect(res.status).toBe(403);
  });

  test("the host comes before Origin and Content-Type", async () => {
    const app = makeApp();
    const res = await app.handle(
      new Request("http://127.0.0.1:3100/api/scenarios", {
        method: "POST",
        headers: { host: "evil.example", origin: "http://evil.example", "content-type": "text/plain" },
        body: "x",
      }),
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("forbidden_host");
  });

  test("a good host still meets the older checks in their order", async () => {
    const app = makeApp([], TOKEN);
    const bad = await app.handle(
      new Request("http://127.0.0.1:3100/api/scenarios", { method: "POST", headers: { host: "127.0.0.1:3100", origin: "http://evil.example", "content-type": "application/json" }, body: BODY }),
    );
    expect(bad.status).toBe(403);
    expect(((await bad.json()) as { error: string }).error).toBe("forbidden");
    const media = await post(app, "127.0.0.1:3100", { "content-type": "text/plain" });
    expect(media.status).toBe(415);
    const ok = await post(app, "127.0.0.1:3100", { authorization: `Bearer ${TOKEN}` });
    expect(ok.status).toBe(201);
  });
});
