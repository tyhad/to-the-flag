import { useMemo, useRef, type Dispatch } from "react";
import type { SeasonState } from "../../engine";
import { buildPathView, sameScenario } from "../viewModel/path";
import type { Workspace, WorkspaceMessage } from "../viewModel/workspace";
import { DifficultyMeter } from "./DifficultyMeter";
import { EmptyState } from "./EmptyState";

interface PathPanelProps {
  state: SeasonState;
  workspace: Workspace;
  dispatch: Dispatch<WorkspaceMessage>;
}

/** "Possible?": what has to happen for one contender to win the title. Math only, no model. */
export function PathPanel({ state, workspace, dispatch }: PathPanelProps) {
  const { focus, scenario } = workspace;
  const view = useMemo(() => (focus ? buildPathView(state, scenario, focus) : null), [state, scenario, focus]);
  const notice = workspace.notice?.scope === "path" ? workspace.notice.message : null;
  const headlineRef = useRef<HTMLParagraphElement>(null);

  if (!focus || !view) {
    return <EmptyState title="Pick a contender">See what it takes to win the title, in plain words.</EmptyState>;
  }

  const easiest = view.easiest;
  const loaded = easiest !== null && sameScenario(easiest, scenario);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="path-contender" className="type-label text-text-2">
          Contender
        </label>
        <select
          id="path-contender"
          value={focus}
          onChange={(event) => dispatch({ type: "setFocus", driver: event.target.value })}
          className="type-body h-9 rounded-control border border-line bg-s2 px-2 text-text"
        >
          {workspace.contenders.map((code) => (
            <option key={code} value={code}>
              {code} · {state.drivers.find((d) => d.code === code)?.name ?? code}
            </option>
          ))}
        </select>
      </div>

      <p ref={headlineRef} tabIndex={-1} className="type-title text-text">
        {view.headline}
      </p>

      {view.meter ? <DifficultyMeter meter={view.meter} /> : null}

      {view.conditions.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {view.conditions.map((line) => (
            <li key={line} className="type-body text-text">
              {line}
            </li>
          ))}
        </ul>
      ) : null}

      {view.rivals.length > 0 ? (
        <section className="flex flex-col gap-2" aria-labelledby="rivals-title">
          <h3 id="rivals-title" className="type-label text-text-2">
            What the rivals may still score
          </h3>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {view.rivals.map((line) => (
              <li key={line} className="type-note border-l-2 border-line pl-3 text-text-2">
                {line}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {view.estimateNote ? <p className="type-note text-text-2">{view.estimateNote}</p> : null}

      {easiest ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            aria-disabled={loaded}
            onClick={() => {
              if (loaded) return;
              dispatch({ type: "loadScenario", scenario: easiest });
              // The button may disappear (the path is now complete), so move focus to the new headline.
              requestAnimationFrame(() => headlineRef.current?.focus());
            }}
            className="type-label h-10 rounded-control bg-accent-fill px-4 text-text hover:bg-accent-fill-hover aria-disabled:cursor-not-allowed aria-disabled:bg-s2 aria-disabled:text-text-3 aria-disabled:hover:bg-s2"
          >
            {loaded ? "Easiest path is loaded" : "Load easiest path into sandbox"}
          </button>
          <p className="type-caption text-text-2">
            Locks every open session so {view.name} wins when a win is needed and finishes second otherwise.
          </p>
        </div>
      ) : null}

      {notice ? (
        <p role="alert" className="type-note text-red">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
