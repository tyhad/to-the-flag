/** Saved scenarios as the strip shows them (DESIGN.md section 6). Pure: no DOM, no fetch. */
import type { Scenario, SessionLock } from "../../engine";
import { sameScenario } from "./path";

/** One saved scenario as `/api/scenarios` returns it. */
export interface SavedScenario {
  id: string;
  name: string;
  season: number;
  /** The round the data was at when it was saved. */
  asOfRound: number;
  locks: Record<string, SessionLock>;
  contenders?: string[];
  /** Still passes validateScenario against the current data. */
  valid: boolean;
  /** Saved at an earlier round than the data is at now. */
  stale: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ScenarioChip {
  kind: "base" | "saved";
  /** null for Base. */
  id: string | null;
  name: string;
  selected: boolean;
  /** Shown on the overlay right now. Base is never marked. */
  live: boolean;
  valid: boolean;
  stale: boolean;
  /** "Round 14" for a stale scenario. */
  staleLabel: string | null;
  /** Why a stale or invalid scenario looks the way it does. */
  note: string | null;
}

export const MAX_NAME_LENGTH = 40;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseSavedScenario(body: unknown): SavedScenario | null {
  if (
    !isRecord(body) ||
    typeof body.id !== "string" ||
    typeof body.name !== "string" ||
    typeof body.season !== "number" ||
    typeof body.asOfRound !== "number" ||
    !isRecord(body.locks) ||
    typeof body.valid !== "boolean" ||
    typeof body.stale !== "boolean" ||
    typeof body.createdAt !== "string" ||
    typeof body.updatedAt !== "string"
  ) {
    return null;
  }
  const contenders = Array.isArray(body.contenders) ? body.contenders.filter((c): c is string => typeof c === "string") : undefined;
  return {
    id: body.id,
    name: body.name,
    season: body.season,
    asOfRound: body.asOfRound,
    locks: body.locks as Record<string, SessionLock>,
    ...(contenders ? { contenders } : {}),
    valid: body.valid,
    stale: body.stale,
    createdAt: body.createdAt,
    updatedAt: body.updatedAt,
  };
}

export function parseScenarioList(body: unknown): SavedScenario[] | null {
  if (!Array.isArray(body)) return null;
  const list: SavedScenario[] = [];
  for (const item of body) {
    const parsed = parseSavedScenario(item);
    if (!parsed) return null;
    list.push(parsed);
  }
  return list;
}

export function toScenario(saved: SavedScenario): Scenario {
  return { locks: saved.locks } as Scenario;
}

/** Base first, then saved scenarios in the order given. An unknown selected id selects Base. */
export function buildChips(
  asOfRound: number,
  saved: readonly SavedScenario[],
  selectedId: string | null,
  activeId: string | null,
): ScenarioChip[] {
  const known = selectedId !== null && saved.some((s) => s.id === selectedId);
  const chips: ScenarioChip[] = [
    {
      kind: "base",
      id: null,
      name: "Base",
      selected: !known,
      live: false,
      valid: true,
      stale: false,
      staleLabel: null,
      note: null,
    },
  ];
  for (const s of saved) {
    let note: string | null = null;
    if (!s.valid) {
      note =
        "This scenario no longer fits the current data, for example because a locked session has since run. It is kept so you can rename or delete it.";
    } else if (s.stale) {
      note = `Saved at Round ${s.asOfRound}. Data is now at Round ${asOfRound}, so the results may have changed.`;
    }
    chips.push({
      kind: "saved",
      id: s.id,
      name: s.name,
      selected: known && s.id === selectedId,
      live: s.id === activeId,
      valid: s.valid,
      stale: s.stale,
      staleLabel: s.stale ? `Round ${s.asOfRound}` : null,
      note,
    });
  }
  return chips;
}

/** True when the working scenario or contenders differ from what is saved. Nothing saved means not dirty. */
export function isDirty(working: Scenario, contenders: readonly string[], saved: SavedScenario | undefined): boolean {
  if (!saved) return false;
  if (!sameScenario(working, toScenario(saved))) return true;
  if (saved.contenders === undefined) return false;
  return saved.contenders.length !== contenders.length || saved.contenders.some((c, i) => c !== contenders[i]);
}

export type NameCheck = { ok: true; name: string } | { ok: false; message: string };

/** Trim and check a scenario name. `selfId` is the scenario being renamed, so keeping its own name is fine. */
export function validateScenarioName(raw: string, saved: readonly SavedScenario[], selfId?: string | null): NameCheck {
  const name = raw.trim();
  if (name === "") return { ok: false, message: "Give the scenario a name." };
  if (name.length > MAX_NAME_LENGTH) {
    return { ok: false, message: `Keep the name to ${MAX_NAME_LENGTH} characters or fewer.` };
  }
  if (name.toLowerCase() === "base") {
    return { ok: false, message: `"${name}" is the name of the real-results table. Pick another name.` };
  }
  const clash = saved.some((s) => s.id !== selfId && s.name.toLowerCase() === name.toLowerCase());
  if (clash) return { ok: false, message: `You already have a scenario called "${name}".` };
  return { ok: true, name };
}

/** A failed API call, in plain words. `status` is null when there was no response at all. */
export function apiErrorMessage(status: number | null, body: unknown): string {
  if (status === null) return "Could not reach the server. Check that it is running.";
  if (status === 404) return "That scenario no longer exists. It may have been deleted somewhere else.";
  if (status === 422) {
    const first = isRecord(body) && Array.isArray(body.errors) ? body.errors[0] : undefined;
    if (first === "Scenario name is required") return "Give the scenario a name.";
    return "The server did not accept that scenario. It may no longer fit the current data.";
  }
  if (isRecord(body) && typeof body.message === "string" && body.message !== "") return body.message;
  return `The server returned an error (${status}). Try again.`;
}
