import { gridWriteDisabledReason, type GridNoticeView } from "../viewModel/grid";
import type { AccessVerdict } from "../viewModel/access";

interface GridNoticeProps {
  notice: GridNoticeView;
  /** "Use OpenF1 grid" is running. */
  busy: boolean;
  /** Why the last "Use OpenF1 grid" did not work. */
  error: string | null;
  canWrite: boolean;
  verdict: AccessVerdict;
  onUseOpenF1: () => void;
  onKeepMine: () => void;
}

const BTN = "type-label h-8 rounded-control border px-3 disabled:cursor-not-allowed";
const BTN_PLAIN = `${BTN} border-line text-text-2 hover:border-accent-hover disabled:text-text-3 disabled:hover:border-line`;
const BTN_PRIMARY = `${BTN} border-accent-fill bg-accent-fill text-text hover:bg-accent-fill-hover disabled:border-line disabled:bg-s2 disabled:text-text-3`;

/**
 * Shown when a manual grid is in use and OpenF1 has published a different one. It never switches by itself:
 * "Use OpenF1 grid" removes the manual grid, "Keep mine" hides the notice until OpenF1's grid changes.
 */
export function GridNotice({ notice, busy, error, canWrite, verdict, onUseOpenF1, onKeepMine }: GridNoticeProps) {
  const reason = gridWriteDisabledReason(canWrite, verdict);
  return (
    <div role="status" className="flex flex-col gap-2 rounded-panel border border-accent bg-s1 p-3">
      <p className="type-label text-text">{notice.text}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onUseOpenF1} disabled={busy || reason !== null} aria-busy={busy} className={BTN_PRIMARY}>
          {notice.useLabel}
        </button>
        <button type="button" onClick={onKeepMine} disabled={busy} className={BTN_PLAIN}>
          {notice.keepLabel}
        </button>
      </div>
      {busy ? <p className="type-note text-text-2">Switching to the OpenF1 grid…</p> : null}
      {reason ? <p className="type-note text-text-2">{reason}</p> : null}
      {error ? (
        <p role="alert" className="type-note text-red">
          {error}
        </p>
      ) : null}
    </div>
  );
}
