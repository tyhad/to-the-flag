/**
 * api/scenarioFile.ts - the scenario file (Phase 10, Step 3, D58). Pure: no I/O, no clock, no ids.
 *
 * One JSON file, `format` "to-the-flag-scenarios", `version` 1. For each scenario: name, season, as-of round, locks
 * and contenders. No ids, no timestamps, no token, no server address, no path, no grid.
 *
 * Import never trusts the file. It keeps only what it can read as a scenario of the current season, copies the
 * pieces it knows into fresh objects (nothing from the file is merged into anything), and says why it skipped
 * the rest. The checks of an ordinary save (`validateScenario`) are the only rules for locks.
 */
import { InvalidScenarioError, validateScenario } from "../engine/scenario";
import type { SeasonState, SessionKey, SessionLock } from "../engine/types";

export const FILE_FORMAT = "to-the-flag-scenarios";
export const FILE_VERSION = 1;
export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_SCENARIOS = 200;
/** Same limit as the name field in the UI. */
export const MAX_NAME_LENGTH = 40;

const TIERS = ["lt25", "ge25", "ge50", "full"] as const;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_DRIVERS_PER_LOCK = 30;

export interface FileScenario {
  name: string;
  season: number;
  asOfRound: number;
  locks: Record<SessionKey, SessionLock>;
  contenders?: string[];
}

export interface ScenarioFile {
  format: typeof FILE_FORMAT;
  version: typeof FILE_VERSION;
  scenarios: FileScenario[];
}

/** What the file needs of a saved scenario. */
export interface ExportableScenario {
  name: string;
  season: number;
  asOfRound: number;
  locks: Record<SessionKey, SessionLock>;
  contenders?: string[];
}

/** The file name the browser saves it as. */
export function exportFileName(state: SeasonState): string {
  return `to-the-flag-scenarios-${state.season}-r${state.asOfRound}.json`;
}

/**
 * The saved scenarios of the current season, copied down to the five fields of the file (so nothing else a
 * stored row carries, such as an id or a timestamp, can reach it).
 */
export function buildScenarioFile(saved: readonly ExportableScenario[], state: SeasonState): ScenarioFile {
  return {
    format: FILE_FORMAT,
    version: FILE_VERSION,
    scenarios: saved
      .filter((s) => s.season === state.season)
      .map((s) => ({
        name: s.name,
        season: s.season,
        asOfRound: s.asOfRound,
        locks: s.locks,
        ...(s.contenders ? { contenders: [...s.contenders] } : {}),
      })),
  };
}

export type FileRefusal = "too_large" | "not_json" | "wrong_format" | "unsupported_version" | "wrong_type" | "too_many";

export interface SkippedScenario {
  /** Position in the file, from 1. */
  index: number;
  /** The name as far as it could be read, or "" when there is none. */
  name: string;
  reason: string;
}

export interface AcceptedScenario extends FileScenario {
  /** The name before a duplicate was renamed, when it was. */
  requestedName?: string;
}

export type ParseResult =
  | { ok: false; code: FileRefusal; message: string }
  | { ok: true; accepted: AcceptedScenario[]; skipped: SkippedScenario[] };

const refuse = (code: FileRefusal, message: string): ParseResult => ({ ok: false, code, message });

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** True when `value` has a forbidden key anywhere inside it. Own keys only; JSON has no other kind. */
function hasForbiddenKey(value: unknown, depth = 0): boolean {
  if (depth > 8 || typeof value !== "object" || value === null) return false;
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value);
  return entries.some(([key, item]) => FORBIDDEN_KEYS.has(key) || hasForbiddenKey(item, depth + 1));
}

