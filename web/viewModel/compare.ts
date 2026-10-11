/** Compare two scenarios side by side (DESIGN.md section 6). Pure. */
import type { Scenario, SeasonState } from "../../engine";
import { toScenario, type SavedScenario } from "./scenarios";
import { buildTowerRows, formatDelta, formatPoints, type TowerTab } from "./tower";

export interface CompareRow {
  id: string;
  label: string;
  name: string;
  teamId: string;
  leftRank: number;
  rightRank: number;
  leftPoints: number;
  rightPoints: number;
  /** Places gained on the right: leftRank - rightRank. Positive means higher on the right. */
  rankChange: number;
  /** rightPoints - leftPoints. */
  pointsDiff: number;
  /** The rank or the points differ. */
  differs: boolean;
  inactive: boolean;
}

/** `+25`, `−10` (a real minus sign), or `=` for no change. */
export function formatPointsDiff(diff: number): string {
  if (diff > 0) return `+${formatPoints(diff)}`;
  if (diff < 0) return `−${formatPoints(-diff)}`;
  return "=";
}

/** One row per driver or constructor, in the left scenario's order. Undefined counts as Base. */
export function buildCompareRows(
  state: SeasonState,
  left: Scenario | undefined,
  right: Scenario | undefined,
  tab: TowerTab,
): CompareRow[] {
  const leftRows = buildTowerRows(state, left, tab);
  const rightById = new Map(buildTowerRows(state, right, tab).map((r) => [r.id, r]));
  return leftRows.map((l) => {
    const r = rightById.get(l.id) ?? l;
    const rankChange = l.rank - r.rank;
    const pointsDiff = r.points - l.points;
    return {
      id: l.id,
      label: l.label,
      name: l.name,
      teamId: l.teamId,
      leftRank: l.rank,
      rightRank: r.rank,
      leftPoints: l.points,
      rightPoints: r.points,
      rankChange,
      pointsDiff,
      differs: rankChange !== 0 || pointsDiff !== 0,
      inactive: l.inactive,
    };
  });
}

export function summarizeCompare(rows: readonly CompareRow[], tab: TowerTab): string {
  const differing = rows.filter((r) => r.differs).length;
  if (differing === 0) return "No differences: both give the same table.";
  return `${differing} of ${rows.length} ${tab === "wdc" ? "drivers" : "constructors"} differ.`;
}

/** The change on one row in words, for screen readers. */
export function describeCompareRow(row: CompareRow): string {
  const points =
    row.pointsDiff === 0
      ? null
      : row.pointsDiff > 0
        ? `${formatPoints(row.pointsDiff)} ${row.pointsDiff === 1 ? "more point" : "more points"}`
        : `${formatPoints(-row.pointsDiff)} ${row.pointsDiff === -1 ? "fewer point" : "fewer points"}`;
  if (row.rankChange !== 0) {
    const place = formatDelta(row.rankChange).description;
    return points ? `${place} and ${points}` : `${place}, same points`;
  }
  return points ? `Same position, ${points}` : "No change";
}

/** "base", "sandbox" (what is on screen), or the id of a saved scenario. */
export type SideId = string;

export interface CompareSide {
  label: string;
  scenario: Scenario;
}

/** What each side of the comparison can be: Base, the sandbox, and every saved scenario that still fits the data. */
export function compareOptions(saved: readonly SavedScenario[]): { id: SideId; label: string }[] {
  return [
    { id: "base", label: "Base" },
    { id: "sandbox", label: "Current sandbox" },
    ...saved.filter((s) => s.valid).map((s) => ({ id: s.id, label: s.name })),
  ];
}

/** The scenario behind a side, or null when it cannot be compared (invalid or gone). */
export function resolveSide(id: SideId, sandbox: Scenario, saved: readonly SavedScenario[]): CompareSide | null {
  if (id === "base") return { label: "Base", scenario: { locks: {} } };
  if (id === "sandbox") return { label: "Current sandbox", scenario: sandbox };
  const found = saved.find((s) => s.id === id && s.valid);
  return found ? { label: found.name, scenario: toScenario(found) } : null;
}

/** Base on the left; on the right the selected scenario if it can be compared, else the sandbox. */
export function defaultCompareSides(selectedId: string | null, saved: readonly SavedScenario[]): { left: SideId; right: SideId } {
  const usable = selectedId !== null && saved.some((s) => s.id === selectedId && s.valid);
  return { left: "base", right: usable ? selectedId : "sandbox" };
}
