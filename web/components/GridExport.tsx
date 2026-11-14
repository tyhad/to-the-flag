import { useState } from "react";
import { exportGridCard } from "../exportCard";
import { copyText, downloadText } from "../exportText";
import type { CardSize } from "../viewModel/card";
import type { GridInfo } from "../viewModel/grid";
import {
  FULL_DATA_NOTE,
  buildGridCardView,
  buildGridExportRows,
  copyMessage,
  exportNote,
  formatGridRange,
  gridExportFilename,
  gridToCsv,
  gridToJson,
  resolveGridRange,
  type GridRangeChoice,
} from "../viewModel/gridExport";
import type { SeasonState } from "../../engine";

interface GridExportProps {
  state: SeasonState;
  /** The grid in use. Must have a grid and a round; the editor only shows this section when it does. */
  info: GridInfo;
  /** The editor has changes that are not saved: the export is of the saved grid. */
  unsavedChanges: boolean;
}

const BTN = "type-label h-8 rounded-control border px-3 disabled:cursor-not-allowed";
const BTN_PLAIN = `${BTN} border-line text-text-2 hover:border-accent-hover disabled:text-text-3 disabled:hover:border-line`;
const SELECT = "type-body h-8 min-w-0 rounded-control border border-line bg-s2 px-2 text-text";

/**
 * Export the starting grid: a picture (drawn like a grid on the track, any range of places), and the rows as CSV or
 * JSON to copy or download. Reading and exporting need no token. The picture and the data are of the saved grid.
 */
export function GridExport({ state, info, unsavedChanges }: GridExportProps) {
  const [size, setSize] = useState<CardSize>("square");
  const [choice, setChoice] = useState<GridRangeChoice>("all");
  const [customFrom, setCustomFrom] = useState(1);
  const [customTo, setCustomTo] = useState(10);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!info.effective || info.round === null) return null;
  const round = info.round;
  const rows = buildGridExportRows(state, info.effective);
  const { range, problem } = resolveGridRange(choice, { from: customFrom, to: customTo }, rows.length);
  const note = exportNote(unsavedChanges);

  async function exportPicture() {
    const view = buildGridCardView(state, info, range);
    if (!view) return;
    setExporting(true);
    setMessage(null);
    try {
      await exportGridCard(view, size);
    } catch {
      setMessage("Could not make the picture. Your browser may have blocked it.");
    } finally {
      setExporting(false);
    }
  }

  async function copy(kind: "CSV" | "JSON") {
    const copied = await copyText(kind === "CSV" ? gridToCsv(rows) : gridToJson(rows));
    setMessage(copyMessage(kind, copied));
  }

  function download(kind: "csv" | "json") {
    const name = gridExportFilename(kind, { season: state.season, round });
    downloadText(name, kind === "csv" ? "text/csv" : "application/json", kind === "csv" ? gridToCsv(rows) : gridToJson(rows));
    setMessage(null);
  }

  return (
    <section aria-label="Export the starting grid" className="flex flex-col gap-2 border-t border-line pt-3">
      <h3 className="type-heading text-text">Export</h3>

      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Export picture size" value={size} onChange={(e) => setSize(e.target.value as CardSize)} className={SELECT}>
          <option value="square">Square (1080×1080)</option>
          <option value="wide">Wide (1920×1080)</option>
        </select>
        <select
          aria-label="Export places"
          value={choice}
          onChange={(e) => setChoice(e.target.value as GridRangeChoice)}
          className={SELECT}
        >
          <option value="all">All</option>
          <option value="10">Top 10</option>
          <option value="12">Top 12</option>
          <option value="custom">Custom (P...–P...)</option>
        </select>
        {choice === "custom" ? (
          <div className="flex items-center gap-1">
            <span className="type-label text-text-2">P</span>
            <input
              type="number"
              min={1}
              value={customFrom}
              onChange={(e) => setCustomFrom(Math.max(1, parseInt(e.target.value, 10) || 1))}
              aria-label="From position"
              className={`${SELECT} w-14 text-center`}
            />
            <span className="type-label text-text-3">–</span>
            <span className="type-label text-text-2">P</span>
            <input
              type="number"
              min={customFrom}
              value={customTo}
              onChange={(e) => setCustomTo(Math.max(customFrom, parseInt(e.target.value, 10) || customFrom))}
              aria-label="To position"
              className={`${SELECT} w-14 text-center`}
            />
          </div>
        ) : null}
        <button type="button" disabled={exporting || problem !== null} onClick={() => void exportPicture()} className={BTN_PLAIN}>
          {exporting ? "Exporting…" : "Export picture"}
        </button>
      </div>
      {range ? <p className="type-note text-text-2">The picture shows {formatGridRange(range)} of {rows.length}.</p> : null}
      {problem ? <p className="type-note text-text-2">{problem}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void copy("CSV")} className={BTN_PLAIN}>
          Copy as CSV
        </button>
        <button type="button" onClick={() => void copy("JSON")} className={BTN_PLAIN}>
          Copy as JSON
        </button>
        <button type="button" onClick={() => download("csv")} className={BTN_PLAIN}>
          Download CSV
        </button>
        <button type="button" onClick={() => download("json")} className={BTN_PLAIN}>
          Download JSON
        </button>
      </div>
      {range ? <p className="type-note text-text-2">{FULL_DATA_NOTE}</p> : null}
      {note ? <p className="type-note text-text-2">{note}</p> : null}
      {message ? (
        <p role="status" className="type-note text-text-2">
          {message}
        </p>
      ) : null}
    </section>
  );
}
