import { useState } from "react";
import { EmptyState } from "./EmptyState";
import { Tabs, panelId, tabId, type TabItem } from "./Tabs";

type StandingsTab = "wdc" | "wcc";

const TABS: readonly TabItem<StandingsTab>[] = [
  { id: "wdc", label: "WDC" },
  { id: "wcc", label: "WCC" },
];

export function StandingsPanel() {
  const [tab, setTab] = useState<StandingsTab>("wdc");

  return (
    <main
      id="standings"
      tabIndex={-1}
      aria-labelledby="standings-title"
      className="flex min-h-0 flex-col gap-3 overflow-y-auto rounded-panel bg-s1 p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="standings-title" className="type-title text-text">
          Projected standings
        </h2>
        <Tabs label="Standings type" idPrefix="standings" items={TABS} selected={tab} onSelect={setTab} />
      </div>
      <div role="tabpanel" id={panelId("standings", tab)} aria-labelledby={tabId("standings", tab)}>
        <EmptyState title="Lock a result to see the table change">
          The {tab === "wdc" ? "drivers" : "constructors"} table shows here once season data is loaded.
        </EmptyState>
      </div>
    </main>
  );
}
