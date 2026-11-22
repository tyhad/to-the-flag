import { useState } from "react";
import type { SeasonState } from "../../engine";
import { exportScheduleCard } from "../exportCard";
import {
  buildScheduleView,
  defaultScheduleTarget,
  scheduleRaceLine,
  type ScheduleTarget,
} from "../viewModel/scheduleCard";

const BTN = "type-label h-8 rounded-control border px-3 disabled:cursor-not-allowed";
const BTN_PLAIN = `${BTN} border-line text-text-2 hover:border-accent-hover disabled:text-text-3 disabled:hover:border-line`;
const SELECT = "type-body h-8 min-w-0 rounded-control border border-line bg-s2 px-2 text-text";

/**
 * Export the current or next race weekend schedule as a 1080×1080 PNG showing both track local time and the
 * user's browser local time. No token is needed.
 */
export function ScheduleExport({ state }: { state: SeasonState }) {
  const [target, setTarget] = useState<ScheduleTarget>(() => defaultScheduleTarget(state));
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const view = buildScheduleView(state, target);
  const raceLine = scheduleRaceLine(state, target);

  async function exportPicture() {
    if (!view) return;
    setExporting(true);
    setMessage(null);
    try {
      await exportScheduleCard(view);
    } catch {
      setMessage("Could not make the picture. Your browser may have blocked it.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <section aria-label="Export weekend schedule" className="flex flex-col gap-2 border-t border-line pt-3">
      <h3 className="type-heading text-text">Weekend schedule</h3>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Weekend schedule target"
          value={target}
          onChange={(e) => setTarget(e.target.value as ScheduleTarget)}
          className={SELECT}
        >
          <option value="now">Current weekend</option>
          <option value="next">Next weekend</option>
        </select>
        <button type="button" disabled={exporting || !view} onClick={() => void exportPicture()} className={BTN_PLAIN}>
          {exporting ? "Exporting…" : "Export picture"}
        </button>
      </div>
      <p className="type-note text-text-2">{raceLine}</p>
      {message ? (
        <p role="status" className="type-note text-text-2">
          {message}
        </p>
      ) : null}
    </section>
  );
}
