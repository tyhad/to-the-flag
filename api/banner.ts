/**
 * api/banner.ts - Builds formatted server startup banner.
 */
import { networkInterfaces as osNetworkInterfaces, type NetworkInterfaceInfo } from "node:os";
import { isLoopbackHost } from "./access";

export interface BannerOptions {
  host: string;
  port: number;
  token?: string | null;
  /** Injectable network interfaces for testing */
  networkInterfaces?: () => Record<string, NetworkInterfaceInfo[] | undefined>;
}

export function buildStartupBanner({
  host,
  port,
  token,
  networkInterfaces = osNetworkInterfaces,
}: BannerOptions): string {
  const isLoopback = isLoopbackHost(host);
  const writeNotice =
    token && token.length > 0 ? "Writing: needs the token" : "Writing: this computer only";

  const lines: string[] = [];
  lines.push("To the Flag is running:");

  const localUrl = `http://127.0.0.1:${port}`;
  lines.push(`  Local:   ${localUrl}`);

  if (!isLoopback) {
    const ifaces = networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      const list = ifaces[name];
      if (!list) continue;
      for (const info of list) {
        // IPv4 only, non-internal, non-loopback
        const isIpv4 = info.family === "IPv4" || (info.family as any) === 4;
        if (isIpv4 && !info.internal && !info.address.startsWith("127.")) {
          lines.push(`  Network: http://${info.address}:${port}`);
        }
      }
    }
  }

  lines.push(`  ${writeNotice}`);
  return lines.join("\n");
}
