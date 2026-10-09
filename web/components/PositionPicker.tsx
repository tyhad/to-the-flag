import type { Dispatch } from "react";
import type { SeasonState } from "../../engine";
import { outChoices, pickerChoices, type SessionCardView } from "../viewModel/sessions";
import type { LockPreset } from "../viewModel/locks";
import type { Workspace, WorkspaceMessage } from "../viewModel/workspace";

interface PositionPickerProps {
  state: SeasonState;
  card: SessionCardView;
  workspace: Workspace;
  dispatch: Dispatch<WorkspaceMessage>;
}

const PRESETS: readonly { id: LockPreset; label: string }[] = [
  { id: "contenderWins", label: "Contender wins" },
  { id: "rivalOut", label: "Rival out" },
  { id: "clear", label: "Clear" },
];

const selectClass = "type-body h-9 w-full min-w-0 rounded-control border border-line bg-s1 px-2 text-text";

export function PositionPicker({ state, card, workspace, dispatch }: PositionPickerProps) {
  const assignable = workspace.mode === "all" ? null : workspace.contenders;
  const choices = pickerChoices(state, assignable, card);
  const out = outChoices(state, card);
  const where = new Map(card.slots.flatMap((s) => (s.driver ? [[s.driver, s.position] as const] : [])));

  function choose(position: number, occupant: string | null, driver: string) {
    if (driver === "") {
      if (occupant) dispatch({ type: "unassign", key: card.key, driver: occupant });
      return;
    }
    // Picking from a slot's list replaces whoever was there.
    if (occupant && occupant !== driver) dispatch({ type: "unassign", key: card.key, driver: occupant });
    dispatch({ type: "assign", key: card.key, driver, position });
  }

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Presets" className="flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => dispatch({ type: "preset", key: card.key, preset: preset.id })}
            className="type-label h-8 rounded-control border border-line px-3 text-text-2 hover:border-accent-hover"
          >
            {preset.label}
          </button>
        ))}
      </div>

      <ol className="m-0 flex list-none flex-col gap-2 p-0" aria-label={`Positions, ${card.title}`}>
        {card.slots.map((slot) => (
          <li key={slot.position} className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-2">
            <span className="type-data text-text-2">P{slot.position}</span>
            <select
              aria-label={`P${slot.position}, ${card.title}`}
              value={slot.driver ?? ""}
              onChange={(event) => choose(slot.position, slot.driver, event.target.value)}
              className={selectClass}
            >
              <option value="">Nobody</option>
              {choices.map((choice) => {
                const elsewhere = where.get(choice.code);
                const moved = elsewhere !== undefined && elsewhere !== slot.position ? ` (now P${elsewhere})` : "";
                return (
                  <option key={choice.code} value={choice.code}>
                    {choice.code} · {choice.name}
                    {moved}
                  </option>
                );
              })}
            </select>
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-2">
        <h4 className="type-label text-text-2">Out (scores nothing)</h4>
        {card.out.length > 0 ? (
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label="Drivers marked out">
            {card.out.map((code) => (
              <li key={code}>
                <button
                  type="button"
                  onClick={() => dispatch({ type: "unassign", key: card.key, driver: code })}
                  aria-label={`${code} is out. Remove`}
                  className="type-data inline-flex h-8 items-center gap-2 rounded-control border border-line px-3 text-text hover:border-accent-hover"
                >
                  {code}
                  <span aria-hidden="true" className="text-text-3">
                    ✕
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <select
          aria-label={`Mark a driver out, ${card.title}`}
          value=""
          onChange={(event) => {
            if (event.target.value) dispatch({ type: "out", key: card.key, driver: event.target.value });
          }}
          className={selectClass}
        >
          <option value="">Mark a driver out…</option>
          {out.map((choice) => (
            <option key={choice.code} value={choice.code}>
              {choice.code} · {choice.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
