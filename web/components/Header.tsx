import type { SeasonPhase } from "../../engine";
import { headerLabel, type HealthState } from "../viewModel/health";
import { PanelLeftIcon, PanelRightIcon } from "./icons";

export interface PanelToggle {
  open: boolean;
  onToggle: () => void;
}

const TOGGLE_BASE = "type-label inline-flex h-8 items-center gap-1.5 rounded-control border px-2.5";
const toggleClass = (open: boolean) =>
  `${TOGGLE_BASE} ${open ? "border-accent bg-s2 text-text" : "border-line text-text-2 hover:border-accent-hover"}`;

export function Header({
  health,
  phase = "running",
  leftToggle,
  rightToggle,
}: {
  health: HealthState;
  phase?: SeasonPhase;
  leftToggle?: PanelToggle;
  rightToggle?: PanelToggle;
}) {
  return (
    <header className="col-span-full flex h-14 items-center justify-between gap-3 rounded-panel bg-s1 px-4">
      <div className="flex items-center gap-3">
        {leftToggle ? (
          <button
            type="button"
            aria-expanded={leftToggle.open}
            aria-label={leftToggle.open ? "Hide sessions panel" : "Show sessions panel"}
            onClick={leftToggle.onToggle}
            className={toggleClass(leftToggle.open)}
          >
            <PanelLeftIcon />
            <span>Sessions</span>
          </button>
        ) : null}
        <h1 className="type-heading text-text">To the Flag</h1>
      </div>
      <div className="flex items-center gap-3">
        <p className="type-label text-text-2" aria-live="polite">
          {headerLabel(health, phase)}
        </p>
        {rightToggle ? (
          <button
            type="button"
            aria-expanded={rightToggle.open}
            aria-label={rightToggle.open ? "Hide analysis panel" : "Show analysis panel"}
            onClick={rightToggle.onToggle}
            className={toggleClass(rightToggle.open)}
          >
            <span>Analysis</span>
            <PanelRightIcon />
          </button>
        ) : null}
      </div>
    </header>
  );
}
