import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { SeasonState } from "../../engine";
import { ArrowDownIcon, ArrowUpIcon } from "./icons";
import { GridExport } from "./GridExport";
import { teamColor } from "../theme/teams";
import type { GridControls } from "../useGrid";
import type { AccessVerdict } from "../viewModel/access";
import {
  applyEditorMessage,
  buildEditorRows,
  dataGridAvailability,
  initialEditorState,
  isDirty,
  menuMessage,
  prefillEditor,
  saveAvailability,
  type EditorMessage,
  type EditorRow,
  type EditorState,
} from "../viewModel/gridEditor";

interface GridEditorProps {
  state: SeasonState;
  controls: GridControls;
  canWrite: boolean;
  verdict: AccessVerdict;
}

const BTN = "type-label h-8 rounded-control border px-3 disabled:cursor-not-allowed";
const BTN_PLAIN = `${BTN} border-line text-text-2 hover:border-accent-hover disabled:text-text-3 disabled:hover:border-line`;
const BTN_PRIMARY = `${BTN} border-accent-fill bg-accent-fill text-text hover:bg-accent-fill-hover disabled:border-line disabled:bg-s2 disabled:text-text-3`;
const BTN_SMALL = "type-label h-8 rounded-control border border-line px-2 text-text-2 hover:border-accent-hover disabled:cursor-not-allowed disabled:text-text-3 disabled:hover:border-line";
// The arrows are icon-only: square, with the driver named in aria-label and title.
const BTN_ARROW = `${BTN_SMALL} inline-flex w-8 items-center justify-center px-0`;

type RowButton = "up" | "down" | "more";
const buttonId = (code: string, which: RowButton) => `grid-${code}-${which}`;

/** Puts the keyboard focus back on a row's button after the list changed (a moved row can lose it). */
function focusFirstAvailable(code: string, order: readonly RowButton[]): void {
  for (const which of order) {
    const el = document.getElementById(buttonId(code, which)) as HTMLButtonElement | null;
    if (el && !el.disabled) {
      el.focus();
      return;
    }
  }
}

/**
 * The starting grid of the next race: every driver in start order, quick corrections for the common cases, a way to
 * paste a whole list, and Save grid. The rules (what is a valid grid, who may save) come from the view-model.
 */
