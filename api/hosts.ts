/**
 * api/hosts.ts - the Host allowlist for write routes (Phase 10, Step 2, D57). Pure, no I/O.
 *
 * A write is accepted only when the request's `Host` is `localhost`, an IP literal (any IPv4 or IPv6 address),
 * or a name listed in `TTF_ALLOWED_HOSTS`. Why: a DNS-rebinding page reaches this server through a host name it
 * controls, and a browser cannot send an IP literal as `Host` for such a page, so IP access (a phone on the LAN)
 * works with no setup and only named hosts (`mypc.local`) need listing. Reads are not restricted.
 */
import { isIP } from "node:net";

const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** Split a `TTF_ALLOWED_HOSTS` value: comma-separated, trimmed, lower-cased, empty entries dropped. Never throws. */
export function splitAllowedHosts(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== "");
}

/** Null when every entry is a plain host name (letters, digits, hyphens and dots); else a message naming the entry. */
export function validateAllowedHosts(entries: readonly string[]): string | null {
  for (const entry of entries) {
    const labels = entry.split(".");
    const plain = labels.every((label) => LABEL.test(label) && label.length <= 63) && entry.length <= 253;
    if (!plain) {
      return (
        `TTF_ALLOWED_HOSTS entry "${entry}" is not a plain host name. ` +
        "List host names only, separated by commas: no http://, no port, no path, no spaces (for example mypc.local)."
      );
    }
  }
  return null;
}

/**
 * The host name inside a `Host` header value, lower-cased, without the port: `LOCALHOST:3100` gives `localhost`,
 * `[::1]:3100` gives `::1`. Null when the value is missing or is not a host with an optional port.
 */
export function hostName(header: string | null | undefined): string | null {
  if (header === null || header === undefined) return null;
  const value = header.trim().toLowerCase();
  if (value === "") return null;
  let name: string;
  let port: string | undefined;
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    if (end < 0) return null;
    name = value.slice(1, end);
    const rest = value.slice(end + 1);
    if (rest !== "") {
      if (!rest.startsWith(":")) return null;
      port = rest.slice(1);
    }
    if (isIP(name) !== 6) return null;
  } else {
    const colon = value.indexOf(":");
    name = colon < 0 ? value : value.slice(0, colon);
    port = colon < 0 ? undefined : value.slice(colon + 1);
    if (name === "") return null;
  }
  if (port !== undefined && !/^\d{1,5}$/.test(port)) return null;
  return name;
}

/** True when a write may come in under this `Host` header value. `allowed` holds already lower-cased names. */
export function isAllowedHost(header: string | null | undefined, allowed: readonly string[] = []): boolean {
  const name = hostName(header);
  if (name === null) return false;
  if (name === "localhost") return true;
  if (isIP(name) !== 0) return true;
  return allowed.includes(name);
}
