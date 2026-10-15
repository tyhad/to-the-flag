import type { OddsBarRow, PpDelta, ProbabilityBand } from "../viewModel/odds";

const FILL: Record<ProbabilityBand, string> = {
  green: "bg-green",
  yellow: "bg-yellow",
  orange: "bg-orange",
};

const DELTA_TONES: Record<PpDelta["tone"], string> = {
  up: "text-green",
  down: "text-red",
  none: "text-text-3",
};

/** Change in percentage points against the odds without locks. The arrow and the number carry the meaning, not the color. */
function PpDeltaChip({ delta }: { delta: PpDelta }) {
  return (
    <span className={`type-data inline-flex h-6 min-w-16 items-center justify-center rounded-control bg-s2 px-2 ${DELTA_TONES[delta.tone]}`}>
      <span aria-hidden="true">{delta.text}</span>
      <span className="sr-only">{delta.description}</span>
    </span>
  );
}

/** One row of the "Likely?" panel: a name, an 8px track with the fill, the value as text, and the change if locks are on. */
export function ProbabilityBar({ row }: { row: OddsBarRow }) {
  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="type-title truncate text-text" title={row.title}>
            {row.title}
          </span>
          {row.subtitle ? (
            <span className="type-body truncate text-text-2" title={row.subtitle}>
              {row.subtitle}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {row.delta ? <PpDeltaChip delta={row.delta} /> : null}
          <span className="type-data text-text">
            {row.display}
            <span className="sr-only"> chance to win the title, model estimate</span>
          </span>
        </div>
      </div>
      <div aria-hidden="true" className="h-2 w-full overflow-hidden rounded-control border border-line bg-s2">
        <div className={`h-full transition-[width] duration-300 ${FILL[row.band]}`} style={{ width: `${row.widthPercent}%` }} />
      </div>
    </li>
  );
}
