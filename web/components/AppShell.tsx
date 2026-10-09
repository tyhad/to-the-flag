import type { ReactNode } from "react";
import type { SeasonState } from "../../engine";
import { useHealth } from "../useHealth";
import { useSeason } from "../useSeason";
import { useWorkspace } from "../useWorkspace";
import { loadMessage, type SeasonLoad } from "../viewModel/season";
import type { HealthState } from "../viewModel/health";
import { AnalysisRail } from "./AnalysisRail";
import { Header } from "./Header";
import { ScenarioStrip } from "./ScenarioStrip";
import { SessionsPlaceholder, SessionsRail } from "./SessionsRail";
import { StandingsPanel } from "./StandingsPanel";

/** Three-region layout from DESIGN.md section 5: sessions rail 320px, standings, analysis rail 360px. */
function Frame({ health, sessions, standings }: { health: HealthState; sessions: ReactNode; standings: ReactNode }) {
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
        <AnalysisRail />
        <ScenarioStrip />
      </div>
    </>
  );
}

/** Only mounted once the season is loaded, so the scenario always starts from real data. */
function Loaded({ health, season, state }: { health: HealthState; season: SeasonLoad; state: SeasonState }) {
  const [workspace, dispatch] = useWorkspace(state);
  return (
    <Frame
      health={health}
      sessions={<SessionsRail state={state} workspace={workspace} dispatch={dispatch} />}
      standings={<StandingsPanel season={season} scenario={workspace.scenario} />}
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
    />
  );
}
