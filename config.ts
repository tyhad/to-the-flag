/**
 * Runtime configuration, read from environment variables.
 * Bun loads `.env` automatically. This file is outside `engine/`, so it may touch process.env.
 */
import { splitAllowedHosts } from "./api/hosts";

export interface Config {
  /** Path to the read-only F1GStats database. */
  f1gstatsDb: string;
  /** Path to the read-write scenario storage database. */
  ttfDb: string;
  port: number;
  host: string;
  /** Secret token required for write routes when host is not loopback. */
  writeToken: string;
  /**
   * Extra host names (lower-case, no port) that may send writes, from TTF_ALLOWED_HOSTS. `localhost` and IP literals
   * are always allowed. Entries are checked at start (`validateAllowedHosts`), not here.
   */
  allowedHosts: string[];
}

export const DEFAULTS = {
  f1gstatsDb: "../F1GStats/f1gstats.sqlite",
  ttfDb: "./to-the-flag.sqlite",
  port: 3100,
  host: "127.0.0.1",
  writeToken: "",
  allowedHosts: [] as string[],
} as const;

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULTS.port;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RangeError(`PORT must be an integer between 1 and 65535, got "${raw}"`);
  }
  return port;
}

function nonEmpty(raw: string | undefined, fallback: string): string {
  return raw !== undefined && raw.trim() !== "" ? raw.trim() : fallback;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    f1gstatsDb: nonEmpty(env.F1GSTATS_DB, DEFAULTS.f1gstatsDb),
    ttfDb: nonEmpty(env.TTF_DB, DEFAULTS.ttfDb),
    port: parsePort(env.PORT),
    host: nonEmpty(env.HOST, DEFAULTS.host),
    writeToken: nonEmpty(env.TTF_WRITE_TOKEN, DEFAULTS.writeToken),
    allowedHosts: splitAllowedHosts(env.TTF_ALLOWED_HOSTS),
  };
}

export const config: Config = loadConfig();
