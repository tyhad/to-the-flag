import type { ScenarioChip as Chip } from "../viewModel/scenarios";
import { AlertIcon, ClockIcon } from "./icons";

interface ScenarioChipProps {
  chip: Chip;
  onSelect: (id: string | null) => void;
}

/** Every state is said in words and shown with an icon: stale, invalid and live are never color alone. */
export function ScenarioChip({ chip, onSelect }: ScenarioChipProps) {
  const tone = chip.selected
    ? "border-accent bg-s2 text-text"
    : "border-line text-text-2 hover:border-accent-hover";
  return (
    <button
      type="button"
      aria-pressed={chip.selected}
      title={chip.note ?? undefined}
      onClick={() => onSelect(chip.id)}
      className={`type-label inline-flex h-9 items-center gap-2 rounded-control border px-3 ${tone}`}
    >
      <span>{chip.name}</span>
      {chip.live ? (
        <span className="inline-flex items-center gap-1 text-accent-text">
          <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-accent-text" />
          Live
          <span className="sr-only"> on the overlay</span>
        </span>
      ) : null}
      {chip.stale ? (
        <span className="inline-flex items-center gap-1 text-text-3">
          <ClockIcon />
          {chip.staleLabel}
          <span className="sr-only"> (older data)</span>
        </span>
      ) : null}
      {!chip.valid ? (
        <span className="inline-flex items-center gap-1 text-yellow">
          <AlertIcon />
          Invalid
        </span>
      ) : null}
    </button>
  );
}

