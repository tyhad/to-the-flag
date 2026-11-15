/**
 * The starting grid editor (Phase 8, Step 4): the rows, the quick corrections (up, down, drop places, back of the
 * grid, pit-lane start), pasting a list, and when "Save grid" and "Use data grid" are available.
 * Pure: no DOM, no fetch. The rules for a valid grid are the engine's (`engine/grid.ts`); nothing is checked twice here.
 */
import { backOfGrid, dropPlaces, gridProblems, parseGridText } from "../../engine/grid";
import { activeDrivers } from "../../engine/sessions";
import { teamCars } from "../../engine/teams";
import type { SeasonState } from "../../engine/types";
import type { AccessVerdict } from "./access";
import { gridWriteDisabledReason, type GridInfo, type GridState } from "./grid";

/** The grid being edited: the start order (pole first) and the pit-lane starters, who start behind everyone. */
export interface EditorGrid {
  order: string[];
  pit: string[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Starting point
// ---------------------------------------------------------------------------------------------------------------------

function sentence(codes: string[], one: string, many: string): string {
  return `${codes.join(", ")} ${codes.length === 1 ? one : many}`;
}

/**
 * The grid the editor starts from: the grid in use, kept to the drivers who are racing. A racing driver the grid does
 * not have is added at the back of the grid, and a code that is not racing is left out; each is said in `notes`.
 * null when no grid is known yet (before qualifying), or no race is left.
 */
export function prefillEditor(state: SeasonState, info: GridInfo | null): { grid: EditorGrid; notes: string[] } | null {
  if (!info || !info.effective) return null;
  const active = activeDrivers(state);
  const activeSet = new Set(active);
  const listed = [...info.effective.order, ...info.effective.pit];

  const order = info.effective.order.filter((code) => activeSet.has(code));
  const pit = info.effective.pit.filter((code) => activeSet.has(code));
  const left = listed.filter((code) => !activeSet.has(code));
  const have = new Set([...order, ...pit]);
  const missing = active.filter((code) => !have.has(code));
  order.push(...missing);

  const notes: string[] = [];
  if (missing.length > 0) notes.push(`${sentence(missing, "was", "were")} not in the grid and ${missing.length === 1 ? "was" : "were"} added at the back. Check the order.`);
  if (left.length > 0) notes.push(`${sentence(left, "is", "are")} not racing and ${left.length === 1 ? "was" : "were"} left out.`);
  return { grid: { order, pit }, notes };
}

/** What to show instead of the editor, or null when the editor can be shown. */
export function emptyGridMessage(grid: Pick<GridState, "status" | "info">): { title: string; text: string | null } | null {
  if (grid.status === "loading") return { title: "Loading the grid…", text: null };
  if (grid.status === "error" || !grid.info) return { title: "The grid could not be loaded", text: "Reload the page to try again." };
  if (grid.info.round === null) return { title: "No race left", text: "The season is over, so there is no grid to set." };
  if (!grid.info.effective) {
    return { title: "The grid is known after qualifying.", text: "Once qualifying has run, the grid appears here and you can correct it." };
  }
  return null;
}

/** "Round 17 · Las Vegas Grand Prix", or just the round when its name is not known. */
export function raceLabel(state: SeasonState, round: number): string {
  const name = state.rounds.find((r) => r.round === round)?.name;
  return name ? `Round ${round} · ${name}` : `Round ${round}`;
}

/** Said when a saved manual grid exists but no longer fits the drivers (so the grid in use is the data file's). */
export function invalidOverrideNote(info: GridInfo | null): string | null {
  return info?.override && !info.override.valid
    ? "Your saved grid no longer fits the drivers, so it is not used. Save a new grid, or use the data grid."
    : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------------------------------

/** How many places "Drop N places" offers. */
export const DROP_CHOICES = [1, 2, 3, 5, 10] as const;

export type EditorMenuId = "drop-1" | "drop-2" | "drop-3" | "drop-5" | "drop-10" | "back" | "pit" | "unpit";

export interface EditorMenuItem {
  id: EditorMenuId;
  label: string;
  disabled: boolean;
}

export interface EditorRow {
  code: string;
  name: string;
  /** For the team color strip; "" when the driver has no team yet. */
  teamId: string;
  /** The starting place, counting the pit-lane starters after the grid. */
  place: number;
  /** A pit-lane starter. */
  pit: boolean;
  canUp: boolean;
  canDown: boolean;
  menu: EditorMenuItem[];
}

/** The rows of the editor, in start order: the grid, then the pit-lane starters. */
export function buildEditorRows(state: SeasonState, grid: EditorGrid): EditorRow[] {
  const names = new Map(state.drivers.map((d) => [d.code, d.name]));
  const teamOf = new Map<string, string>();
  for (const [team, codes] of teamCars(state)) for (const code of codes) teamOf.set(code, team);

  const rows: EditorRow[] = [];
  grid.order.forEach((code, i) => {
    const last = i === grid.order.length - 1;
    rows.push({
      code,
      name: names.get(code) ?? code,
      teamId: teamOf.get(code) ?? "",
      place: i + 1,
      pit: false,
      canUp: i > 0,
      canDown: !last,
      menu: [
        ...DROP_CHOICES.map((n): EditorMenuItem => ({
          id: `drop-${n}` as EditorMenuId,
          label: `Drop ${n} place${n === 1 ? "" : "s"}`,
          disabled: last,
        })),
        { id: "back", label: "Back of the grid", disabled: last },
        { id: "pit", label: "Pit-lane start", disabled: false },
      ],
    });
  });
  grid.pit.forEach((code, i) => {
    rows.push({
      code,
      name: names.get(code) ?? code,
      teamId: teamOf.get(code) ?? "",
      place: grid.order.length + i + 1,
      pit: true,
      canUp: true, // the first pit-lane starter moves onto the end of the grid
      canDown: i < grid.pit.length - 1,
      menu: [{ id: "unpit", label: "Start from the grid", disabled: false }],
    });
  });
  return rows;
}

// ---------------------------------------------------------------------------------------------------------------------
// The editor's state
// ---------------------------------------------------------------------------------------------------------------------

export interface EditorState {
  /** What is on screen. */
  grid: EditorGrid;
  /** What the server has (the grid in use); "Save grid" is for the difference. */
  saved: EditorGrid;
  pasteOpen: boolean;
  pasteText: string;
  /** Why the pasted list was not used, in plain words. */
  pasteErrors: string[];
}

export type EditorMessage =
  /** The server's grid changed (loaded, saved, cleared): start again from it. */
  | { type: "reset"; grid: EditorGrid }
  /** One place earlier; the first pit-lane starter joins the end of the grid. */
  | { type: "up"; code: string }
  /** One place later, within the grid or within the pit-lane starters. */
  | { type: "down"; code: string }
  | { type: "drop"; code: string; n: number }
  | { type: "back"; code: string }
  | { type: "pit"; code: string }
  /** A pit-lane starter goes to the last place of the grid. */
  | { type: "unpit"; code: string }
  | { type: "openPaste" }
  | { type: "closePaste" }
  | { type: "pasteText"; text: string }
  | { type: "applyPaste" };

const copyGrid = (grid: EditorGrid): EditorGrid => ({ order: [...grid.order], pit: [...grid.pit] });

export function initialEditorState(grid: EditorGrid): EditorState {
  return { grid: copyGrid(grid), saved: copyGrid(grid), pasteOpen: false, pasteText: "", pasteErrors: [] };
}

/** The grid as text a person can edit and paste back: one "place CODE" per line, pit-lane starters after "PIT:". */
export function gridToText(grid: EditorGrid): string {
  const lines = grid.order.map((code, i) => `${i + 1} ${code}`);
  if (grid.pit.length > 0) {
    lines.push("PIT:");
    grid.pit.forEach((code, i) => lines.push(`${grid.order.length + i + 1} ${code}`));
  }
  return lines.join("\n");
}

function swapped(list: readonly string[], i: number, j: number): string[] {
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

/** Applies one message. Pure: returns a new state, never throws, and ignores a message that does not apply. */
export function applyEditorMessage(season: SeasonState, ed: EditorState, message: EditorMessage): EditorState {
  const { order, pit } = ed.grid;
  const set = (grid: EditorGrid): EditorState => ({ ...ed, grid, pasteErrors: [] });

  switch (message.type) {
    case "reset":
      return initialEditorState(message.grid);

    case "up": {
      const i = order.indexOf(message.code);
      if (i > 0) return set({ order: swapped(order, i - 1, i), pit });
      const j = pit.indexOf(message.code);
      if (j > 0) return set({ order, pit: swapped(pit, j - 1, j) });
      if (j === 0) return set({ order: [...order, message.code], pit: pit.slice(1) });
      return ed;
    }
    case "down": {
      const i = order.indexOf(message.code);
      if (i >= 0 && i < order.length - 1) return set({ order: swapped(order, i, i + 1), pit });
      const j = pit.indexOf(message.code);
      if (j >= 0 && j < pit.length - 1) return set({ order, pit: swapped(pit, j, j + 1) });
      return ed;
    }
    case "drop": {
      if (!order.includes(message.code) || !Number.isInteger(message.n) || message.n < 0) return ed;
      return set({ order: dropPlaces(order, message.code, message.n), pit });
    }
    case "back": {
      if (!order.includes(message.code)) return ed;
      return set({ order: backOfGrid(order, message.code), pit });
    }
    case "pit": {
      if (!order.includes(message.code)) return ed;
      return set({ order: order.filter((c) => c !== message.code), pit: [...pit, message.code] });
    }
    case "unpit": {
      if (!pit.includes(message.code)) return ed;
      return set({ order: [...order, message.code], pit: pit.filter((c) => c !== message.code) });
    }

    case "openPaste":
      return { ...ed, pasteOpen: true, pasteText: gridToText(ed.grid), pasteErrors: [] };
    case "closePaste":
      return { ...ed, pasteOpen: false, pasteText: "", pasteErrors: [] };
    case "pasteText":
      return { ...ed, pasteText: message.text, pasteErrors: [] };
    case "applyPaste": {
      const parsed = parseGridText(ed.pasteText, season);
      const errors = parsed.errors.length > 0 ? parsed.errors : gridProblems(season, parsed.order, parsed.pit);
      // Nothing changes unless the whole list is good: no half-applied grid.
      if (errors.length > 0) return { ...ed, pasteErrors: errors };
      return { ...ed, grid: { order: parsed.order, pit: parsed.pit }, pasteOpen: false, pasteText: "", pasteErrors: [] };
    }
  }
}

/** The message a menu item stands for. */
export function menuMessage(code: string, id: EditorMenuId): EditorMessage {
  if (id === "back") return { type: "back", code };
  if (id === "pit") return { type: "pit", code };
  if (id === "unpit") return { type: "unpit", code };
  return { type: "drop", code, n: Number(id.slice("drop-".length)) };
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** The grid on screen is not the grid the server has. */
export function isDirty(ed: EditorState): boolean {
  return !sameList(ed.grid.order, ed.saved.order) || !sameList(ed.grid.pit, ed.saved.pit);
}

// ---------------------------------------------------------------------------------------------------------------------
// The two buttons
// ---------------------------------------------------------------------------------------------------------------------

export interface ActionAvailability {
  enabled: boolean;
  /** Why it is off, in plain words (null when it is on, or when it is only busy). */
  reason: string | null;
}

export interface AccessContext {
  canWrite: boolean;
  verdict: AccessVerdict;
  /** Another request is running. */
  busy: boolean;
}

/** "Save grid": on when writing is allowed, the grid is valid and something changed. */
export function saveAvailability(season: SeasonState, ed: EditorState, ctx: AccessContext): ActionAvailability {
  const readOnly = gridWriteDisabledReason(ctx.canWrite, ctx.verdict);
  if (readOnly) return { enabled: false, reason: readOnly };
  const problems = gridProblems(season, ed.grid.order, ed.grid.pit);
  if (problems.length > 0) return { enabled: false, reason: problems.join(" ") };
  if (!isDirty(ed)) return { enabled: false, reason: "Change the grid first." };
  return { enabled: !ctx.busy, reason: null };
}

/** "Use data grid": on when a manual grid is saved for this race and writing is allowed. */
export function dataGridAvailability(info: GridInfo | null, ctx: AccessContext): ActionAvailability {
  if (!info?.override) return { enabled: false, reason: "No manual grid is saved." };
  const readOnly = gridWriteDisabledReason(ctx.canWrite, ctx.verdict);
  if (readOnly) return { enabled: false, reason: readOnly };
  return { enabled: !ctx.busy, reason: null };
}
