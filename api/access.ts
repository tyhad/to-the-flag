/**
 * api/access.ts - pure write access policy and loopback checks.
 * No I/O or network calls.
 */
import { timingSafeEqual } from "node:crypto";

function isValidIpv4Octet(part: string): boolean {
  if (!/^\d+$/.test(part)) return false;
  const num = Number(part);
  return num >= 0 && num <= 255 && String(num) === part;
}

function is127Ipv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  if (parts[0] !== "127") return false;
  return parts.slice(1).every(isValidIpv4Octet);
}

/**
 * Returns true for 127.0.0.0/8, ::1, and IPv4-mapped IPv6 ::ffff:127.x.x.x.
 * Returns false for anything else, including null / undefined.
 */
export function isLoopbackAddress(ip: string | null | undefined): boolean {
  if (!ip) return false;
  const trimmed = ip.trim();
  if (trimmed === "::1") return true;
  if (is127Ipv4(trimmed)) return true;
  if (trimmed.toLowerCase().startsWith("::ffff:")) {
    const rest = trimmed.slice(7);
    if (is127Ipv4(rest)) return true;
  }
  return false;
}

/**
 * Returns true for 127.0.0.1, ::1, and localhost.
 * Wildcard (0.0.0.0, ::) and LAN addresses are not loopback.
 */
export function isLoopbackHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const h = host.trim().toLowerCase();
  return h === "127.0.0.1" || h === "::1" || h === "localhost";
}

export interface StartupConfig {
  host?: string | null;
  token?: string | null;
}

/**
 * Validates startup parameters.
 * Returns an error message if host is non-loopback and token is missing or shorter than 16 chars;
 * returns null otherwise.
 */
export function checkStartup({ host, token }: StartupConfig): string | null {
  if (isLoopbackHost(host)) {
    return null;
  }
  const cleanToken = token ? token.trim() : "";
  if (cleanToken.length < 16) {
    return "Set TTF_WRITE_TOKEN to a long random value, or keep HOST=127.0.0.1";
  }
  return null;
}

/**
 * Compares two strings in constant time to avoid timing attacks.
 */
export function constantTimeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export type WriteDecision = "allow" | "deny-token" | "deny-remote";

export interface DecideWriteOptions {
  token?: string | null;
  clientIp?: string | null;
  presented?: string | null;
}

/**
 * Decides whether a write action is permitted:
 * - "allow"
 * - "deny-token": a token is configured and presented is missing or wrong
 * - "deny-remote": no token configured and the client is not on this computer
 */
export function decideWrite({
  token,
  clientIp,
  presented,
}: DecideWriteOptions): WriteDecision {
  const isTokenConfigured = Boolean(token && token.length > 0);

  if (isTokenConfigured) {
    if (typeof presented === "string" && presented.length > 0) {
      if (constantTimeCompare(token!, presented)) {
        return "allow";
      }
    }
    return "deny-token";
  }

  if (isLoopbackAddress(clientIp)) {
    return "allow";
  }

  return "deny-remote";
}
