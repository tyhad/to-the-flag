import type { Dispatch } from "react";
import type { SeasonState } from "../../engine";
import type { Workspace, WorkspaceMessage } from "../viewModel/workspace";
import { PathPanel } from "./PathPanel";
import { Tabs, panelId, tabId, type TabItem } from "./Tabs";
import { TeamPathPanel } from "./TeamPathPanel";

export type PathSubject = "wdc" | "wcc";

const SUBJECTS: readonly TabItem<PathSubject>[] = [
  { id: "wdc", label: "Drivers" },
  { id: "wcc", label: "Constructors" },
];

interface PossiblePanelProps {
  state: SeasonState;
  workspace: Workspace;
  dispatch: Dispatch<WorkspaceMessage>;
  subject: PathSubject;
  onSubject: (subject: PathSubject) => void;
}

/** "Possible?": the Drivers / Constructors switch and the path panel for the chosen title. Math only, no model. */
export function PossiblePanel({ state, workspace, dispatch, subject, onSubject }: PossiblePanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <Tabs label="Which title" idPrefix="path-subject" items={SUBJECTS} selected={subject} onSelect={onSubject} />
      <div role="tabpanel" id={panelId("path-subject", subject)} aria-labelledby={tabId("path-subject", subject)}>
        {subject === "wdc" ? (
          <PathPanel state={state} workspace={workspace} dispatch={dispatch} />
        ) : (
          <TeamPathPanel state={state} workspace={workspace} dispatch={dispatch} />
        )}
      </div>
    </div>
  );
}
