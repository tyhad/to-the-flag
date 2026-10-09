import { useHealth } from "../useHealth";
import { AnalysisRail } from "./AnalysisRail";
import { Header } from "./Header";
import { ScenarioStrip } from "./ScenarioStrip";
import { SessionsRail } from "./SessionsRail";
import { StandingsPanel } from "./StandingsPanel";

/** Three-region layout from DESIGN.md section 5: sessions rail 320px, standings, analysis rail 360px. */
export function AppShell() {
  const health = useHealth();

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
        <SessionsRail />
        <StandingsPanel />
        <AnalysisRail />
        <ScenarioStrip />
      </div>
    </>
  );
}
