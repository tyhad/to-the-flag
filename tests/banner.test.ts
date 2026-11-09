import { describe, expect, test } from "bun:test";
import { buildStartupBanner } from "../api/banner";
import type { NetworkInterfaceInfo } from "node:os";

describe("api/banner: startup banner", () => {
  const mockInterfaces: Record<string, NetworkInterfaceInfo[]> = {
    lo: [
      {
        address: "127.0.0.1",
        netmask: "255.0.0.0",
        family: "IPv4",
        mac: "00:00:00:00:00:00",
        internal: true,
        cidr: "127.0.0.1/8",
      },
    ],
    eth0: [
      {
        address: "192.168.1.42",
        netmask: "255.255.255.0",
        family: "IPv4",
        mac: "00:11:22:33:44:55",
        internal: false,
        cidr: "192.168.1.42/24",
      },
      {
        address: "fe80::1234",
        netmask: "ffff:ffff:ffff:ffff::",
        family: "IPv6",
        mac: "00:11:22:33:44:55",
        internal: false,
        cidr: "fe80::1234/64",
        scopeid: 0,
      },
    ],
    wlan0: [
      {
        address: "10.0.0.15",
        netmask: "255.255.255.0",
        family: "IPv4",
        mac: "66:77:88:99:aa:bb",
        internal: false,
        cidr: "10.0.0.15/24",
      },
    ],
  };

  test("loopback host without token", () => {
    const banner = buildStartupBanner({
      host: "127.0.0.1",
      port: 3100,
      token: "",
      networkInterfaces: () => mockInterfaces,
    });

    expect(banner).toContain("http://127.0.0.1:3100");
    expect(banner).toContain("Writing: this computer only");
    expect(banner).not.toContain("Writing: needs the token");
    expect(banner).not.toContain("192.168.1.42");
  });

  test("loopback host with token", () => {
    const banner = buildStartupBanner({
      host: "127.0.0.1",
      port: 3100,
      token: "secret-token-123456",
      networkInterfaces: () => mockInterfaces,
    });

    expect(banner).toContain("http://127.0.0.1:3100");
    expect(banner).toContain("Writing: needs the token");
    expect(banner).not.toContain("Writing: this computer only");
  });

  test("wildcard host (0.0.0.0) lists local and LAN IPv4 URLs", () => {
    const banner = buildStartupBanner({
      host: "0.0.0.0",
      port: 3100,
      token: "secret-token-123456",
      networkInterfaces: () => mockInterfaces,
    });

    expect(banner).toContain("http://127.0.0.1:3100");
    expect(banner).toContain("http://192.168.1.42:3100");
    expect(banner).toContain("http://10.0.0.15:3100");
    // Does not include IPv6
    expect(banner).not.toContain("fe80::1234");
    expect(banner).toContain("Writing: needs the token");
  });

  test("LAN host without token says this computer only", () => {
    const banner = buildStartupBanner({
      host: "0.0.0.0",
      port: 3100,
      token: null,
      networkInterfaces: () => mockInterfaces,
    });

    expect(banner).toContain("Writing: this computer only");
  });
});
