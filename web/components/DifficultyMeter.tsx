import type { DifficultyBand, DifficultyMeter as Meter } from "../viewModel/path";

const FILL: Record<DifficultyBand, string> = {
  green: "bg-green",
  yellow: "bg-yellow",
  orange: "bg-orange",
};

/** A share of the remaining points, as a bar and as words. Never a probability. */
export function DifficultyMeter({ meter }: { meter: Meter }) {
  return (
    <div className="flex flex-col gap-1">
      <div
        role="meter"
        aria-label="Share of the remaining points needed"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={meter.percent}
        aria-valuetext={meter.label}
        className="h-2 w-full overflow-hidden rounded-control border border-line bg-s2"
      >
        <div
          className={`h-full transition-[width] duration-300 ${FILL[meter.band]}`}
          style={{ width: `${meter.percent}%` }}
        />
      </div>
      <p className="type-data text-text">{meter.label}</p>
      <p className="type-caption text-text-2">{meter.caption}</p>
    </div>
  );
}
