import { useMemo, type ReactNode } from "react";
import type { SeasonState } from "../../engine";
import { useHealth } from "../useHealth";
import { useScenarioStore } from "../useScenarioStore";
import { useSeason } from "../useSeason";
import { useStrip } from "../useStrip";
import { useWorkspace } from "../useWorkspace";
import { loadMessage, type SeasonLoad } from "../viewModel/season";
import type { HealthState } from "../viewModel/health";
import { AnalysisPlaceholder, AnalysisRail } from "./AnalysisRail";
import { Header } from "./Header";
import { resolveSide } from "../viewModel/compare";
import { ScenarioStrip, ScenarioStripPlaceholder } from "./ScenarioStrip";
import { SessionsPlaceholder, SessionsRail } from "./SessionsRail";
import { StandingsPanel, type CompareView } from "./StandingsPanel";

/** Three-region layout from DESIGN.md section 5: sessions rail 320px, standings, analysis rail 360px. */
function Frame({
  health,
  sessions,
  standings,
  analysis,
  strip,
}: {
  health: HealthState;
  sessions: ReactNode;
  standings: ReactNode;
  analysis: ReactNode;
  strip: ReactNode;
}) {
  return (
    <>
      <a
        href="#standings"
        className="type-label absolute left-3 top-3 z-10 -translate-y-20 rounded-control bg-accent-fill px-3 py-2 text-text focus:translate-y-0"
      >
        Skip to standings
      </a>
      <div className="grid h-full grid-cols-[320px_minmax(0,1fr)_360px] grid-rows-[auto_minmax(0,1fr)_auto] gap-3 p-3">
        <Header health={health} />
        {sessions}
        {standings}
        {analysis}
        {strip}
      </div>
    </>
  );
}

/** Only mounted once the season is loaded, so the scenario always starts from real data. */
function Loaded({ health, season, state }: { health: HealthState; season: SeasonLoad; state: SeasonState }) {
  const [workspace, dispatch] = useWorkspace(state);
  const store = useScenarioStore();
  const strip = useStrip(state, workspace, dispatch, store);
  const { compare } = strip;
  const compareView = useMemo<CompareView | null>(() => {
    if (!compare.open) return null;
    const left = resolveSide(compare.left, workspace.scenario, store.scenarios);
    const right = resolveSide(compare.right, workspace.scenario, store.scenarios);
    if (!left || !right) return { ok: false, message: "Choose two scenarios that still fit the current data." };
    return { ok: true, left, right };
  }, [compare, workspace.scenario, store.scenarios]);
  return (
    <Frame
      health={health}
      sessions={<SessionsRail state={state} workspace={workspace} dispatch={dispatch} />}
      standings={<StandingsPanel
          season={season}
          scenario={workspace.scenario}
          compare={compareView}
          contenders={workspace.contenders}
        />}
      analysis={<AnalysisRail state={state} workspace={workspace} dispatch={dispatch} />}
      strip={<ScenarioStrip state={state} workspace={workspace} store={store} strip={strip} />}
    />
  );
}

export function AppShell() {
  const health = useHealth();
  const season = useSeason();

  if (season.status === "ready") return <Loaded health={health} season={season} state={season.state} />;

  return (
    <Frame
      health={health}
      sessions={
        <SessionsPlaceholder
          title={season.status === "loading" ? "Loading sessions" : "Sessions not loaded"}
          message={season.status === "error" ? loadMessage(season) : null}
        />
      }
      standings={<StandingsPanel season={season} />}
      analysis={<AnalysisPlaceholder />}
      strip={<ScenarioStripPlaceholder />}
    />
  );
}
