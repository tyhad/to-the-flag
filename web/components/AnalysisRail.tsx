import { useState, type Dispatch, type ReactNode } from "react";
import type { SeasonState } from "../../engine";
import type { Workspace, WorkspaceMessage } from "../viewModel/workspace";
import { EmptyState } from "./EmptyState";
import { PathPanel } from "./PathPanel";
import { Tabs, panelId, tabId, type TabItem } from "./Tabs";

type AnalysisTab = "possible" | "likely";

// "Possible?" (math, no model) and "Likely?" (model) stay separate. "Likely?" arrives in a later release.
const TABS: readonly TabItem<AnalysisTab>[] = [
  { id: "possible", label: "Possible?" },
  { id: "likely", label: "Likely?", disabled: true, hint: "Model odds arrive in a later release." },
];

function AnalysisFrame({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<AnalysisTab>("possible");
  return (
    <aside aria-label="Title analysis" className="flex min-h-0 flex-col gap-3 overflow-y-auto rounded-panel bg-s1 p-4">
      <Tabs label="Analysis type" idPrefix="analysis" items={TABS} selected={tab} onSelect={setTab} />
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
  return (
    <AnalysisFrame>
      <PathPanel state={state} workspace={workspace} dispatch={dispatch} />
    </AnalysisFrame>
  );
}

/** Shown while the season loads, or when it could not be loaded. */
export function AnalysisPlaceholder() {
  return (
    <AnalysisFrame>
      <EmptyState title="Pick a contender">Once season data is loaded, see what it takes to win the title.</EmptyState>
    </AnalysisFrame>
  );
}
