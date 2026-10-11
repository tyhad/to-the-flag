import { useReducer, type Dispatch } from "react";
import type { SeasonState } from "../engine";
import { initialWorkspace, workspaceReducer, type Workspace, type WorkspaceMessage } from "./viewModel/workspace";

/** The scenario and its editing settings. Every rule lives in the pure reducer in viewModel/workspace.ts. */
export function useWorkspace(state: SeasonState): [Workspace, Dispatch<WorkspaceMessage>] {
  return useReducer(
    (current: Workspace, message: WorkspaceMessage) => workspaceReducer(state, current, message),
    state,
    initialWorkspace,
  );
}
