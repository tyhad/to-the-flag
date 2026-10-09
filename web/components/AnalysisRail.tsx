import { useState } from "react";
import { EmptyState } from "./EmptyState";
import { Tabs, panelId, tabId, type TabItem } from "./Tabs";

type AnalysisTab = "possible" | "likely";

// "Possible?" (math, no model) and "Likely?" (model) stay separate. "Likely?" arrives in Phase 3.
const TABS: readonly TabItem<AnalysisTab>[] = [
  { id: "possible", label: "Possible?" },
  { id: "likely", label: "Likely?", disabled: true },
];

export function AnalysisRail() {
  const [tab, setTab] = useState<AnalysisTab>("possible");

  return (
    <aside aria-label="Title analysis" className="flex min-h-0 flex-col gap-3 overflow-y-auto rounded-panel bg-s1 p-4">
      <Tabs label="Analysis type" idPrefix="analysis" items={TABS} selected={tab} onSelect={setTab} />
      <div role="tabpanel" id={panelId("analysis", tab)} aria-labelledby={tabId("analysis", tab)}>
        <EmptyState title="Pick a contender">See what it takes to win the title, in plain words.</EmptyState>
      </div>
    </aside>
  );
}
