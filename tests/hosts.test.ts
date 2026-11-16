/** Host allowlist, pure part (Phase 10, Step 2, D57). */
import { describe, expect, test } from "bun:test";
import { checkStartup } from "../api/access";
import { hostName, isAllowedHost, splitAllowedHosts, validateAllowedHosts } from "../api/hosts";

describe("hostName", () => {
  test("takes the name out of a Host header, without the port, lower-cased", () => {
    expect(hostName("127.0.0.1:3100")).toBe("127.0.0.1");
    expect(hostName("LOCALHOST:3100")).toBe("localhost");
    expect(hostName("localhost")).toBe("localhost");
    expect(hostName("[::1]:3100")).toBe("::1");
    expect(hostName("[::1]")).toBe("::1");
    expect(hostName("[fe80::1]:3100")).toBe("fe80::1");
    expect(hostName("MyPC.local:80")).toBe("mypc.local");
  });

  test("missing, empty or malformed values give null", () => {
    for (const bad of [null, undefined, "", "   ", ":3100", "host:", "host:port", "host:123456", "[::1", "[::1]x", "[nope]:3100", "a:1:2"]) {
      expect(hostName(bad)).toBeNull();
    }
  });
});

describe("isAllowedHost", () => {
  const allowed = ["mypc.local"];

  test("accepted: localhost, any IP literal, and a listed name", () => {
    for (const host of [
      "127.0.0.1:3100",
      "localhost",
      "LOCALHOST:3100",
      "[::1]:3100",
      "192.168.1.20:3100",
      "10.0.0.5",
      "[fd00::1234]:3100",
      "mypc.local",
      "MyPC.LOCAL:3100",
    ]) {
      expect(isAllowedHost(host, allowed)).toBe(true);
    }
  });

  test("rejected: other names, look-alikes and a missing Host", () => {
    for (const host of [
      "evil.example:3100",
      "localhost.evil.example",
      "localhost.evil.example:3100",
      "127.0.0.1.evil.example",
      "127.0.0.1.evil.example:3100",
      "mypc.local.evil.example",
      "evilmypc.local",
      "256.1.1.1.example",
      "",
      null,
      undefined,
    ]) {
      expect(isAllowedHost(host, allowed)).toBe(false);
    }
  });

  test("a listed name is not allowed unless listed", () => {
    expect(isAllowedHost("mypc.local")).toBe(false);
    expect(isAllowedHost("mypc.local", [])).toBe(false);
  });

  test("a number that is not an IP address is not an IP literal", () => {
    expect(isAllowedHost("2130706433")).toBe(false);
    expect(isAllowedHost("999.999.999.999")).toBe(false);
  });
});

describe("TTF_ALLOWED_HOSTS entries", () => {
  test("split", () => {
    expect(splitAllowedHosts(undefined)).toEqual([]);
    expect(splitAllowedHosts("A.local,b")).toEqual(["a.local", "b"]);
  });

  test("plain names pass", () => {
    expect(validateAllowedHosts([])).toBeNull();
    expect(validateAllowedHosts(["mypc.local", "laptop", "a-b.c1"])).toBeNull();
  });

  test("a scheme, port, path, space, wildcard or edge hyphen is refused, naming the entry", () => {
    for (const bad of ["http://mypc.local", "mypc.local:3100", "mypc.local/x", "my pc", "*.local", "-a.local", "a-.local", "a..b", ".a", "a.", "mypc_local"]) {
      const message = validateAllowedHosts(["ok.local", bad]);
      expect(message).toContain(`"${bad}"`);
      expect(message).toContain("TTF_ALLOWED_HOSTS");
    }
  });
});

describe("checkStartup", () => {
  test("an invalid entry stops the start, even on a loopback host", () => {
    const message = checkStartup({ host: "127.0.0.1", allowedHosts: ["http://x.local"] });
    expect(message).toContain("TTF_ALLOWED_HOSTS");
  });

  test("valid entries change nothing", () => {
    expect(checkStartup({ host: "127.0.0.1", allowedHosts: ["mypc.local"] })).toBeNull();
    expect(checkStartup({ host: "0.0.0.0", token: "x".repeat(16), allowedHosts: ["mypc.local"] })).toBeNull();
    expect(checkStartup({ host: "0.0.0.0", token: "short", allowedHosts: ["mypc.local"] })).toContain("TTF_WRITE_TOKEN");
  });
});
