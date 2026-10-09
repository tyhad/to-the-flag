import { useMemo, useState } from "react";
import type { Scenario } from "../../engine";
import { loadMessage, type SeasonLoad } from "../viewModel/season";
import { buildTowerRows, type TowerTab } from "../viewModel/tower";
import { EmptyState } from "./EmptyState";
import { Tabs, panelId, tabId, type TabItem } from "./Tabs";
import { Tower } from "./Tower";

const TABS: readonly TabItem<TowerTab>[] = [
  { id: "wdc", label: "WDC" },
  { id: "wcc", label: "WCC" },
];

interface StandingsPanelProps {
  season: SeasonLoad;
  /** The owner's locked results. Undefined means the table as it stands. */
  scenario?: Scenario;
}

export function StandingsPanel({ season, scenario }: StandingsPanelProps) {
  const [tab, setTab] = useState<TowerTab>("wdc");
  const state = season.status === "ready" ? season.state : undefined;
  const rows = useMemo(() => (state ? buildTowerRows(state, scenario, tab) : []), [state, scenario, tab]);
  const hasLocks = Object.keys(scenario?.locks ?? {}).length > 0;

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
        {season.status === "ready" ? (
          <div className="flex flex-col gap-3">
            {hasLocks ? null : <p className="type-body text-text-2">Lock a result to see the table change.</p>}
            <Tower rows={rows} label={tab === "wdc" ? "Drivers' championship" : "Constructors' championship"} />
          </div>
        ) : (
          <EmptyState title={season.status === "loading" ? "Loading standings" : "Standings not loaded"}>
            {season.status === "error" ? loadMessage(season) : null}
          </EmptyState>
        )}
      </div>
    </main>
  );
}
