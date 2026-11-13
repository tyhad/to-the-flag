/**
 * The starting grid in the page (Phase 8, Step 3): the source tag, the "OpenF1 has a different grid" notice and the
 * state behind its two buttons. Pure: no DOM, no fetch, no timers. The server decides which grid is in use
 * (`GET /api/grid`); this file only words it and remembers what the owner dismissed.
 */
import type { AccessVerdict } from "./access";

/** Where the grid in use comes from. */
export type GridSource = "manual" | "openf1" | "qualifying";

/** The answer of `GET /api/grid`, checked. */
export interface GridInfo {
  /** The next race, or null when none is left. */
  round: number | null;
  /** The grid in use; `pit` is only known for a manual grid. */
  effective: { order: string[]; pit: string[]; source: GridSource } | null;
  /** What the data file has for the next race. */
  data: { source: "openf1" | "qualifying"; order: string[] } | null;
  /** A saved manual grid for this race; `valid` is false when it no longer fits the drivers (then it is not used). */
  override: { updatedAt: string; valid: boolean } | null;
  /** A manual grid is in use, OpenF1 has a grid, and they are not the same. */
  differs: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCodes(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/** A `GET /api/grid` (or PUT/DELETE) body, or null when it is not what the page expects. */
export function parseGridResponse(httpOk: boolean, body: unknown): GridInfo | null {
  if (!httpOk || !isRecord(body)) return null;
  const { round, effective, data, override, differs } = body;
  if (!(round === null || typeof round === "number")) return null;
  if (typeof differs !== "boolean") return null;

  let parsedEffective: GridInfo["effective"] = null;
  if (effective !== null) {
    if (!isRecord(effective) || !isCodes(effective.order) || !isCodes(effective.pit)) return null;
    const s = effective.source;
    if (s !== "manual" && s !== "openf1" && s !== "qualifying") return null;
    parsedEffective = { order: effective.order, pit: effective.pit, source: s };
  }

  let parsedData: GridInfo["data"] = null;
  if (data !== null) {
    if (!isRecord(data) || !isCodes(data.order)) return null;
    if (data.source !== "openf1" && data.source !== "qualifying") return null;
    parsedData = { source: data.source, order: data.order };
  }

  let parsedOverride: GridInfo["override"] = null;
  if (override !== null) {
    if (!isRecord(override) || typeof override.updatedAt !== "string" || typeof override.valid !== "boolean") return null;
    parsedOverride = { updatedAt: override.updatedAt, valid: override.valid };
  }

  return { round, effective: parsedEffective, data: parsedData, override: parsedOverride, differs };
}

// ---------------------------------------------------------------------------------------------------------------------
// The source tag
// ---------------------------------------------------------------------------------------------------------------------

export interface GridTagView {
  text: string;
  /** "warn" uses the yellow timing color and an icon next to the words (never color alone). */
  tone: "plain" | "warn";
}

const TAGS: Record<GridSource, GridTagView> = {
  manual: { text: "Grid: manual", tone: "plain" },
  openf1: { text: "Grid: OpenF1", tone: "plain" },
  qualifying: { text: "Grid: qualifying (may differ from the real grid)", tone: "warn" },
};

export function gridTag(source: GridSource): GridTagView {
  return TAGS[source];
}

/** The tag for the grid in use, or null when there is no grid yet (or the grid could not be loaded). */
export function gridTagFor(info: GridInfo | null): GridTagView | null {
  return info?.effective ? gridTag(info.effective.source) : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// The notice: OpenF1 now has a different grid
// ---------------------------------------------------------------------------------------------------------------------

export const GRID_NOTICE_TEXT = "OpenF1 now has the official grid, and it differs from yours.";
export const GRID_NOTICE_USE_LABEL = "Use OpenF1 grid";
export const GRID_NOTICE_KEEP_LABEL = "Keep mine";

export interface GridNoticeView {
  text: string;
  useLabel: string;
  keepLabel: string;
}

/**
 * Identifies OpenF1's grid for the next race. "Keep mine" remembers it, so the notice stays away until OpenF1's grid
 * (or the race) changes. null when the data file has no grid.
 */
export function gridSignature(info: GridInfo | null): string | null {
  if (!info || info.round === null || !info.data) return null;
  return `${info.round}:${info.data.source}:${info.data.order.join(",")}`;
}

/** The notice, only when a manual grid is in use that differs from OpenF1's and it was not dismissed for this grid. */
export function gridNotice(info: GridInfo | null, dismissed: string | null): GridNoticeView | null {
  if (!info || !info.differs) return null;
  const signature = gridSignature(info);
  if (signature === null || signature === dismissed) return null;
  return { text: GRID_NOTICE_TEXT, useLabel: GRID_NOTICE_USE_LABEL, keepLabel: GRID_NOTICE_KEEP_LABEL };
}

/** Why "Use OpenF1 grid" cannot be used right now, in plain words, or null when it can. */
export function gridWriteDisabledReason(canWrite: boolean, verdict: AccessVerdict): string | null {
  if (canWrite) return null;
  return verdict === "needs-token" ? "Enter the write token to change the grid." : "Writing is only allowed from this computer.";
}

/** One plain sentence for a failed save or clear. */
export function gridErrorMessage(status: number | null, body: unknown): string {
  if (status === null) return "Could not reach the server. Check that it is running.";
  if (status === 401) return "Enter the write token to change the grid.";
  if (status === 403) return "Writing is only allowed from this computer.";
  if (status === 422 && isRecord(body) && isCodes(body.errors) && body.errors.length > 0) return body.errors.join(" ");
  if (isRecord(body) && typeof body.message === "string" && body.message !== "") return body.message;
  return `The server returned an error (${status}). Try again.`;
}

// ---------------------------------------------------------------------------------------------------------------------
// The state behind the notice's buttons
// ---------------------------------------------------------------------------------------------------------------------

export interface GridState {
  /** Whether the grid has been asked for yet, and whether that worked. */
  status: "loading" | "ready" | "error";
  /** The grid in use, or null until it is loaded (or when it could not be). */
  info: GridInfo | null;
  /** The signature of the OpenF1 grid the owner chose to ignore ("Keep mine"). */
  dismissed: string | null;
  /** "Use OpenF1 grid" is running. */
  busy: boolean;
  /** Why the last "Use OpenF1 grid" (or "Use data grid") did not work, in plain words. */
  error: string | null;
  /** "Save grid" is running. */
  saving: boolean;
  /** Why the last "Save grid" did not work, in plain words. */
  saveError: string | null;
}

export type GridMessage =
  | { type: "loaded"; info: GridInfo | null }
  /** "Keep mine": the notice goes away until OpenF1's grid changes. Nothing is sent to the server. */
  | { type: "keepMine" }
  /** "Use OpenF1 grid" was pressed: the request is on its way. */
  | { type: "clearStarted" }
  /** The server removed the manual grid and answered with the grid now in use. */
  | { type: "cleared"; info: GridInfo }
  | { type: "clearFailed"; message: string }
  /** "Save grid" was pressed: the request is on its way. */
  | { type: "saveStarted" }
  /** The server saved the manual grid and answered with the grid now in use. */
  | { type: "saved"; info: GridInfo }
  | { type: "saveFailed"; message: string };

export function initialGridState(dismissed: string | null = null): GridState {
  return { status: "loading", info: null, dismissed, busy: false, error: null, saving: false, saveError: null };
}

export function gridReducer(state: GridState, message: GridMessage): GridState {
  switch (message.type) {
    case "loaded":
      return { ...state, status: message.info ? "ready" : "error", info: message.info };
    case "keepMine": {
      const signature = gridSignature(state.info);
      return signature === null ? state : { ...state, dismissed: signature };
    }
    case "clearStarted":
      return state.busy ? state : { ...state, busy: true, error: null };
    case "cleared":
      return { ...state, info: message.info, busy: false, error: null };
    case "clearFailed":
      return { ...state, busy: false, error: message.message };
    case "saveStarted":
      return state.saving ? state : { ...state, saving: true, saveError: null };
    case "saved":
      return { ...state, info: message.info, saving: false, saveError: null };
    case "saveFailed":
      return { ...state, saving: false, saveError: message.message };
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Remembering "Keep mine"
// ---------------------------------------------------------------------------------------------------------------------

export const GRID_NOTICE_STORAGE_KEY = "ttf_grid_notice_dismissed";

/** The part of `Storage` that is needed, so tests can pass a fake one. */
export interface GridNoticeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The browser's localStorage, or undefined when there is none (server, tests) or it is blocked. */
export function resolveGridNoticeStorage(): GridNoticeStorage | undefined {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch {
    // Reading `localStorage` itself can throw when storage is blocked.
  }
  return undefined;
}

/** The remembered signature, or null. Missing, empty or unreadable storage gives null; never throws. */
export function readDismissedGrid(storage: GridNoticeStorage | undefined): string | null {
  try {
    const value = storage?.getItem(GRID_NOTICE_STORAGE_KEY);
    return typeof value === "string" && value !== "" ? value : null;
  } catch {
    return null;
  }
}

/** Remembers it. Missing or unwritable storage is ignored (the choice then lasts until the page is closed). */
export function writeDismissedGrid(signature: string, storage: GridNoticeStorage | undefined): void {
  try {
    storage?.setItem(GRID_NOTICE_STORAGE_KEY, signature);
  } catch {
    // Ignored on purpose.
  }
}
