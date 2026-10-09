import { useMemo, type Dispatch } from "react";
import type { SeasonState } from "../../engine";
import { buildSessionCards } from "../viewModel/sessions";
import { presetTargets, type Workspace, type WorkspaceMessage } from "../viewModel/workspace";
import { ContenderBar } from "./ContenderBar";
import { EmptyState } from "./EmptyState";
import { SessionCard } from "./SessionCard";

const RAIL = "flex min-h-0 flex-col gap-3 overflow-y-auto rounded-panel bg-s1 p-4";

interface SessionsRailProps {
  state: SeasonState;
  workspace: Workspace;
  dispatch: Dispatch<WorkspaceMessage>;
}

export function SessionsRail({ state, workspace, dispatch }: SessionsRailProps) {
  const cards = useMemo(() => buildSessionCards(state, workspace.scenario), [state, workspace.scenario]);
  const targets = presetTargets(state, workspace);
  const hasLocks = Object.keys(workspace.scenario.locks).length > 0;

  return (
    <aside aria-labelledby="sessions-title" className={RAIL}>
      <div className="flex items-center justify-between gap-2">
        <h2 id="sessions-title" className="type-title text-text">
          Sessions
        </h2>
        <button
          type="button"
          disabled={!hasLocks}
          onClick={() => dispatch({ type: "reset" })}
          className="type-label h-8 rounded-control border border-line px-3 text-text-2 hover:border-accent-hover disabled:cursor-not-allowed disabled:text-text-3 disabled:hover:border-line"
        >
          Reset scenario
        </button>
      </div>

      {cards.length === 0 ? (
        <EmptyState title="No sessions left">The season is over, so the standings are final.</EmptyState>
      ) : (
        <>
          <ContenderBar state={state} workspace={workspace} dispatch={dispatch} targets={targets} />
          <p className="type-caption text-text-2">Drivers outside your selection score 0 in locked sessions.</p>
          <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-label="Remaining sessions">
            {cards.map((card) => (
              <SessionCard key={card.key} state={state} card={card} workspace={workspace} dispatch={dispatch} />
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}

/** Shown while the season loads, or when it could not be loaded. */
export function SessionsPlaceholder({ title, message }: { title: string; message: string | null }) {
  return (
    <aside aria-labelledby="sessions-title" className={RAIL}>
      <h2 id="sessions-title" className="type-title text-text">
        Sessions
      </h2>
      <EmptyState title={title}>{message}</EmptyState>
    </aside>
  );
}
