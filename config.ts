/**
 * Runtime configuration, read from environment variables.
 * Bun loads `.env` automatically. This file is outside `engine/`, so it may touch process.env.
 */

export interface Config {
  /** Path to the read-only F1GStats database. */
  f1gstatsDb: string;
  port: number;
  host: string;
}

export const DEFAULTS = {
  f1gstatsDb: "../F1GStats/f1gstats.sqlite",
  port: 3100,
  host: "127.0.0.1",
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
    port: parsePort(env.PORT),
    host: nonEmpty(env.HOST, DEFAULTS.host),
  };
}

export const config: Config = loadConfig();
