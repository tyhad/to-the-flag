import type { Dispatch } from "react";
import type { SeasonState } from "../../engine";
import { MAX_CONTENDERS, contenderPool } from "../viewModel/contenders";
import type { Workspace, WorkspaceMessage, WorkspaceMode } from "../viewModel/workspace";

interface ContenderBarProps {
  state: SeasonState;
  workspace: Workspace;
  dispatch: Dispatch<WorkspaceMessage>;
  /** Who the presets point at, shown so the owner knows what "Contender wins" and "Rival out" will do. */
  targets: { contender: string | null; rival: string | null };
  /** Drivers still racing, for the "all drivers" caption. */
  activeCount: number;
}

const MODES: readonly { id: WorkspaceMode; label: string }[] = [
  { id: "contenders", label: "Contenders" },
  { id: "all", label: "All drivers" },
];

const base = "type-label h-8 rounded-control border px-3";

export function ContenderBar({ state, workspace, dispatch, targets, activeCount }: ContenderBarProps) {
  const pool = contenderPool(state);
  const notice = workspace.notice?.scope === "contenders" ? workspace.notice.message : null;

  return (
    <section aria-labelledby="contenders-title" className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <h3 id="contenders-title" className="type-label text-text-2">
          Who can take a position
        </h3>
        <div role="group" aria-label="Who can take a position" className="flex gap-2">
          {MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              aria-pressed={workspace.mode === mode.id}
              onClick={() => dispatch({ type: "setMode", mode: mode.id })}
              className={`${base} ${
                workspace.mode === mode.id
                  ? "border-accent bg-s2 text-text"
                  : "border-transparent text-text-2 hover:border-accent-hover"
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>
        <p className="type-caption text-text-2">
          {workspace.mode === "contenders"
            ? `Position lists offer your ${workspace.contenders.length} contenders.`
            : `Position lists offer all ${activeCount} drivers still racing.`}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="type-label text-text-2">
          Contenders · {workspace.contenders.length} of {MAX_CONTENDERS}
        </h3>
        <ul className="m-0 flex max-h-28 list-none flex-wrap gap-2 overflow-y-auto p-0" aria-label="Contenders">
          {pool.map((code) => {
            const selected = workspace.contenders.includes(code);
            return (
              <li key={code}>
                <button
                  type="button"
                  aria-pressed={selected}
                  title={state.drivers.find((d) => d.code === code)?.name}
                  onClick={() => dispatch({ type: "toggleContender", driver: code })}
                  className={`${base} type-data ${
                    selected
                      ? "border-accent bg-accent-fill text-text"
                      : "border-line text-text-2 hover:border-accent-hover"
                  }`}
                >
                  {code}
                </button>
              </li>
            );
          })}
        </ul>
        {notice ? (
          <p role="alert" className="type-caption text-red">
            {notice}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="focus-select" className="type-label text-text-2">
          Presets work on
        </label>
        <select
          id="focus-select"
          value={workspace.focus ?? ""}
          onChange={(event) => dispatch({ type: "setFocus", driver: event.target.value })}
          className="type-body h-9 rounded-control border border-line bg-s2 px-2 text-text"
        >
          {workspace.contenders.map((code) => (
            <option key={code} value={code}>
              {code} · {state.drivers.find((d) => d.code === code)?.name ?? code}
            </option>
          ))}
        </select>
        <p className="type-caption text-text-2">
          Contender: {targets.contender ?? "none"} · Rival: {targets.rival ?? "none"}
        </p>
      </div>
    </section>
  );
}
