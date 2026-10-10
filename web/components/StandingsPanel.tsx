import { useMemo, useState } from "react";
import type { Scenario } from "../../engine";
import { loadMessage, type SeasonLoad } from "../viewModel/season";
import { buildCompareRows, type CompareSide } from "../viewModel/compare";
import { buildTowerRows, type TowerTab } from "../viewModel/tower";
import { CompareTable } from "./CompareTable";
import { EmptyState } from "./EmptyState";
import { Tabs, panelId, tabId, type TabItem } from "./Tabs";
import { Tower } from "./Tower";

const TABS: readonly TabItem<TowerTab>[] = [
  { id: "wdc", label: "WDC" },
  { id: "wcc", label: "WCC" },
];

/** Compare mode: the two scenarios to show side by side, or why they cannot be shown. */
export type CompareView = { ok: true; left: CompareSide; right: CompareSide } | { ok: false; message: string };

interface StandingsPanelProps {
  season: SeasonLoad;
  /** The owner's locked results. Undefined means the table as it stands. */
  scenario?: Scenario;
  /** When set, the panel compares two scenarios instead of showing the projected table. */
  compare?: CompareView | null;
}

export function StandingsPanel({ season, scenario, compare }: StandingsPanelProps) {
  const [tab, setTab] = useState<TowerTab>("wdc");
  const state = season.status === "ready" ? season.state : undefined;
  const rows = useMemo(() => (state ? buildTowerRows(state, scenario, tab) : []), [state, scenario, tab]);
  const hasLocks = Object.keys(scenario?.locks ?? {}).length > 0;
  const compareRows = useMemo(
    () => (state && compare?.ok ? buildCompareRows(state, compare.left.scenario, compare.right.scenario, tab) : []),
    [state, compare, tab],
  );

  return (
    <main
      id="standings"
      tabIndex={-1}
      aria-labelledby="standings-title"
      className="flex min-h-0 flex-col gap-3 overflow-y-auto rounded-panel bg-s1 p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="standings-title" className="type-title text-text">
          {compare ? "Compare scenarios" : "Projected standings"}
        </h2>
        <Tabs label="Standings type" idPrefix="standings" items={TABS} selected={tab} onSelect={setTab} />
      </div>
      <div role="tabpanel" id={panelId("standings", tab)} aria-labelledby={tabId("standings", tab)}>
        {season.status === "ready" && compare ? (
          compare.ok ? (
            <CompareTable rows={compareRows} leftLabel={compare.left.label} rightLabel={compare.right.label} tab={tab} />
          ) : (
            <EmptyState title="Pick two scenarios to compare">{compare.message}</EmptyState>
          )
        ) : season.status === "ready" ? (
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
