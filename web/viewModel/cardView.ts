/**
 * web/viewModel/cardView.ts – Assembles a CardView from live page state. Pure: no DOM, no fetch.
 * The export button calls this to get the data for buildCard().
 */
import type { OddsResult } from "../../engine/odds";
import { NO_TITLE_TEXT, buildTowerRows, type TowerStatus, type TowerTab } from "./tower";
import { DEFAULT_TITLE_INFO, titleInfoVisible, type TitleInfoMode } from "./titleInfo";
import type { CardPositionRange, CardRow, CardRowsChoice, CardView } from "./card";
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
 * @param titleInfoMode  The "Title info" choice.
 * @param tab         "wdc" or "wcc" (defaults to "wdc").
 * @param rowLimit    "10", "12", or "all" (defaults to "12").
 * @param positionRange Optional custom position range, e.g. { from: 3, to: 15 }.
 */
export function buildCardView(
  state: SeasonState,
  workspace: Workspace,
  scenarios: readonly SavedScenario[],
  selectedId: string | null,
  oddsResult: OddsResult | null,
  titleInfoMode: TitleInfoMode = DEFAULT_TITLE_INFO,
  tab: TowerTab = "wdc",
  rowLimit: CardRowsChoice = "12",
  positionRange?: CardPositionRange,
): CardView {
  const isWcc = tab === "wcc";
  const towerRows = buildTowerRows(state, workspace.scenario, tab);

  const oddsList = isWcc ? oddsResult?.wcc : oddsResult?.wdc;
  const oddsById = new Map(oddsList?.map((r) => [r.id, r.display]) ?? []);
  const hasOdds = oddsResult !== null && (oddsList?.length ?? 0) > 0;

  const rows: CardRow[] = towerRows.map((r) => ({
    rank: r.rank,
    driverCode: r.label,
    driverName: isWcc ? undefined : (r.name !== r.label ? r.name : undefined),
    constructorId: r.teamId,
    currentPoints: r.basePoints,
    projectedPoints: r.points,
    deltaPoints: r.pointsAdded,
    statusText: r.status ? statusText(r.status) : "",
    oddsDisplay: oddsById.get(r.id),
    bestText: r.bestText,
  }));

  const selected = selectedId !== null ? scenarios.find((s) => s.id === selectedId) : undefined;
  const scenarioName = selected?.name ?? "Base";

  const lockedKeys = Object.keys(workspace.scenario.locks);
  const isSimulation = lockedKeys.length > 0;
  let simulationRound: number | undefined;
  if (isSimulation) {
    const roundNums = lockedKeys.map((k) => Number(k.split(":")[0])).filter((n) => !isNaN(n));
    if (roundNums.length > 0) simulationRound = Math.max(...roundNums);
  }

  return {
    season: state.season,
    asOfRound: state.asOfRound,
    scenarioName,
    rows,
    hasOdds,
    showTitleInfo: titleInfoVisible(titleInfoMode, towerRows),
    tab,
    rowLimit,
    positionRange,
    isSimulation,
    simulationRound,
  };
}

/** "alive" → "Alive", "longShot" → "Long shot", "eliminated" → "✕ No title" (the same mark as the table tag). */
function statusText(status: TowerStatus): string {
  if (status === "eliminated") return NO_TITLE_TEXT;
  if (status === "longShot") return "Long shot";
  return status.charAt(0).toUpperCase() + status.slice(1);
}