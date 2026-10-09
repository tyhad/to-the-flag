import type { Dispatch } from "react";
import type { SeasonState } from "../../engine";
import type { SessionCardView } from "../viewModel/sessions";
import type { Workspace, WorkspaceMessage } from "../viewModel/workspace";
import { PositionPicker } from "./PositionPicker";

function LockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}

interface SessionCardProps {
  state: SeasonState;
  card: SessionCardView;
  workspace: Workspace;
  dispatch: Dispatch<WorkspaceMessage>;
}

export function SessionCard({ state, card, workspace, dispatch }: SessionCardProps) {
  const notice = workspace.notice?.scope === card.key ? workspace.notice.message : null;

  return (
    <li
      className={`flex flex-col gap-3 rounded-control border bg-s2 p-3 ${card.locked ? "border-accent-fill" : "border-transparent"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="type-data min-w-0 text-text">{card.title}</h3>
        <button
          type="button"
          aria-pressed={card.locked}
          aria-label={`${card.locked ? "Unlock" : "Lock"} ${card.title}`}
          onClick={() => dispatch({ type: card.locked ? "unlock" : "lock", key: card.key })}
          className={`type-label inline-flex h-8 shrink-0 items-center gap-1.5 rounded-control border px-3 text-text ${
            card.locked ? "border-accent-fill bg-accent-fill hover:bg-accent-fill-hover" : "border-accent hover:border-accent-hover"
          }`}
        >
          {card.locked ? <LockIcon /> : null}
          {card.locked ? "Locked" : "Open"}
        </button>
      </div>
      {card.locked ? <PositionPicker state={state} card={card} workspace={workspace} dispatch={dispatch} /> : null}
      {notice ? (
        <p role="alert" className="type-caption text-red">
          {notice}
        </p>
      ) : null}
    </li>
  );
}
