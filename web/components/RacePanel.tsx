import type { ReactNode } from "react";
import type { SeasonState } from "../../engine";
import type { GridControls } from "../useGrid";
import type { AccessVerdict } from "../viewModel/access";
import { gridTagFor } from "../viewModel/grid";
import { emptyGridMessage, invalidOverrideNote, raceLabel } from "../viewModel/gridEditor";
import { EmptyState } from "./EmptyState";
import { GridEditor } from "./GridEditor";
import { GridSourceTag } from "./GridSourceTag";

interface RacePanelProps {
  state: SeasonState;
  controls: GridControls;
  canWrite: boolean;
  verdict: AccessVerdict;
  /** The "OpenF1 has a different grid" notice, when there is one (same notice as in the Likely panel). */
  notice?: ReactNode;
  /** The race forecast, shown under the editor (it follows the grid above). */
  forecast?: ReactNode;
}

/** The "Race" tab: the starting grid of the next race, where it comes from, and the editor. */
export function RacePanel({ state, controls, canWrite, verdict, notice, forecast }: RacePanelProps) {
  const { info } = controls.state;
  const empty = emptyGridMessage(controls.state);
  const tag = gridTagFor(info);
  const invalidNote = invalidOverrideNote(info);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="type-heading text-text">Starting grid</h2>
        {info && info.round !== null ? <p className="type-note text-text-2">{raceLabel(state, info.round)}</p> : null}
        {tag && info?.effective ? (
          <div>
            <GridSourceTag source={info.effective.source} />
          </div>
        ) : null}
      </div>

      {invalidNote ? <p className="type-note text-text-2">{invalidNote}</p> : null}
      {notice}

      {empty ? (
        <EmptyState title={empty.title}>{empty.text}</EmptyState>
      ) : (
        <>
          <GridEditor state={state} controls={controls} canWrite={canWrite} verdict={verdict} />
          {forecast}
        </>
      )}
    </div>
  );
}
