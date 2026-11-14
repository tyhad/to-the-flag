import { useEffect, useMemo, useState, type Dispatch, type ReactNode } from "react";
import type { OddsResult } from "../../engine/odds";
import type { SeasonState } from "../../engine";
import { FORM_WEIGHT_DEFAULT } from "../config";
import { useOdds } from "../useOdds";
import { useRaceForecast } from "../useRaceForecast";
import type { GridControls } from "../useGrid";
import { gridNotice, gridTagFor } from "../viewModel/grid";
import { forecastDisplay } from "../viewModel/raceForecast";
import type { AccessVerdict } from "../viewModel/access";
import { combineOddsStates, formWeightFor, type OddsTable } from "../viewModel/odds";
import type { Workspace, WorkspaceMessage } from "../viewModel/workspace";
import { EmptyState } from "./EmptyState";
import { GridNotice } from "./GridNotice";
import { GridSourceTag } from "./GridSourceTag";
import { OddsPanel, OddsPlaceholder } from "./OddsPanel";
import { PossiblePanel, type PathSubject } from "./PossiblePanel";
import { RaceForecast } from "./RaceForecast";
import { RacePanel } from "./RacePanel";
import { Tabs, panelId, tabId, type TabItem } from "./Tabs";

type AnalysisTab = "possible" | "likely" | "race";

// "Possible?" (math, no model) and "Likely?" (model) stay separate: no figure mixes them. "Race" is where the starting grid is set.
const TABS: readonly TabItem<AnalysisTab>[] = [
  { id: "possible", label: "Possible?" },
  { id: "likely", label: "Likely?" },
  { id: "race", label: "Race" },
];

function AnalysisFrame({ tab, onTab, children }: { tab: AnalysisTab; onTab: (tab: AnalysisTab) => void; children: ReactNode }) {
  return (
    <aside aria-label="Title analysis" className="flex min-h-0 scroll-p-3 flex-col gap-3 overflow-y-auto rounded-panel bg-s1 p-4">
      <Tabs label="Analysis type" idPrefix="analysis" items={TABS} selected={tab} onSelect={onTab} />
      <div role="tabpanel" id={panelId("analysis", tab)} aria-labelledby={tabId("analysis", tab)}>
        {children}
      </div>
    </aside>
  );
}

export interface AnalysisRailProps {
  state: SeasonState;
  workspace: Workspace;
  dispatch: Dispatch<WorkspaceMessage>;
  /** Called whenever the projected WDC odds result changes. Used by the export button in ScenarioStrip. */
  onOddsResult?: (result: OddsResult | null) => void;
  /** Which starting grid is in use, and the notice's buttons. Without it the grid tag and notice are not shown. */
  grid?: { controls: GridControls; canWrite: boolean; verdict: AccessVerdict };
}

export function AnalysisRail({ state, workspace, dispatch, onOddsResult, grid }: AnalysisRailProps) {
  const [tab, setTab] = useState<AnalysisTab>("possible");
  // These live here, not in the panels, so they survive a switch to the other tab.
  const [formPercent, setFormPercent] = useState(FORM_WEIGHT_DEFAULT);
  const [table, setTable] = useState<OddsTable>("wdc");
  const [subject, setSubject] = useState<PathSubject>("wdc");

  const likely = tab === "likely";
  const hasLocks = Object.keys(workspace.scenario.locks).length > 0;
  const params = useMemo(() => ({ formWeight: formWeightFor(formPercent) }), [formPercent]);

  // The odds without locks are always calculated while the tab is open: they are the answer when nothing is locked,
  // and the baseline for the change column when something is.
  const base = useOdds({ state, params, enabled: likely });
  const projected = useOdds({ state, scenario: workspace.scenario, params, enabled: likely && hasLocks });
  // The race forecast follows the grid in the Race tab. It uses the same model settings as "Likely?", so the two agree.
  const raceOpen = tab === "race";
  const raceForecast = useRaceForecast({ state, params, enabled: raceOpen && Boolean(grid?.controls.state.info?.effective) });
  const panel = useMemo(() => (hasLocks ? combineOddsStates(projected, base) : combineOddsStates(base, null)), [hasLocks, projected, base]);

  // Expose the current projected result (or base when no locks) to the export button.
  const currentResult = panel.result;
  useEffect(() => {
    onOddsResult?.(currentResult);
  }, [currentResult, onOddsResult]);

  const tag = grid ? gridTagFor(grid.controls.state.info) : null;
  const notice = grid ? gridNotice(grid.controls.state.info, grid.controls.state.dismissed) : null;
  // The same notice is shown in the Likely panel and in the Race tab.
  const noticeElement =
    notice && grid ? (
      <GridNotice
        notice={notice}
        busy={grid.controls.state.busy}
        error={grid.controls.state.error}
        canWrite={grid.canWrite}
        verdict={grid.verdict}
        onUseOpenF1={() => void grid.controls.chooseOpenF1()}
        onKeepMine={grid.controls.keepMine}
      />
    ) : null;

  return (
    <AnalysisFrame tab={tab} onTab={setTab}>
      {likely ? (
        <OddsPanel
          state={state}
          panel={panel}
          hasLocks={hasLocks}
          table={table}
          onTable={setTable}
          formPercent={formPercent}
          onFormPercent={setFormPercent}
          gridTag={tag ? <GridSourceTag source={grid!.controls.state.info!.effective!.source} /> : null}
          gridNotice={noticeElement}
        />
      ) : tab === "race" ? (
        grid ? (
          <RacePanel
            state={state}
            controls={grid.controls}
            canWrite={grid.canWrite}
            verdict={grid.verdict}
            notice={noticeElement}
            forecast={
              <RaceForecast display={forecastDisplay(raceForecast, state, grid.controls.state.saving || grid.controls.state.busy)} />
            }
          />
        ) : (
          <EmptyState title="The grid is not available">Reload the page to set the starting grid.</EmptyState>
        )
      ) : (
        <PossiblePanel
          state={state}
          workspace={workspace}
          dispatch={dispatch}
          subject={subject}
          onSubject={(next) => {
            // A message about one table does not belong under the other.
            dispatch({ type: "dismissNotice" });
            setSubject(next);
          }}
        />
      )}
    </AnalysisFrame>
  );
}

/** Shown while the season loads, or when it could not be loaded. */
export function AnalysisPlaceholder() {
  const [tab, setTab] = useState<AnalysisTab>("possible");
  return (
    <AnalysisFrame tab={tab} onTab={setTab}>
      {tab === "likely" ? (
        <OddsPlaceholder />
      ) : tab === "race" ? (
        <EmptyState title="Starting grid">Once season data is loaded, you can correct the starting grid here.</EmptyState>
      ) : (
        <EmptyState title="Pick a contender">Once season data is loaded, see what it takes to win the title.</EmptyState>
      )}
    </AnalysisFrame>
  );
}