/** The name with a number after it that makes it new: "Late", "Late (2)", "Late (3)". Compared without case. */
export function uniqueName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const candidate = `${name.slice(0, MAX_NAME_LENGTH - suffix.length).trimEnd()}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** Reads one entry. Returns the clean scenario, or the reason it cannot be used. */
function readEntry(entry: unknown, state: SeasonState): { value: FileScenario } | { reason: string } {
  if (!isPlainObject(entry)) return { reason: "It is not a scenario (an object was expected)." };
  if (hasForbiddenKey(entry)) return { reason: "It contains a key that is not allowed." };

  const name = typeof entry.name === "string" ? entry.name.trim() : "";
  if (name === "") return { reason: "It has no name." };
  if (name.length > MAX_NAME_LENGTH) return { reason: `The name is longer than ${MAX_NAME_LENGTH} characters.` };

  const { season, asOfRound } = entry;
  if (!Number.isInteger(season) || !Number.isInteger(asOfRound)) {
    return { reason: "Its season or as-of round is missing or is not a whole number." };
  }
  if (season !== state.season) return { reason: `It is for season ${String(season)}, and this app is on season ${state.season}.` };
  if ((asOfRound as number) < 0 || (asOfRound as number) > state.asOfRound) {
    return { reason: `It was made after round ${String(asOfRound)}, but the data here only goes to round ${state.asOfRound}.` };
  }

  if (!isPlainObject(entry.locks)) return { reason: "Its locks are missing or are not an object." };
  const locks: Record<SessionKey, SessionLock> = {};
  for (const [key, lock] of Object.entries(entry.locks)) {
    if (!isPlainObject(lock) || !isPlainObject(lock.fixed)) return { reason: `${key}: the lock is not in the expected shape.` };
    const fixedEntries = Object.entries(lock.fixed);
    if (fixedEntries.length > MAX_DRIVERS_PER_LOCK) return { reason: `${key}: too many drivers locked.` };
    for (const [driver, place] of fixedEntries) {
      if (place !== "out" && !Number.isInteger(place)) {
        return { reason: `${key}: ${driver} has a position that is not a whole number or "out".` };
      }
    }
    if (lock.tier !== undefined && !(typeof lock.tier === "string" && (TIERS as readonly string[]).includes(lock.tier))) {
      return { reason: `${key}: unknown distance tier.` };
    }
    locks[key as SessionKey] = {
      fixed: Object.fromEntries(fixedEntries) as SessionLock["fixed"],
      ...(lock.tier !== undefined ? { tier: lock.tier as SessionLock["tier"] } : {}),
    };
  }

  let contenders: string[] | undefined;
  if (entry.contenders !== undefined && entry.contenders !== null) {
    const list = entry.contenders;
    if (!Array.isArray(list) || list.length > state.drivers.length || list.some((c) => typeof c !== "string")) {
      return { reason: "Its contenders are not a list of driver codes." };
    }
    const known = new Set(state.drivers.map((d) => d.code));
    const unknown = (list as string[]).find((code) => !known.has(code));
    if (unknown !== undefined) return { reason: `Contender ${unknown} is not a driver of this season.` };
    contenders = [...new Set(list as string[])];
  }

  try {
    validateScenario(state, { locks });
  } catch (err) {
    if (err instanceof InvalidScenarioError) return { reason: `${err.message}.` };
    return { reason: "Its locks do not fit this season." };
  }

  return {
    value: { name, season: season as number, asOfRound: asOfRound as number, locks, ...(contenders ? { contenders } : {}) },
  };
}

/**
 * Reads the text of a scenario file. `existingNames` are the names already saved; a scenario that would repeat
 * one (or one earlier in the same file) is renamed, never merged and never overwritten.
 */
export function parseScenarioFile(text: string, state: SeasonState, existingNames: readonly string[]): ParseResult {
  if (Buffer.byteLength(text, "utf8") > MAX_FILE_BYTES) {
    return refuse("too_large", `The file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return refuse("not_json", "The file is not valid JSON.");
  }
  if (!isPlainObject(data) || data.format !== FILE_FORMAT) {
    return refuse("wrong_format", "This is not a To the Flag scenario file.");
  }
  if (data.version !== FILE_VERSION) {
    return refuse(
      "unsupported_version",
      `This file is version ${typeof data.version === "number" ? data.version : "unknown"}; this app reads version ${FILE_VERSION}.`,
    );
  }
  if (!Array.isArray(data.scenarios)) return refuse("wrong_type", "The file has no list of scenarios.");
  if (data.scenarios.length > MAX_SCENARIOS) {
    return refuse("too_many", `The file has ${data.scenarios.length} scenarios; the limit is ${MAX_SCENARIOS}.`);
  }

  const taken = new Set(existingNames.map((n) => n.toLowerCase()));
  const accepted: AcceptedScenario[] = [];
  const skipped: SkippedScenario[] = [];
  data.scenarios.forEach((entry: unknown, i: number) => {
    const read = readEntry(entry, state);
    if ("reason" in read) {
      const rawName = isPlainObject(entry) && typeof entry.name === "string" ? entry.name.slice(0, MAX_NAME_LENGTH) : "";
      skipped.push({ index: i + 1, name: rawName, reason: read.reason });
      return;
    }
    const name = uniqueName(read.value.name, taken);
    taken.add(name.toLowerCase());
    accepted.push(name === read.value.name ? read.value : { ...read.value, name, requestedName: read.value.name });
  });
  return { ok: true, accepted, skipped };
}