export function GridEditor({ state, controls, canWrite, verdict }: GridEditorProps) {
  const { state: gs } = controls;
  const prefill = useMemo(() => prefillEditor(state, gs.info), [state, gs.info]);
  const [ed, dispatch] = useReducer(
    (current: EditorState, message: EditorMessage) => applyEditorMessage(state, current, message),
    prefill?.grid ?? { order: [], pit: [] },
    initialEditorState,
  );
  // Start again whenever the server's grid changes: it loaded, or a save or a "use data grid" went through.
  useEffect(() => {
    if (prefill) dispatch({ type: "reset", grid: prefill.grid });
  }, [prefill]);

  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const pendingFocus = useRef<{ code: string; order: readonly RowButton[] } | null>(null);
  useEffect(() => {
    const wanted = pendingFocus.current;
    if (wanted) {
      pendingFocus.current = null;
      focusFirstAvailable(wanted.code, wanted.order);
    }
  }, [ed.grid]);

  const rows = useMemo(() => buildEditorRows(state, ed.grid), [state, ed.grid]);
  const busy = gs.busy || gs.saving;
  const save = saveAvailability(state, ed, { canWrite, verdict, busy });
  const data = dataGridAvailability(gs.info, { canWrite, verdict, busy });
  const reasons = [...new Set([save.reason, data.reason].filter((r): r is string => r !== null))];

  const move = (code: string, which: "up" | "down") => {
    pendingFocus.current = { code, order: which === "up" ? ["up", "down", "more"] : ["down", "up", "more"] };
    dispatch({ type: which, code });
  };
  const choose = (code: string, message: EditorMessage) => {
    pendingFocus.current = { code, order: ["more", "up", "down"] };
    setOpenMenu(null);
    dispatch(message);
  };
  const toggleMenu = (code: string) => setOpenMenu((open) => (open === code ? null : code));
  const closeMenu = (code: string) => {
    setOpenMenu(null);
    focusFirstAvailable(code, ["more"]);
  };

  return (
    <div className="flex flex-col gap-3">
      {prefill && prefill.notes.length > 0 ? (
        <div className="flex flex-col gap-1">
          {prefill.notes.map((note) => (
            <p key={note} className="type-note text-text-2">
              {note}
            </p>
          ))}
        </div>
      ) : null}

      <ol aria-label="Starting grid" className="flex flex-col">
        {rows.map((row) => (
          <EditorListRow
            key={row.code}
            row={row}
            menuOpen={openMenu === row.code}
            onMove={move}
            onToggleMenu={toggleMenu}
            onCloseMenu={closeMenu}
            onChoose={choose}
          />
        ))}
      </ol>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => dispatch(ed.pasteOpen ? { type: "closePaste" } : { type: "openPaste" })}
          aria-expanded={ed.pasteOpen}
          aria-controls="grid-paste"
          className={`${BTN_PLAIN} self-start`}
        >
          Paste a list
        </button>
        {ed.pasteOpen ? (
          <div id="grid-paste" className="flex flex-col gap-2">
            <label htmlFor="grid-paste-text" className="type-note text-text-2">
              One driver code per line, or separated by spaces or commas. A place number in front is fine (1 AAA). Put PIT: before the
              pit-lane starters.
            </label>
            <textarea
              id="grid-paste-text"
              rows={8}
              spellCheck={false}
              value={ed.pasteText}
              onChange={(e) => dispatch({ type: "pasteText", text: e.target.value })}
              className="type-data w-full rounded-control border border-line bg-s2 p-2 text-text"
            />
            {ed.pasteErrors.length > 0 ? (
              <div role="alert" className="flex flex-col gap-1">
                {ed.pasteErrors.map((message) => (
                  <p key={message} className="type-note text-red">
                    {message}
                  </p>
                ))}
                <p className="type-note text-text-2">Nothing was changed.</p>
              </div>
            ) : null}
            <div className="flex gap-2">
              <button type="button" onClick={() => dispatch({ type: "applyPaste" })} className={BTN_PRIMARY}>
                Use this list
              </button>
              <button type="button" onClick={() => dispatch({ type: "closePaste" })} className={BTN_PLAIN}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <button
          type="button"
          onClick={() => void controls.save(ed.grid.order, ed.grid.pit)}
          disabled={!save.enabled}
          aria-describedby={reasons.length > 0 ? "grid-reasons" : undefined}
          className={BTN_PRIMARY}
        >
          Save grid
        </button>
        <button
          type="button"
          onClick={() => void controls.chooseOpenF1()}
          disabled={!data.enabled}
          aria-describedby={reasons.length > 0 ? "grid-reasons" : undefined}
          className={BTN_PLAIN}
        >
          Use data grid
        </button>
      </div>
      {gs.saving ? <p className="type-note text-text-2">Saving…</p> : null}
      {gs.busy ? <p className="type-note text-text-2">Switching to the data grid…</p> : null}
      {reasons.length > 0 ? (
        <div id="grid-reasons" className="flex flex-col gap-1">
          {reasons.map((reason) => (
            <p key={reason} className="type-note text-text-2">
              {reason}
            </p>
          ))}
        </div>
      ) : null}
      {[gs.saveError, gs.error].map((message) =>
        message ? (
          <p key={message} role="alert" className="type-note text-red">
            {message}
          </p>
        ) : null,
      )}

      {gs.info ? <GridExport state={state} info={gs.info} unsavedChanges={isDirty(ed)} /> : null}
    </div>
  );
}

interface EditorListRowProps {
  row: EditorRow;
  menuOpen: boolean;
  onMove: (code: string, which: "up" | "down") => void;
  onToggleMenu: (code: string) => void;
  onCloseMenu: (code: string) => void;
  onChoose: (code: string, message: EditorMessage) => void;
}

function EditorListRow({ row, menuOpen, onMove, onToggleMenu, onCloseMenu, onChoose }: EditorListRowProps) {
  const menuId = `grid-${row.code}-menu`;
  return (
    <li
      className="relative flex flex-col border-b border-line pl-4 pr-1"
      onKeyDown={(e) => {
        if (e.key === "Escape" && menuOpen) {
          e.stopPropagation();
          onCloseMenu(row.code);
        }
      }}
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: row.teamId ? teamColor(row.teamId) : undefined }} />
      <div className="grid min-h-11 grid-cols-[1.75rem_1fr_auto] items-center gap-2 py-1">
        <span className="type-data text-right text-text-2">
          <span className="sr-only">Place </span>
          {row.place}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="type-title text-text" title={row.name}>
            {row.code}
          </span>
          {row.pit ? <span className="type-note text-text-2">Pit-lane start</span> : null}
        </span>
        <span className="flex items-center gap-1">
          <button
            type="button"
            id={buttonId(row.code, "up")}
            onClick={() => onMove(row.code, "up")}
            disabled={!row.canUp}
            aria-label={`Move ${row.code} up`}
            title={`Move ${row.code} up`}
            className={BTN_ARROW}
          >
            <ArrowUpIcon />
          </button>
          <button
            type="button"
            id={buttonId(row.code, "down")}
            onClick={() => onMove(row.code, "down")}
            disabled={!row.canDown}
            aria-label={`Move ${row.code} down`}
            title={`Move ${row.code} down`}
            className={BTN_ARROW}
          >
            <ArrowDownIcon />
          </button>
          <button
            type="button"
            id={buttonId(row.code, "more")}
            onClick={() => onToggleMenu(row.code)}
            aria-expanded={menuOpen}
            aria-controls={menuId}
            aria-label={`More actions for ${row.code}`}
            className={BTN_SMALL}
          >
            More
          </button>
        </span>
      </div>
      {menuOpen ? (
        <div id={menuId} role="group" aria-label={`Actions for ${row.code}`} className="flex flex-wrap gap-1 pb-2 pl-9">
          {row.menu.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={item.disabled}
              onClick={() => onChoose(row.code, menuMessage(row.code, item.id))}
              className={BTN_SMALL}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </li>
  );
}
