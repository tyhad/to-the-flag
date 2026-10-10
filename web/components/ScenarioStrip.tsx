import { useEffect, useState, type FormEvent } from "react";
import type { SeasonState } from "../../engine";
import type { ScenarioStore } from "../useScenarioStore";
import type { Strip } from "../useStrip";
import { compareOptions } from "../viewModel/compare";
import { MAX_NAME_LENGTH, buildChips, isDirty } from "../viewModel/scenarios";
import type { Workspace } from "../viewModel/workspace";
import { AlertIcon, ScenarioChip } from "./ScenarioChip";

const BTN = "type-label h-8 rounded-control border px-3 disabled:cursor-not-allowed";
const BTN_PLAIN = `${BTN} border-line text-text-2 hover:border-accent-hover disabled:text-text-3 disabled:hover:border-line`;
const BTN_PRIMARY = `${BTN} border-accent-fill bg-accent-fill text-text hover:bg-accent-fill-hover disabled:border-line disabled:bg-s2 disabled:text-text-3`;
const SELECT = "type-body h-8 min-w-0 rounded-control border border-line bg-s2 px-2 text-text";
const BANNER_TONE = { info: "text-text-2", warn: "text-yellow", error: "text-red" } as const;

type FormMode = "idle" | "naming" | "renaming" | "deleting";

