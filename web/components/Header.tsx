import type { SeasonPhase } from "../../engine";
import { headerLabel, type HealthState } from "../viewModel/health";
import type { LiveToggleTone } from "../viewModel/liveMode";
import { PanelLeftIcon, PanelRightIcon } from "./icons";

export interface PanelToggle {
  open: boolean;
  onToggle: () => void;
}

export interface LiveToggleControl {
  enabled: boolean;
  label: string;
  tone: LiveToggleTone;
  onToggle: () => void;
}

const TOGGLE_BASE = "type-label inline-flex h-8 items-center gap-1.5 rounded-control border px-2.5";
const toggleClass = (open: boolean) =>
  `${TOGGLE_BASE} ${open ? "border-accent bg-s2 text-text" : "border-line text-text-2 hover:border-accent-hover"}`;

const liveClass = (tone: LiveToggleTone) => {
  switch (tone) {
    case "active":
      return `${TOGGLE_BASE} border-green bg-s2 text-green`;
    case "error":
      return `${TOGGLE_BASE} border-yellow bg-s2 text-yellow`;
    case "waiting":
      return `${TOGGLE_BASE} border-accent bg-s2 text-text`;
    case "off":
      return `${TOGGLE_BASE} border-line text-text-2 hover:border-accent-hover`;
  }
};

const liveDotClass = (tone: LiveToggleTone) => {
  switch (tone) {
    case "active":
      return "h-2 w-2 rounded-full bg-green";
    case "error":
      return "h-2 w-2 rounded-full bg-yellow";
    case "waiting":
      return "h-2 w-2 rounded-full bg-accent";
    case "off":
      return "h-2 w-2 rounded-full bg-text-3";
  }
};

export function Header({
  health,
  phase = "running",
  leftToggle,
  rightToggle,
  liveToggle,
}: {
  health: HealthState;
  phase?: SeasonPhase;
  leftToggle?: PanelToggle;
  rightToggle?: PanelToggle;
  liveToggle?: LiveToggleControl;
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
        {liveToggle ? (
          <button
            type="button"
            aria-pressed={liveToggle.enabled}
            aria-label={liveToggle.enabled ? "Disable live as-it-stands feed" : "Enable live as-it-stands feed"}
            onClick={liveToggle.onToggle}
            className={liveClass(liveToggle.tone)}
          >
            <span aria-hidden="true" className={liveDotClass(liveToggle.tone)} />
            <span className="tabular-nums">{liveToggle.label}</span>
          </button>
        ) : null}
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
