import { useMemo } from "react";
import type { SeasonState } from "../../engine";
import { FORM_WEIGHT_STEP } from "../config";
import { buildOddsView, oddsErrorCopy, snapFormPercent, type OddsPanelState, type OddsTable, type OddsView } from "../viewModel/odds";
import { EmptyState } from "./EmptyState";
import { ProbabilityBar } from "./ProbabilityBar";

interface OddsPanelProps {
  state: SeasonState;
  panel: OddsPanelState;
  /** True when the scenario locks at least one session, so the change against no locks is shown. */
  hasLocks: boolean;
  table: OddsTable;
  onTable: (table: OddsTable) => void;
  formPercent: number;
  onFormPercent: (percent: number) => void;
}

const TABLES: readonly { id: OddsTable; label: string }[] = [
  { id: "wdc", label: "Drivers" },
  { id: "wcc", label: "Teams" },
];

function TableToggle({ table, onTable }: { table: OddsTable; onTable: (table: OddsTable) => void }) {
  return (
    <div role="group" aria-label="Which title" className="flex gap-2">
      {TABLES.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-pressed={item.id === table}
          onClick={() => onTable(item.id)}
          className={`type-label h-9 rounded-control border px-3 ${
            item.id === table ? "border-accent bg-s2 text-text" : "border-transparent text-text-2 hover:border-accent-hover"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function FormWeightSlider({ percent, onChange }: { percent: number; onChange: (percent: number) => void }) {
  const valueText = percent === 0 ? "0%, all drivers equal" : percent === 100 ? "100%, this season's form" : `${percent}%`;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="odds-form-weight" className="type-label text-text-2">
        How much this season's form counts
      </label>
      <input
        id="odds-form-weight"
        type="range"
        min={0}
        max={100}
        step={FORM_WEIGHT_STEP}
        value={percent}
        aria-valuetext={valueText}
        onChange={(event) => onChange(snapFormPercent(Number(event.target.value)))}
        className="w-full accent-accent"
      />
      <div className="flex justify-between gap-2">
        <span className="type-note text-text-2">All drivers equal</span>
        <span className="type-note text-right text-text-2">This season's form</span>
      </div>
      <p className="type-data text-text">{percent}%</p>
    </div>
  );
}

function Bars({ view }: { view: OddsView }) {
  return (
    <div className="flex flex-col gap-3">
      {view.rows.length > 0 ? (
        <ul aria-label={view.table === "wdc" ? "Chance to win the drivers' title" : "Chance to win the teams' title"} className="m-0 flex list-none flex-col gap-3 p-0">
          {view.rows.map((row) => (
            <ProbabilityBar key={row.id} row={row} />
          ))}
        </ul>
      ) : null}
      {view.clinched.map((line) => (
        <p key={line} className="type-title text-text">
          {line}
        </p>
      ))}
      {view.outLine ? <p className="type-note text-text-2">{view.outLine}</p> : null}
      {view.tableNote ? <p className="type-note text-text-2">{view.tableNote}</p> : null}
      {view.scenarioNote ? <p className="type-note text-text-2">{view.scenarioNote}</p> : null}
    </div>
  );
}

/** "Likely?": what the model thinks is probable. Always labelled as an estimate. */
export function OddsPanel({ state, panel, hasLocks, table, onTable, formPercent, onFormPercent }: OddsPanelProps) {
  const view = useMemo(
    () => (panel.result ? buildOddsView({ result: panel.result, base: panel.base, state, table, formPercent, hasLocks }) : null),
    [panel.result, panel.base, state, table, formPercent, hasLocks],
  );
  const calculating = panel.status === "calculating";
  const failed = panel.status === "error";
  const error = failed ? oddsErrorCopy(panel.errorKind) : null;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="type-heading text-text">Model estimate</h2>
          {view?.lowConfidence ? (
            <span className="type-label chamfer inline-flex h-6 items-center bg-yellow px-2 text-s0">{view.lowConfidence.tag}</span>
          ) : null}
          {view?.gridKnown ? (
            <span className="type-label rounded-control inline-flex h-6 items-center border border-line px-2 text-text-2">{view.gridKnown.tag}</span>
          ) : null}
        </div>
        {view ? <p className="type-note text-text-2">{view.asOf}</p> : null}
        {view?.lowConfidence ? <p className="type-note text-text-2">{view.lowConfidence.note}</p> : null}
      </header>

      <TableToggle table={table} onTable={onTable} />

      {view?.whatIf ? <p className="type-note text-yellow">{view.whatIf}</p> : null}

      {error ? (
        <div role="alert" className="flex flex-col gap-1 rounded-control border border-line p-3">
          <p className="type-title text-red">{error.title}</p>
          <p className="type-body text-text-2">{error.body}</p>
        </div>
      ) : null}

      {view ? (
        <div aria-busy={calculating} className={`flex flex-col gap-3 ${calculating || failed ? "opacity-60" : ""}`}>
          {calculating ? (
            <p role="status" className="type-note text-text-2">
              Updating…
            </p>
          ) : null}
          <Bars view={view} />
        </div>
      ) : failed ? null : (
        <p role="status" className="type-body text-text-2">
          Calculating the odds…
        </p>
      )}

      <FormWeightSlider percent={formPercent} onChange={onFormPercent} />

      {view ? (
        <details className="flex flex-col gap-2">
          <summary className="type-label cursor-pointer text-text-2">How this works</summary>
          <p className="type-note mt-2 text-text-2">{view.howItWorks}</p>
        </details>
      ) : null}
    </div>
  );
}

/** Shown in the "Likely?" tab while the season has not loaded. */
export function OddsPlaceholder() {
  return <EmptyState title="No odds yet">Once season data is loaded, see how likely each driver is to win the title.</EmptyState>;
}
