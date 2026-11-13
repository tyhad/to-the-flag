/**
 * web/viewModel/titleInfo.ts - The "Title info" choice (Auto, On, Off) and the rule behind it (Phase 7, D44).
 *
 * The status tags and the Best column answer "who can still win the title?". Early in a season every entry says
 * "alive" and "P1", which adds nothing, so Auto shows them only once at least one entry in the table being viewed
 * can no longer win. No round number is used, so it works for any season length. Pure: no DOM; the storage is
 * passed in.
 */

export const TITLE_INFO_MODES = ["auto", "on", "off"] as const;
export type TitleInfoMode = (typeof TITLE_INFO_MODES)[number];

export const DEFAULT_TITLE_INFO: TitleInfoMode = "auto";

/** Where the choice is remembered in the browser. */
export const TITLE_INFO_STORAGE_KEY = "ttf_title_info";

export const TITLE_INFO_LABEL = "Title info";

export const TITLE_INFO_OPTION_LABELS: Record<TitleInfoMode, string> = {
  auto: "Auto",
  on: "On",
  off: "Off",
};

/** One sentence per option, shown as a tooltip. */
export const TITLE_INFO_OPTION_HINTS: Record<TitleInfoMode, string> = {
  auto: "Auto: shown once someone can no longer win the title.",
  on: "On: always show the title status and the best place.",
  off: "Off: a plain standings table.",
};

/** The part of `Storage` the choice needs, so tests can pass a fake one. */
export interface TitleInfoStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The browser's localStorage, or undefined when there is none (server, tests) or it is blocked. */
export function resolveTitleInfoStorage(): TitleInfoStorage | undefined {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch {
    // Reading `localStorage` itself can throw when storage is blocked.
  }
  return undefined;
}

/** A stored or typed value as a mode; anything that is not one of the three gives the default. */
export function parseTitleInfo(value: unknown): TitleInfoMode {
  return (TITLE_INFO_MODES as readonly unknown[]).includes(value) ? (value as TitleInfoMode) : DEFAULT_TITLE_INFO;
}

/** The remembered choice. Missing, invalid or unreadable storage gives the default; never throws. */
export function readTitleInfo(storage: TitleInfoStorage | undefined): TitleInfoMode {
  try {
    return parseTitleInfo(storage?.getItem(TITLE_INFO_STORAGE_KEY));
  } catch {
    return DEFAULT_TITLE_INFO;
  }
}

/** Remembers the choice. Missing or unwritable storage is ignored; never throws. */
export function writeTitleInfo(mode: TitleInfoMode, storage: TitleInfoStorage | undefined): void {
  try {
    storage?.setItem(TITLE_INFO_STORAGE_KEY, mode);
  } catch {
    // The choice then lasts until the page is closed, which is fine.
  }
}

/**
 * Whether the status tags and the Best column are drawn for a table.
 * `on` is true and `off` is false. `auto` is true only when some row's best place is 2 or worse, that is,
 * when at least one entry can no longer win the title.
 */
export function titleInfoVisible(mode: TitleInfoMode, rows: readonly { readonly best: number }[]): boolean {
  if (mode === "on") return true;
  if (mode === "off") return false;
  return rows.some((row) => row.best >= 2);
}

/** The mode a key press on the switch moves to, or null when the key is not one the switch handles. */
export function nextTitleInfo(current: TitleInfoMode, key: string): TitleInfoMode | null {
  const last = TITLE_INFO_MODES.length - 1;
  const index = TITLE_INFO_MODES.indexOf(current);
  if (key === "ArrowRight" || key === "ArrowDown") return TITLE_INFO_MODES[index === last ? 0 : index + 1]!;
  if (key === "ArrowLeft" || key === "ArrowUp") return TITLE_INFO_MODES[index === 0 ? last : index - 1]!;
  if (key === "Home") return TITLE_INFO_MODES[0];
  if (key === "End") return TITLE_INFO_MODES[last]!;
  return null;
}
