import { describe, expect, test } from "bun:test";
import {
  isLoopbackAddress,
  isLoopbackHost,
  checkStartup,
  constantTimeCompare,
  decideWrite,
} from "../api/access";

describe("api/access: write access policy", () => {
  describe("isLoopbackAddress", () => {
    test("accepts 127.0.0.0/8 IPv4 loopback forms", () => {
      expect(isLoopbackAddress("127.0.0.1")).toBe(true);
      expect(isLoopbackAddress("127.0.0.0")).toBe(true);
      expect(isLoopbackAddress("127.255.255.255")).toBe(true);
      expect(isLoopbackAddress("127.42.0.99")).toBe(true);
    });

    test("accepts IPv6 loopback ::1", () => {
      expect(isLoopbackAddress("::1")).toBe(true);
    });

    test("accepts IPv4-mapped IPv6 loopback ::ffff:127.x.x.x", () => {
      expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
      expect(isLoopbackAddress("::FFFF:127.0.0.1")).toBe(true);
      expect(isLoopbackAddress("::ffff:127.20.0.1")).toBe(true);
    });

    test("rejects null, undefined, empty, and non-loopback addresses", () => {
      expect(isLoopbackAddress(null)).toBe(false);
      expect(isLoopbackAddress(undefined)).toBe(false);
      expect(isLoopbackAddress("")).toBe(false);
      expect(isLoopbackAddress("192.168.1.1")).toBe(false);
      expect(isLoopbackAddress("10.0.0.1")).toBe(false);
      expect(isLoopbackAddress("172.16.0.1")).toBe(false);
      expect(isLoopbackAddress("::ffff:192.168.1.1")).toBe(false);
      expect(isLoopbackAddress("::")).toBe(false);
      expect(isLoopbackAddress("fe80::1")).toBe(false);
      expect(isLoopbackAddress("localhost")).toBe(false);
      expect(isLoopbackAddress("127.0.0.256")).toBe(false);
      expect(isLoopbackAddress("127.0.0.1.1")).toBe(false);
    });
  });

  describe("isLoopbackHost", () => {
    test("recognizes loopback hosts", () => {
      expect(isLoopbackHost("127.0.0.1")).toBe(true);
      expect(isLoopbackHost("::1")).toBe(true);
      expect(isLoopbackHost("localhost")).toBe(true);
      expect(isLoopbackHost("LocalHost")).toBe(true);
      expect(isLoopbackHost("LOCALHOST")).toBe(true);
    });

    test("rejects wildcard and LAN hosts", () => {
      expect(isLoopbackHost("0.0.0.0")).toBe(false);
      expect(isLoopbackHost("::")).toBe(false);
      expect(isLoopbackHost("192.168.1.100")).toBe(false);
      expect(isLoopbackHost("10.0.0.5")).toBe(false);
      expect(isLoopbackHost("example.com")).toBe(false);
      expect(isLoopbackHost("")).toBe(false);
      expect(isLoopbackHost(null)).toBe(false);
      expect(isLoopbackHost(undefined)).toBe(false);
    });
  });

  describe("checkStartup", () => {
    test("passes when host is loopback, regardless of token", () => {
      expect(checkStartup({ host: "127.0.0.1" })).toBeNull();
      expect(checkStartup({ host: "127.0.0.1", token: "" })).toBeNull();
      expect(checkStartup({ host: "localhost", token: "short" })).toBeNull();
      expect(checkStartup({ host: "::1" })).toBeNull();
    });

    test("fails when host is non-loopback and token is missing or too short", () => {
      const expectedNotice = "Set TTF_WRITE_TOKEN to a long random value, or keep HOST=127.0.0.1";

      const r1 = checkStartup({ host: "0.0.0.0" });
      expect(r1).toContain(expectedNotice);

      const r2 = checkStartup({ host: "0.0.0.0", token: "" });
      expect(r2).toContain(expectedNotice);

      const r3 = checkStartup({ host: "0.0.0.0", token: "123456789012345" }); // 15 chars
      expect(r3).toContain(expectedNotice);

      const r4 = checkStartup({ host: "192.168.1.50", token: "too-short" });
      expect(r4).toContain(expectedNotice);

      const r5 = checkStartup({ host: "::", token: undefined });
      expect(r5).toContain(expectedNotice);
    });

    test("passes when host is non-loopback and token is at least 16 characters", () => {
      expect(checkStartup({ host: "0.0.0.0", token: "1234567890123456" })).toBeNull();
      expect(
        checkStartup({ host: "0.0.0.0", token: "a-secure-random-token-with-length" })
      ).toBeNull();
      expect(
        checkStartup({ host: "192.168.1.20", token: "super-secret-token-1234" })
      ).toBeNull();
    });
  });

  describe("constantTimeCompare", () => {
    test("returns true for matching strings", () => {
      expect(constantTimeCompare("secret-token-123", "secret-token-123")).toBe(true);
      expect(constantTimeCompare("", "")).toBe(true);
      expect(constantTimeCompare("a", "a")).toBe(true);
    });

    test("returns false for different content with equal length", () => {
      expect(constantTimeCompare("secret-token-123", "secret-token-456")).toBe(false);
      expect(constantTimeCompare("a", "b")).toBe(false);
    });

    test("returns false for different lengths", () => {
      expect(constantTimeCompare("short", "longer-string")).toBe(false);
      expect(constantTimeCompare("longer-string", "short")).toBe(false);
      expect(constantTimeCompare("secret", "secrets")).toBe(false);
      expect(constantTimeCompare("", "non-empty")).toBe(false);
      expect(constantTimeCompare("non-empty", "")).toBe(false);
    });
  });

  describe("decideWrite", () => {
    const TOKEN = "correct-horse-battery-staple-1234";

    describe("when token is configured", () => {
      test("allows valid token from loopback", () => {
        expect(
          decideWrite({
            token: TOKEN,
            clientIp: "127.0.0.1",
            presented: TOKEN,
          })
        ).toBe("allow");
      });

      test("allows valid token from remote client", () => {
        expect(
          decideWrite({
            token: TOKEN,
            clientIp: "192.168.1.150",
            presented: TOKEN,
          })
        ).toBe("allow");
      });

      test("denies missing token with deny-token", () => {
        expect(
          decideWrite({
            token: TOKEN,
            clientIp: "127.0.0.1",
            presented: null,
          })
        ).toBe("deny-token");

        expect(
          decideWrite({
            token: TOKEN,
            clientIp: "192.168.1.50",
            presented: undefined,
          })
        ).toBe("deny-token");

        expect(
          decideWrite({
            token: TOKEN,
            clientIp: "127.0.0.1",
            presented: "",
          })
        ).toBe("deny-token");
      });

      test("denies wrong token with deny-token", () => {
        expect(
          decideWrite({
            token: TOKEN,
            clientIp: "127.0.0.1",
            presented: "wrong-token",
          })
        ).toBe("deny-token");

        expect(
          decideWrite({
            token: TOKEN,
            clientIp: "192.168.1.50",
            presented: "wrong-token",
          })
        ).toBe("deny-token");
      });
    });

    describe("when no token is configured", () => {
      test("allows loopback clients without token", () => {
        expect(
          decideWrite({
            token: null,
            clientIp: "127.0.0.1",
            presented: null,
          })
        ).toBe("allow");

        expect(
          decideWrite({
            token: undefined,
            clientIp: "::1",
            presented: undefined,
          })
        ).toBe("allow");

        expect(
          decideWrite({
            token: "",
            clientIp: "::ffff:127.0.0.1",
            presented: null,
          })
        ).toBe("allow");
      });

      test("denies remote clients with deny-remote even if they present something", () => {
        expect(
          decideWrite({
            token: null,
            clientIp: "192.168.1.100",
            presented: null,
          })
        ).toBe("deny-remote");

        expect(
          decideWrite({
            token: undefined,
            clientIp: "10.0.0.5",
            presented: "anything",
          })
        ).toBe("deny-remote");

        expect(
          decideWrite({
            token: "",
            clientIp: null,
            presented: null,
          })
        ).toBe("deny-remote");
      });
    });
  });
});
