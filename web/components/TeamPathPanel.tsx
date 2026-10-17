import { useMemo, useRef, type Dispatch } from "react";
import { teamCars, type SeasonState } from "../../engine";
import { buildTeamPathView, planTeamLoad, teamOptions } from "../viewModel/teamPath";
import type { Workspace, WorkspaceMessage } from "../viewModel/workspace";
import { DifficultyMeter } from "./DifficultyMeter";
import { EmptyState } from "./EmptyState";

interface TeamPathPanelProps {
  state: SeasonState;
  workspace: Workspace;
  dispatch: Dispatch<WorkspaceMessage>;
}

/** "Possible?" for constructors: what has to happen for one team to win the constructors' title. Math only, no model. */
export function TeamPathPanel({ state, workspace, dispatch }: TeamPathPanelProps) {
  const { team, scenario } = workspace;
  const view = useMemo(() => (team ? buildTeamPathView(state, scenario, team) : null), [state, scenario, team]);
  const options = useMemo(() => teamOptions(state), [state]);
  const notice = workspace.notice?.scope === "path" ? workspace.notice : null;
  const headlineRef = useRef<HTMLParagraphElement>(null);

  if (!team || !view) {
    return <EmptyState title="Pick a team">See what it takes to win the constructors' title, in plain words.</EmptyState>;
  }

  const easiest = view.easiest;
  const inFight = options.filter((o) => o.inFight);
  const rest = options.filter((o) => !o.inFight);

  function loadEasiest() {
    if (!easiest || !team) return;
    const plan = planTeamLoad(state, workspace.contenders, teamCars(state).get(team) ?? []);
    dispatch({
      type: "loadScenario",
      scenario: easiest,
      contenders: plan.contenders,
      ...(plan.notice ? { notice: plan.notice } : {}),
    });
    // The button disappears (every open session is now locked and the path is complete), so move focus to the new headline.
    requestAnimationFrame(() => headlineRef.current?.focus());
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="path-team" className="type-label text-text-2">
          Team
        </label>
        <select
          id="path-team"
          value={team}
          onChange={(event) => dispatch({ type: "setTeam", team: event.target.value })}
          className="type-body h-9 rounded-control border border-line bg-s2 px-2 text-text"
        >
          {inFight.length > 0 ? (
            <optgroup label="Still in the title fight">
              {inFight.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </optgroup>
          ) : null}
          {rest.length > 0 ? (
            <optgroup label="Out of the title fight">
              {rest.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </optgroup>
          ) : null}
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
        <section className="flex flex-col gap-2" aria-labelledby="team-rivals-title">
          <h3 id="team-rivals-title" className="type-label text-text-2">
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
            onClick={loadEasiest}
            className="type-label h-10 rounded-control bg-accent-fill px-4 text-text hover:bg-accent-fill-hover"
          >
            Load easiest path into sandbox
          </button>
          <p className="type-caption text-text-2">
            Locks every open session so {view.name} finish 1-2 when a one-two is needed and take P2 and P3 otherwise.
          </p>
        </div>
      ) : null}

      {notice ? (
        // After a successful load a notice is information (not every car fit); otherwise it is a refusal.
        notice.tone === "info" ? (
          <p role="status" className="type-note text-text-2">
            {notice.message}
          </p>
        ) : (
          <p role="alert" className="type-note text-red">
            {notice.message}
          </p>
        )
      ) : null}
    </div>
  );
}
