/**
 * Write guard tests (Phase 6 Step 2).
 * Tests enforcement of access policy on POST, PUT, DELETE write routes:
 * 401 token_required, 403 local_only, 415 non-JSON body, 403 Origin mismatch, 429 rate limit.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../api/server";
import { resetWriteRateLimits } from "../api/guard";
import { buildFixtureDb, cleanupDbs } from "./dbHelpers";

const BASE = "http://127.0.0.1:3100";
const SECRET_TOKEN = "test-secret-token-123456789";

let DB_PATH = "";
let TTF_DIR = "";
let TTF_DB = "";
let ttfCount = 0;

beforeAll(() => {
  DB_PATH = buildFixtureDb();
  TTF_DIR = mkdtempSync(join(tmpdir(), "ttf-guard-test-"));
});

afterAll(() => {
  cleanupDbs();
  try {
    rmSync(TTF_DIR, { recursive: true, force: true });
  } catch {
    // Windows file handle cleanup
  }
});

beforeEach(() => {
  TTF_DB = join(TTF_DIR, `scenarios-${++ttfCount}.sqlite`);
  resetWriteRateLimits();
});

const samplePayload = {
  name: "Guard Test Scenario",
  locks: { "17:race": { fixed: { NOR: 1 } } },
  contenders: ["NOR"],
};

describe("api/guard: write route protection", () => {
  describe("reads stay open", () => {
    test("GET requests succeed without a token even when token is configured", async () => {
      const appWithToken = createApp({
        dbPath: DB_PATH,
        ttfDbPath: TTF_DB,
        token: SECRET_TOKEN,
        clientIp: () => "192.168.1.100", // remote client
      });

      const resList = await appWithToken.handle(new Request(`${BASE}/api/scenarios`));
      expect(resList.status).toBe(200);

      const resActive = await appWithToken.handle(new Request(`${BASE}/api/active-scenario`));
      expect(resActive.status).toBe(200);

      const resHealth = await appWithToken.handle(new Request(`${BASE}/api/health`));
      expect(resHealth.status).toBe(200);
    });

    test("GET requests succeed when no token is configured", async () => {
      const app = createApp({
        dbPath: DB_PATH,
        ttfDbPath: TTF_DB,
        clientIp: () => "192.168.1.100",
      });

      const resList = await app.handle(new Request(`${BASE}/api/scenarios`));
      expect(resList.status).toBe(200);
    });
  });

  describe("when no token is configured (local-only default)", () => {
    test("loopback client can write (POST, PUT, DELETE)", async () => {
      const app = createApp({
        dbPath: DB_PATH,
        ttfDbPath: TTF_DB,
        clientIp: () => "127.0.0.1",
      });

      // POST
      const resPost = await app.handle(
        new Request(`${BASE}/api/scenarios`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(samplePayload),
        })
      );
      expect(resPost.status).toBe(201);
      const created = (await resPost.json()) as any;
      expect(created.id).toBeTruthy();

      // PUT
      const resPut = await app.handle(
        new Request(`${BASE}/api/scenarios/${created.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Updated Name" }),
        })
      );
      expect(resPut.status).toBe(200);

      // DELETE
      const resDel = await app.handle(
        new Request(`${BASE}/api/scenarios/${created.id}`, {
          method: "DELETE",
        })
      );
      expect(resDel.status).toBe(200);
    });

    test("remote client cannot write and receives 403 local_only", async () => {
      const app = createApp({
        dbPath: DB_PATH,
        ttfDbPath: TTF_DB,
        clientIp: () => "192.168.1.100",
      });

      const resPost = await app.handle(
        new Request(`${BASE}/api/scenarios`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(samplePayload),
        })
      );
      expect(resPost.status).toBe(403);
      const jsonPost = (await resPost.json()) as any;
      expect(jsonPost.error).toBe("local_only");
      expect(typeof jsonPost.message).toBe("string");

      const resPut = await app.handle(
        new Request(`${BASE}/api/scenarios/any-id`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Attempt" }),
        })
      );
      expect(resPut.status).toBe(403);
      expect(((await resPut.json()) as any).error).toBe("local_only");

      const resDel = await app.handle(
        new Request(`${BASE}/api/scenarios/any-id`, {
          method: "DELETE",
        })
      );
      expect(resDel.status).toBe(403);
      expect(((await resDel.json()) as any).error).toBe("local_only");
    });
  });

  describe("when token is configured", () => {
    test("rejects missing or empty token with 401 token_required", async () => {
      const app = createApp({
        dbPath: DB_PATH,
        ttfDbPath: TTF_DB,
        token: SECRET_TOKEN,
        clientIp: () => "127.0.0.1",
      });

      const res = await app.handle(
        new Request(`${BASE}/api/scenarios`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(samplePayload),
        })
      );
      expect(res.status).toBe(401);
      const json = (await res.json()) as any;
      expect(json.error).toBe("token_required");
      expect(typeof json.message).toBe("string");
    });

    test("rejects wrong token with 401 token_required", async () => {
      const app = createApp({
        dbPath: DB_PATH,
        ttfDbPath: TTF_DB,
        token: SECRET_TOKEN,
        clientIp: () => "192.168.1.50",
      });

      const res = await app.handle(
        new Request(`${BASE}/api/scenarios`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer wrong-token-xyz",
          },
          body: JSON.stringify(samplePayload),
        })
      );
      expect(res.status).toBe(401);
      const json = (await res.json()) as any;
      expect(json.error).toBe("token_required");
    });

    test("accepts valid token from remote client or loopback", async () => {
      const app = createApp({
        dbPath: DB_PATH,
        ttfDbPath: TTF_DB,
        token: SECRET_TOKEN,
        clientIp: () => "192.168.1.50",
      });

      const res = await app.handle(
        new Request(`${BASE}/api/scenarios`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SECRET_TOKEN}`,
          },
          body: JSON.stringify(samplePayload),
        })
      );
      expect(res.status).toBe(201);
    });
  });

  describe("media type validation (415)", () => {
    test("rejects POST/PUT with missing or non-JSON Content-Type with 415", async () => {
      const app = createApp({
        dbPath: DB_PATH,
        ttfDbPath: TTF_DB,
        clientIp: () => "127.0.0.1",
      });

      const resText = await app.handle(
        new Request(`${BASE}/api/scenarios`, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: "not json",
        })
      );
      expect(resText.status).toBe(415);

      const resNoCt = await app.handle(
        new Request(`${BASE}/api/scenarios`, {
          method: "POST",
          body: "{}",
        })
      );
      expect(resNoCt.status).toBe(415);
    });

    test("DELETE without a body or Content-Type is not rejected with 415", async () => {
      const app = createApp({
        dbPath: DB_PATH,
        ttfDbPath: TTF_DB,
        clientIp: () => "127.0.0.1",
      });

      const resDel = await app.handle(
        new Request(`${BASE}/api/scenarios/non-existent`, {
          method: "DELETE",
        })
      );
      expect(resDel.status).toBe(404); // reached scenario route handler!
    });
  });

  describe("Origin header validation (403)", () => {
    test("allows request when Origin matches server origin", async () => {
      const app = createApp({
        dbPath: DB_PATH,
        ttfDbPath: TTF_DB,
        clientIp: () => "127.0.0.1",
      });

      const res = await app.handle(
        new Request(`${BASE}/api/scenarios`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://127.0.0.1:3100",
          },
          body: JSON.stringify(samplePayload),
        })
      );
      expect(res.status).toBe(201);
    });

    test("rejects request when Origin does not match server origin", async () => {
      const app = createApp({
        dbPath: DB_PATH,
        ttfDbPath: TTF_DB,
        clientIp: () => "127.0.0.1",
      });

      const res = await app.handle(
        new Request(`${BASE}/api/scenarios`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://malicious-website.com",
          },
          body: JSON.stringify(samplePayload),
        })
      );
      expect(res.status).toBe(403);
    });
  });

  describe("rate limiting (429)", () => {
    test("locks out an address after 5 failed attempts within a minute", async () => {
      const app = createApp({
        dbPath: DB_PATH,
        ttfDbPath: TTF_DB,
        token: SECRET_TOKEN,
        clientIp: () => "192.168.1.99",
      });

      // 5 failed attempts
      for (let i = 0; i < 5; i++) {
        const res = await app.handle(
          new Request(`${BASE}/api/scenarios`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer wrong-token",
            },
            body: JSON.stringify(samplePayload),
          })
        );
        expect(res.status).toBe(401);
      }

      // 6th attempt should be rate limited (429)
      const res6 = await app.handle(
        new Request(`${BASE}/api/scenarios`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer wrong-token",
          },
          body: JSON.stringify(samplePayload),
        })
      );
      expect(res6.status).toBe(429);
      const json6 = (await res6.json()) as any;
      expect(json6.message).toMatch(/too many|try again/i);

      // Even with the correct token, the address remains locked out
      const resLocked = await app.handle(
        new Request(`${BASE}/api/scenarios`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SECRET_TOKEN}`,
          },
          body: JSON.stringify(samplePayload),
        })
      );
      expect(resLocked.status).toBe(429);
    });

    test("rate limit is per address and does not block other addresses", async () => {
      let currentIp = "10.0.0.1";
      const app = createApp({
        dbPath: DB_PATH,
        ttfDbPath: TTF_DB,
        token: SECRET_TOKEN,
        clientIp: () => currentIp,
      });

      // 5 failures for 10.0.0.1
      for (let i = 0; i < 5; i++) {
        await app.handle(
          new Request(`${BASE}/api/scenarios`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(samplePayload),
          })
        );
      }

      // 10.0.0.1 is 429
      const res1 = await app.handle(
        new Request(`${BASE}/api/scenarios`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(samplePayload),
        })
      );
      expect(res1.status).toBe(429);

      // 10.0.0.2 is not blocked and can succeed with valid token
      currentIp = "10.0.0.2";
      const res2 = await app.handle(
        new Request(`${BASE}/api/scenarios`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SECRET_TOKEN}`,
          },
          body: JSON.stringify(samplePayload),
        })
      );
      expect(res2.status).toBe(201);
    });

    test("rate limit can be reset", async () => {
      const app = createApp({
        dbPath: DB_PATH,
        ttfDbPath: TTF_DB,
        token: SECRET_TOKEN,
        clientIp: () => "10.0.0.5",
      });

      for (let i = 0; i < 5; i++) {
        await app.handle(
          new Request(`${BASE}/api/scenarios`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(samplePayload),
          })
        );
      }

      expect(
        (
          await app.handle(
            new Request(`${BASE}/api/scenarios`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(samplePayload),
            })
          )
        ).status
      ).toBe(429);

      resetWriteRateLimits();

      // After reset, it gets 401 instead of 429
      const afterReset = await app.handle(
        new Request(`${BASE}/api/scenarios`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(samplePayload),
        })
      );
      expect(afterReset.status).toBe(401);
    });
  });

  describe("security: no token in response or headers", () => {
    test("token is never leaked in 401 or 403 responses", async () => {
      const app = createApp({
        dbPath: DB_PATH,
        ttfDbPath: TTF_DB,
        token: SECRET_TOKEN,
        clientIp: () => "127.0.0.1",
      });

      const res = await app.handle(
        new Request(`${BASE}/api/scenarios`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(samplePayload),
        })
      );

      const text = await res.text();
      expect(text).not.toContain(SECRET_TOKEN);

      for (const [name, val] of res.headers.entries()) {
        expect(val).not.toContain(SECRET_TOKEN);
        expect(name.toLowerCase()).not.toContain("access-control"); // No CORS headers
      }
    });
  });
});