interface ScenarioStripProps {
  state: SeasonState;
  workspace: Workspace;
  store: ScenarioStore;
  strip: Strip;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function ScenarioStrip({ state, workspace, store, strip }: ScenarioStripProps) {
  const [mode, setMode] = useState<FormMode>("idle");
  const [draft, setDraft] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // Switching to another chip closes any open form.
  useEffect(() => {
    setMode("idle");
    setFormError(null);
  }, [strip.selectedId]);

  const lockCount = Object.keys(workspace.scenario.locks).length;
  const selected = store.scenarios.find((s) => s.id === strip.selectedId);
  const chips = buildChips(state.asOfRound, store.scenarios, strip.selectedId, store.activeId);
  const selectedChip = chips.find((c) => c.selected && c.kind === "saved");
  // An invalid scenario cannot be loaded, so there is nothing for the sandbox to differ from.
  const dirty = selected?.valid ? isDirty(workspace.scenario, workspace.contenders, selected) : false;
  const stripNotice = workspace.notice?.scope === "strip" ? workspace.notice.message : null;

  const canOverlay = selected !== undefined && selected.valid && !dirty;
  const isLive = selected !== undefined && store.activeId === selected.id;
  const overlayHint = !selected
    ? "Save the scenario and select it to show it on the overlay."
    : !selected.valid
      ? "This scenario no longer fits the data."
      : dirty
        ? "Save your changes first, so the overlay shows what you see."
        : undefined;

  function open(next: FormMode, text = "") {
    setMode(next);
    setDraft(text);
    setFormError(null);
  }

  async function submit(event: FormEvent, action: (name: string) => Promise<string | null>) {
    event.preventDefault();
    const error = await action(draft);
    if (error) setFormError(error);
    else open("idle");
  }

  const nameForm = (label: string, action: (name: string) => Promise<string | null>, submitLabel: string) => (
    <form onSubmit={(e) => void submit(e, action)} className="flex flex-wrap items-center gap-2">
      <label htmlFor="scenario-name" className="type-label text-text-2">
        {label}
      </label>
      <input
        id="scenario-name"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        maxLength={MAX_NAME_LENGTH + 20}
        autoFocus
        autoComplete="off"
        placeholder="For example: Norris wins all"
        aria-invalid={formError ? true : undefined}
        aria-describedby={formError ? "scenario-name-error" : undefined}
        className={`${SELECT} w-64`}
      />
      <button type="submit" disabled={store.busy} className={BTN_PRIMARY}>
        {submitLabel}
      </button>
      <button type="button" onClick={() => open("idle")} className={BTN_PLAIN}>
        Cancel
      </button>
      {formError ? (
        <p id="scenario-name-error" role="alert" className="type-caption w-full text-red">
          {formError}
        </p>
      ) : null}
    </form>
  );

  const options = compareOptions(store.scenarios);

  return (
    <footer aria-label="Scenarios" className="col-span-3 flex flex-col gap-2 rounded-panel bg-s1 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ul className="m-0 flex list-none flex-wrap items-center gap-2 p-0" aria-label="Saved scenarios">
          {chips.map((chip) => (
            <li key={chip.id ?? "base"}>
              <ScenarioChip chip={chip} onSelect={strip.selectChip} />
            </li>
          ))}
          <li>
            <button
              type="button"
              disabled={lockCount === 0 || store.status !== "ready"}
              onClick={() => open("naming")}
              title={lockCount === 0 ? "Lock a result first, then save it as a new scenario." : undefined}
              className="type-label h-9 rounded-control border border-dashed border-line px-3 text-text-2 hover:border-accent-hover disabled:cursor-not-allowed disabled:text-text-3 disabled:hover:border-line"
            >
              + New
            </button>
          </li>
        </ul>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Scenario actions">
          <button type="button" aria-pressed={strip.compare.open} onClick={strip.toggleCompare} className={BTN_PLAIN}>
            Compare
          </button>
          <button
            type="button"
            disabled={lockCount === 0}
            onClick={() => void strip.copyLink()}
            title={lockCount === 0 ? "Lock a result first. A link to Base has nothing to share." : undefined}
            className={BTN_PLAIN}
          >
            Copy link
          </button>
          <button
            type="button"
            aria-pressed={isLive}
            disabled={!canOverlay || store.busy}
            onClick={() => void strip.toggleOverlay()}
            title={overlayHint}
            className={BTN_PLAIN}
          >
            {isLive ? "Stop showing on overlay" : "Show on overlay"}
          </button>
        </div>
      </div>

      {strip.compare.open ? (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="compare-left" className="type-label text-text-2">
            Compare
          </label>
          <select
            id="compare-left"
            value={strip.compare.left}
            onChange={(e) => strip.setCompareSide("left", e.target.value)}
            className={SELECT}
          >
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <label htmlFor="compare-right" className="type-label text-text-2">
            with
          </label>
          <select
            id="compare-right"
            value={strip.compare.right}
            onChange={(e) => strip.setCompareSide("right", e.target.value)}
            className={SELECT}
          >
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {mode === "naming" ? nameForm("Name this scenario", strip.saveNew, "Save scenario") : null}
      {mode === "renaming" ? nameForm("New name", strip.rename, "Rename") : null}

      {mode === "deleting" && selected ? (
        <div className="flex flex-wrap items-center gap-2" role="alertdialog" aria-label={`Delete ${selected.name}?`}>
          <p className="type-body text-text">Delete "{selected.name}"? This cannot be undone.</p>
          <button
            type="button"
            disabled={store.busy}
            onClick={() => {
              open("idle");
              void strip.removeSelected();
            }}
            className={BTN_PRIMARY}
          >
            Delete
          </button>
          <button type="button" onClick={() => open("idle")} className={BTN_PLAIN}>
            Keep it
          </button>
        </div>
      ) : null}

      {mode === "idle" || mode === "naming" ? (
        <div className="flex flex-wrap items-center gap-3">
          {selected && selectedChip ? (
            <>
              <p className="type-label text-text">
                {selected.name}
                {dirty ? <span className="text-text-2"> · unsaved changes</span> : null}
              </p>
              {selectedChip.note ? (
                <p className="type-caption inline-flex items-center gap-1 text-text-2">
                  {!selected.valid ? <AlertIcon /> : null}
                  {selectedChip.note}
                </p>
              ) : null}
              {selected.valid && dirty ? (
                <button type="button" disabled={store.busy} onClick={() => void strip.saveChanges()} className={BTN_PRIMARY}>
                  Save changes
                </button>
              ) : null}
              <button type="button" onClick={() => open("renaming", selected.name)} className={BTN_PLAIN}>
                Rename
              </button>
              <button type="button" onClick={() => open("deleting")} className={BTN_PLAIN}>
                Delete
              </button>
            </>
          ) : lockCount > 0 ? (
            <>
              <p className="type-body text-text-2">Unsaved scenario: {plural(lockCount, "session", "sessions")} locked.</p>
              <button
                type="button"
                disabled={store.status !== "ready"}
                onClick={() => open("naming")}
                className={BTN_PRIMARY}
              >
                Save as new scenario
              </button>
            </>
          ) : store.scenarios.length === 0 ? (
            <p className="type-body text-text-2">
              No saved scenarios yet. Lock a result, then save the scenario to compare it later.
            </p>
          ) : (
            <p className="type-body text-text-2">Base shows the real results. Pick a scenario, or lock a result.</p>
          )}
        </div>
      ) : null}

      {store.status === "error" ? (
        <p role="alert" className="type-caption text-red">
          Saved scenarios are not available. {store.loadMessage} You can still lock results, compare against Base, and copy a link.
        </p>
      ) : null}

      {strip.banner ? (
        <div className="flex flex-wrap items-center gap-3">
          <p role="status" className={`type-caption inline-flex items-center gap-1 ${BANNER_TONE[strip.banner.tone]}`}>
            {strip.banner.tone !== "info" ? <AlertIcon /> : null}
            {strip.banner.text}
          </p>
          <button type="button" onClick={strip.dismissBanner} className="type-caption text-text-2 underline hover:text-text">
            Dismiss
          </button>
        </div>
      ) : null}
      {stripNotice ? (
        <p role="alert" className="type-caption text-red">
          {stripNotice}
        </p>
      ) : null}
      {strip.manualLink ? (
        <div className="flex items-center gap-2">
          <label htmlFor="manual-link" className="type-label text-text-2">
            Link
          </label>
          <input
            id="manual-link"
            readOnly
            value={strip.manualLink}
            onFocus={(e) => e.currentTarget.select()}
            className={`${SELECT} w-full max-w-xl`}
          />
        </div>
      ) : null}
    </footer>
  );
}

/** Shown while the season loads, or when it could not be loaded. */
export function ScenarioStripPlaceholder() {
  return (
    <footer aria-label="Scenarios" className="col-span-3 flex min-h-14 items-center gap-3 rounded-panel bg-s1 px-4 py-2">
      <span className="type-label rounded-control border border-accent bg-s2 px-3 py-2 text-text">Base</span>
      <p className="type-body text-text-2">Scenarios appear here once season data is loaded.</p>
    </footer>
  );
}
