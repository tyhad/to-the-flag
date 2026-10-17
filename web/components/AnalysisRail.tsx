import { useMemo, useState, type Dispatch, type ReactNode } from "react";
import type { SeasonState } from "../../engine";
import { FORM_WEIGHT_DEFAULT } from "../config";
import { useOdds } from "../useOdds";
import { combineOddsStates, formWeightFor, type OddsTable } from "../viewModel/odds";
import type { Workspace, WorkspaceMessage } from "../viewModel/workspace";
import { EmptyState } from "./EmptyState";
import { OddsPanel, OddsPlaceholder } from "./OddsPanel";
import { PossiblePanel, type PathSubject } from "./PossiblePanel";
import { Tabs, panelId, tabId, type TabItem } from "./Tabs";

type AnalysisTab = "possible" | "likely";

// "Possible?" (math, no model) and "Likely?" (model) stay separate: no figure mixes them.
const TABS: readonly TabItem<AnalysisTab>[] = [
  { id: "possible", label: "Possible?" },
  { id: "likely", label: "Likely?" },
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

interface AnalysisRailProps {
  state: SeasonState;
  workspace: Workspace;
  dispatch: Dispatch<WorkspaceMessage>;
}

export function AnalysisRail({ state, workspace, dispatch }: AnalysisRailProps) {
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
  const panel = useMemo(() => (hasLocks ? combineOddsStates(projected, base) : combineOddsStates(base, null)), [hasLocks, projected, base]);

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
        />
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
      ) : (
        <EmptyState title="Pick a contender">Once season data is loaded, see what it takes to win the title.</EmptyState>
      )}
    </AnalysisFrame>
  );
}
