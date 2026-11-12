/**
 * web/viewModel/cardView.ts – Assembles a CardView from live page state. Pure: no DOM, no fetch.
 * The export button calls this to get the data for buildCard().
 */
import type { OddsResult } from "../../engine/odds";
import { NO_TITLE_TEXT, buildTowerRows, type TowerStatus } from "./tower";
import { DEFAULT_TITLE_INFO, titleInfoVisible, type TitleInfoMode } from "./titleInfo";
import type { CardRow, CardView } from "./card";
import type { Workspace } from "./workspace";
import type { SavedScenario } from "./scenarios";
import type { SeasonState } from "../../engine";

/**
 * Builds the CardView from the current page state.
 *
 * @param state       The loaded season state.
 * @param workspace   The current workspace (holds the active scenario and contenders).
 * @param scenarios   The list of saved scenarios (to find the selected scenario's name).
 * @param selectedId  The id of the scenario chip currently selected (null for Base).
 * @param oddsResult  The latest odds result from the worker, or null when not on the "Likely?" tab.
 * @param titleInfoMode  The "Title info" choice. The card lists drivers, so Auto looks at the drivers' table.
 */
export function buildCardView(
  state: SeasonState,
  workspace: Workspace,
  scenarios: readonly SavedScenario[],
  selectedId: string | null,
  oddsResult: OddsResult | null,
  titleInfoMode: TitleInfoMode = DEFAULT_TITLE_INFO,
): CardView {
  const towerRows = buildTowerRows(state, workspace.scenario, "wdc");

  const oddsById = new Map(oddsResult?.wdc.map((r) => [r.id, r.display]) ?? []);
  const hasOdds = oddsResult !== null && oddsResult.wdc.length > 0;

  const rows: CardRow[] = towerRows.map((r) => ({
    rank: r.rank,
    driverCode: r.label,
    driverName: r.name !== r.label ? r.name : undefined,
    constructorId: r.teamId,
    currentPoints: r.basePoints,
    projectedPoints: r.points,
    deltaPoints: r.pointsAdded,
    statusText: r.status ? statusText(r.status) : "",
    oddsDisplay: oddsById.get(r.id),
  }));

  const selected = selectedId !== null ? scenarios.find((s) => s.id === selectedId) : undefined;
  const scenarioName = selected?.name ?? "Base";

  return {
    season: state.season,
    asOfRound: state.asOfRound,
    scenarioName,
    rows,
    hasOdds,
    showTitleInfo: titleInfoVisible(titleInfoMode, towerRows),
  };
}

/** "alive" → "Alive", "longShot" → "Long shot", "eliminated" → "✕ No title" (the same mark as the table tag). */
function statusText(status: TowerStatus): string {
  if (status === "eliminated") return NO_TITLE_TEXT;
  if (status === "longShot") return "Long shot";
  return status.charAt(0).toUpperCase() + status.slice(1);
}