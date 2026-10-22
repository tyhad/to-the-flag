import { describe, expect, test } from "bun:test";
import { createApp, validateServerStartup } from "../api/server";
import { buildFixtureDb } from "./dbHelpers";

const DB_PATH = buildFixtureDb();
const BASE = "http://127.0.0.1:3100";
const SECRET_TOKEN = "a-very-long-secret-token-1234";

describe("GET /api/access", () => {
  describe("when no token is configured", () => {
    test("loopback client can write without token", async () => {
      const app = createApp({
        dbPath: DB_PATH,
        clientIp: () => "127.0.0.1",
      });

      const res = await app.handle(new Request(`${BASE}/api/access`));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({
        writeRequiresToken: false,
        canWrite: true,
      });
    });

    test("remote client cannot write", async () => {
      const app = createApp({
        dbPath: DB_PATH,
        clientIp: () => "192.168.1.50",
      });

      const res = await app.handle(new Request(`${BASE}/api/access`));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({
        writeRequiresToken: false,
        canWrite: false,
      });
    });
  });

  describe("when token is configured", () => {
    test("client without token has canWrite = false", async () => {
      const app = createApp({
        dbPath: DB_PATH,
        token: SECRET_TOKEN,
        clientIp: () => "127.0.0.1",
      });

      const res = await app.handle(new Request(`${BASE}/api/access`));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({
        writeRequiresToken: true,
        canWrite: false,
      });
    });

    test("client with wrong token has canWrite = false", async () => {
      const app = createApp({
        dbPath: DB_PATH,
        token: SECRET_TOKEN,
        clientIp: () => "192.168.1.50",
      });

      const res = await app.handle(
        new Request(`${BASE}/api/access`, {
          headers: { Authorization: "Bearer wrong-token" },
        })
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({
        writeRequiresToken: true,
        canWrite: false,
      });
    });

    test("client with correct token has canWrite = true", async () => {
      const app = createApp({
        dbPath: DB_PATH,
        token: SECRET_TOKEN,
        clientIp: () => "192.168.1.50",
      });

      const res = await app.handle(
        new Request(`${BASE}/api/access`, {
          headers: { Authorization: `Bearer ${SECRET_TOKEN}` },
        })
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({
        writeRequiresToken: true,
        canWrite: true,
      });
    });
  });
});

describe("server startup validation", () => {
  test("allows loopback host without a token", () => {
    expect(validateServerStartup({ host: "127.0.0.1", token: "" })).toBeNull();
    expect(validateServerStartup({ host: "localhost" })).toBeNull();
  });

  test("refuses non-loopback host without a token or with a short token", () => {
    const err1 = validateServerStartup({ host: "0.0.0.0", token: "" });
    expect(err1).not.toBeNull();
    expect(err1).toContain("Set TTF_WRITE_TOKEN");

    const err2 = validateServerStartup({ host: "0.0.0.0", token: "short" });
    expect(err2).not.toBeNull();
    expect(err2).toContain("Set TTF_WRITE_TOKEN");

    const err3 = validateServerStartup({ host: "192.168.1.10", token: undefined });
    expect(err3).not.toBeNull();
  });

  test("allows non-loopback host with long token", () => {
    expect(
      validateServerStartup({
        host: "0.0.0.0",
        token: "1234567890123456",
      })
    ).toBeNull();
  });
});
